/* Pure configuration logic; no network or account access. Also tested under Node. */
var Kivi = (function () {
    'use strict';
    var URL = 'https://ai.kividas.com/api';
    var ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    var STARTUP_FLAG = '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL';
    function current(fs, change) { return change.kind==='environment'?fs.envRead(change.name):fs.read(change.path); }
    function put(fs, change, value) {
        if(change.kind==='environment')fs.envWrite(change.name,value);
        else if(value===null)fs.remove(change.path);else fs.write(change.path,value);
    }
    function fail(s) { throw new Error(s); }
    function object(v, label) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) fail(label + ' 格式不正确，未修改配置。');
        return v;
    }
    function parse(raw, label) {
        if (raw === null) return {};
        try { return object(JSON.parse(raw.replace(/^\uFEFF/, '')), label); }
        catch (_) { fail(label + ' 不是有效 JSON，请先修复；原文件未覆盖。'); }
    }
    function validate(key, id) {
        key = String(key || '').trim(); id = String(id || '').trim();
        if (!/^sk-kiv-desktop-[A-Za-z0-9_-]{40,128}$/.test(key)) fail('请填写完整的 Kividas Gateway API key。');
        if (!ID.test(id)) fail('安装识别码应为管理员配发的 UUID；不要自行生成或更换。');
        return { key: key, id: id };
    }
    function fromText(text) {
        var keys = [], ids = [];
        String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function (line) {
            var k = /^\s*Gateway API key\s*[:：]\s*(\S+)\s*$/i.exec(line);
            var d = /^\s*(?:安装识别码|Installation ID|值[（(]Value[）)])\s*[:：]\s*(\S+)\s*$/i.exec(line);
            if (k) keys.push(k[1]); if (d) ids.push(d[1]);
        });
        if (keys.length !== 1 || ids.length !== 1) fail('TXT 必须包含一套明确的 Gateway API key 和安装识别码（或“值（Value）”）。请使用后台下载的客户接入资料。');
        return validate(keys[0], ids[0]);
    }
    function json(v) { return JSON.stringify(v, null, 2) + '\n'; }
    function gatewayUrl(value) { return value===URL || value===URL+'/'; }
    function desktopPrivacy(profile) {
        profile.disableNonessentialTelemetry=true;
        profile.disableEssentialTelemetry=true;
        // Current Desktop also accepts nested settings. Keep an existing
        // nested representation consistent, without creating a second one.
        if(profile.telemetry!==undefined){
            object(profile.telemetry,'桌面隐私设置');
            profile.telemetry.disableNonessential=true;
            profile.telemetry.disableEssential=true;
        }
    }
    function cliPrivacy(env) {
        env.DISABLE_TELEMETRY='1';
        env.DISABLE_ERROR_REPORTING='1';
        env.CLAUDE_CODE_ENABLE_TELEMETRY='0';
        env.OTEL_SDK_DISABLED='true';
    }
    // Reset only connection/model selection. Do not touch user instructions,
    // permissions, hooks, plugins, history, proxy trust, or unrelated MCPs.
    function initializeConnection(cli) {
        var env=cli.env===undefined?{}:object(cli.env,'CLI env');
        Object.keys(env).forEach(function(k){
            if(/^(ANTHROPIC_(BASE_URL|AUTH_TOKEN|API_KEY|CUSTOM_HEADERS|MODEL|SMALL_FAST_MODEL|DEFAULT_.*_MODEL|.*_BASE_URL)|CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY))$/.test(k))delete env[k];
        });
        ['apiKeyHelper','forceLoginMethod','forceLoginGatewayUrl','forceLoginOrgUUID','model','smallFastModel'].forEach(function(k){delete cli[k];});
        cli.env=env;return env;
    }
    function privacyPlan(fs,paths) {
        var changes=[], clients=[], skipped=[];
        var metaRaw=fs.read(paths.desktop+'/_meta.json');
        if(metaRaw===null){
            if(fs.list(paths.desktop).some(function(n){return /\.json$/i.test(n);}))fail('桌面配置索引缺失，请先修复；本次未更新。');
            skipped.push('Desktop：未找到现有配置');
        }else{
            var meta=parse(metaRaw,'桌面配置索引');
            if(meta.hybridPointer)fail('桌面端由企业登录管理，请联系管理员更新隐私设置。');
            if(!Array.isArray(meta.entries)||typeof meta.appliedId!=='string')fail('桌面配置索引格式未知，本次未更新。');
            var seen={};meta.entries.forEach(function(e){
                if(!e||!ID.test(e.id)||seen[e.id]||typeof e.name!=='string')fail('桌面配置索引含无效或重复记录。');
                seen[e.id]=true;
            });
            if(meta.appliedId&&!seen[meta.appliedId])fail('当前桌面配置不在索引中，请先修复。');
            if(meta.appliedId){
                var path=paths.desktop+'/'+meta.appliedId+'.json',before=fs.read(path);
                if(before===null)fail('当前桌面配置文件缺失，请先修复。');
                var profile=parse(before,'当前桌面配置');
                if(profile.inferenceProvider==='gateway'&&gatewayUrl(profile.inferenceGatewayBaseUrl)){
                    if(profile.bootstrapUrl||profile.selfHosted||profile.sessionHost)fail('当前桌面配置由服务器管理，请联系管理员更新。');
                    desktopPrivacy(profile);clients.push('Desktop');
                    var after=json(profile);if(before!==after)changes.push({path:path,before:before,after:after});
                }else skipped.push('Desktop：当前启用的不是 Kividas 网关');
            }else skipped.push('Desktop：没有启用的网关配置');
        }
        var raw=fs.read(paths.cli);
        if(raw===null)skipped.push('CLI：未找到现有配置');
        else{
            var cli=parse(raw,'CLI settings.json');
            var env=cli.env===undefined?{}:object(cli.env,'CLI env');
            if(gatewayUrl(env.ANTHROPIC_BASE_URL)){
                cliPrivacy(env);cli.env=env;clients.push('CLI');
                var text=json(cli);if(raw!==text)changes.push({path:paths.cli,before:raw,after:text});
            }else skipped.push('CLI：当前配置未使用 Kividas 网关');
        }
        if(!clients.length)fail('没有找到当前启用的 Kividas 配置。请确认此电脑已接入 Kividas；无需重新生成 Key 或识别码。');
        return {changes:changes,clients:clients,skipped:skipped};
    }
    function keyOnly(key) {
        key=String(key||'').trim();
        if(!/^sk-kiv-desktop-[A-Za-z0-9_-]{40,128}$/.test(key)) fail('未找到完整的 Kividas 网关 Key。请读取原接入资料 TXT，或手动填写 Key。');
        return key;
    }
    function mcpPlan(fs,paths,key) {
        if(!paths.mcp) fail('缺少 MCP 配置位置。');
        var before=fs.read(paths.mcp), cfg=parse(before,'MCP .claude.json');
        var servers=cfg.mcpServers===undefined?{}:object(cfg.mcpServers,'MCP 列表');
        servers['kividas-usage']={type:'http',url:URL+'/mcp/usage',headers:{Authorization:'Bearer '+keyOnly(key)}};
        var legacy=servers['kividas-usage-remote'];
        if(legacy && legacy.type==='http' && legacy.url===URL+'/mcp/usage')delete servers['kividas-usage-remote'];
        cfg.mcpServers=servers;
        var after=json(cfg);return before===after?[]:[{path:paths.mcp,before:before,after:after}];
    }
    function existingKeys(fs,paths,openKey) {
        var out=[];
        function add(key,source){try{key=keyOnly(key);if(!out.some(function(x){return x.key===key;}))out.push({key:key,source:source});}catch(_){} }
        var raw=fs.read(paths.cli);
        if(raw!==null){var cli=parse(raw,'CLI settings.json'),env=cli.env||{};if(env.ANTHROPIC_BASE_URL===URL||env.ANTHROPIC_BASE_URL===URL+'/')add(env.ANTHROPIC_AUTH_TOKEN||env.ANTHROPIC_API_KEY,'Claude Code CLI');}
        var metaRaw=fs.read(paths.desktop+'/_meta.json');
        if(metaRaw!==null){
            var meta=parse(metaRaw,'桌面配置索引');
            if(ID.test(meta.appliedId)&&!meta.hybridPointer){
                var profileRaw=fs.read(paths.desktop+'/'+meta.appliedId+'.json');
                if(profileRaw!==null){var cfg=parse(profileRaw,'桌面配置');
                    if(cfg.inferenceProvider==='gateway'&&(cfg.inferenceGatewayBaseUrl===URL||cfg.inferenceGatewayBaseUrl===URL+'/')){
                        var key=cfg.inferenceGatewayApiKey;
                        if(typeof key==='string'&&key.indexOf('__sealed__:v1:')===0)key=openKey?openKey(key):null;
                        add(key,'Claude Desktop');
                    }
                }
            }
        }
        return out;
    }
    function repairLegacyAlias(raw, officialCli) {
        if (raw === null) return null;
        function quote(s) { return "'"+s.replace(/'/g,"'\\''")+"'"; }
        return raw.split('\n').map(function(line) {
            var m=/^[ \t]*alias[ \t]+claude[ \t]*=[ \t]*(['"])([^\r\n]*)\1[ \t]*(?:#.*)?\r?$/.exec(line);
            if (!m) return line;
            var value=m[2].trim();
            if ((value[0]==='"'||value[0]==="'") && value[value.length-1]===value[0]) value=value.slice(1,-1);
            if(value!=='/Applications/Kividas Code.app/Contents/Resources/cli/claude')return line;
            if(!officialCli)fail('检测到旧 Kividas 的 claude 命令入口，但未找到可用的官方 Claude Code CLI。请先安装官方 CLI，再重新运行配置；安装过旧 Kividas 桌面端不代表已安装官方 CLI。本次未修改配置。');
            // Quote twice: once for shell assignment, once for alias expansion.
            // An absolute executable avoids a stale Kividas PATH entry winning.
            return 'alias claude='+quote(quote(officialCli))+' # Kividas setup: official Claude Code CLI'+(/\r$/.test(line)?'\r':'');
        }).join('\n');
    }
    function plan(fs, paths, target, credentials) {
        if(target==='privacy')return privacyPlan(fs,paths).changes;
        if(target==='mcp')return mcpPlan(fs,paths,credentials.key);
        var creds = validate(credentials.key, credentials.id), changes = [];
        function add(path, data) { changes.push({path:path, before:fs.read(path), after:json(data)}); }
        if (['both','desktop','cli'].indexOf(target) < 0) fail('请选择桌面端、CLI 或两者。');
        if (target !== 'cli') {
            var metaPath = paths.desktop + '/_meta.json', raw = fs.read(metaPath);
            if (raw === null && fs.list(paths.desktop).some(function(n){ return /\.json$/i.test(n); }))
                fail('桌面配置目录已有文件，但缺少 _meta.json。请先检查原配置，避免建立重复配置。');
            var meta = raw === null ? {appliedId:'',entries:[]} : parse(raw, '桌面配置索引');
            if (meta.hybridPointer) fail('桌面端正在使用企业托管登录，请先通过原配置方式退出该部署。');
            if (!Array.isArray(meta.entries) || typeof meta.appliedId !== 'string') fail('桌面配置索引格式未知，请更新工具或联系服务方。');
            var seen = {}, candidates = [];
            meta.entries.forEach(function(e) {
                if (!e || !ID.test(e.id) || seen[e.id] || typeof e.name !== 'string') fail('桌面配置索引含无效或重复记录。');
                seen[e.id] = true;
                var content = fs.read(paths.desktop + '/' + e.id + '.json');
                if (content === null) fail('桌面配置索引引用了缺失的配置文件，请先修复。');
                var cfg = parse(content, '桌面已存配置');
                if (cfg.inferenceGatewayBaseUrl === URL && !cfg.bootstrapUrl && (e.id === meta.appliedId || e.name === 'Kividas'))
                    candidates.push({entry:e,config:cfg});
            });
            if (meta.appliedId && !seen[meta.appliedId]) fail('桌面当前配置不在索引中，请先修复。');
            var active = candidates.filter(function(x){return x.entry.id===meta.appliedId;})[0];
            if (!active && candidates.length > 1) fail('找到多份 Kividas 配置，无法确定应更新哪一份。');
            active = active || candidates[0];
            var entry = active ? active.entry : {id:fs.uuid(),name:'Kividas'};
            var profile = active ? active.config : {};
            if (!ID.test(entry.id)) fail('无法创建桌面配置 ID。');
            if (!active && fs.read(paths.desktop+'/'+entry.id+'.json') !== null) fail('新配置 ID 发生冲突，请重试。');
            // The previous header set is backed up with the whole profile.
            // Rebuild it so another gateway's identifiers/auth do not persist.
            var headers = {'X-Kividas-Device-ID':creds.id,'X-Kividas-Config-Version':'v1'};
            profile.inferenceProvider='gateway'; profile.inferenceCredentialKind='static';
            profile.inferenceGatewayBaseUrl=URL; profile.inferenceGatewayApiKey=creds.key;
            profile.inferenceGatewayAuthScheme='bearer'; profile.inferenceCustomHeaders=headers;
            profile.modelDiscoveryEnabled=true; profile.isClaudeCodeForDesktopEnabled=true;
            profile.toolSearchEnabled=true;
            desktopPrivacy(profile);
            delete profile.inferenceModels;
            if (!profile.deploymentDisplayName) profile.deploymentDisplayName='Kividas';
            if (!active) meta.entries.push(entry);
            meta.appliedId=entry.id;
            add(paths.desktop+'/'+entry.id+'.json',profile);
            add(metaPath,meta);
            if(paths.desktopMode){
                var mode=parse(fs.read(paths.desktopMode),'桌面启动方式');
                mode.deploymentMode='3p';add(paths.desktopMode,mode);
            }
            if(paths.desktopStartup){
                if(typeof fs.envRead!=='function'||typeof fs.envWrite!=='function')fail('当前配置工具不支持桌面启动环境。');
                changes.push({kind:'environment',name:STARTUP_FLAG,before:fs.envRead(STARTUP_FLAG),after:'1'});
                if(paths.startupFile){
                    if(typeof paths.startupText!=='string')fail('缺少桌面启动设置。');
                    changes.push({path:paths.startupFile,before:fs.read(paths.startupFile),after:paths.startupText});
                }
            }
        }
        if (target !== 'desktop') {
            var cli = parse(fs.read(paths.cli),'CLI settings.json');
            var env = initializeConnection(cli);
            env.ANTHROPIC_BASE_URL=URL; env.ANTHROPIC_AUTH_TOKEN=creds.key;
            env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL='1';
            env.ANTHROPIC_CUSTOM_HEADERS='X-Kividas-Device-ID: '+creds.id+'\nX-Kividas-Config-Version: v1'; env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='1';
            cliPrivacy(env);
            var orderedEnv=Object.create(null);
            Object.keys(env).sort().forEach(function(k){orderedEnv[k]=env[k];});
            cli.env=orderedEnv; cli.promptCacheTtl='1h'; add(paths.cli,cli);
            (paths.shellFiles||[]).forEach(function(path) {
                var before=fs.read(path), after=repairLegacyAlias(before,paths.officialCli);
                if(before!==after)changes.push({path:path,before:before,after:after});
            });
        }
        // Desktop Code shares this cache setting; preserve CLI access credentials.
        if(target==='desktop'){
            var shared=parse(fs.read(paths.cli),'Code settings.json');
            shared.promptCacheTtl='1h'; add(paths.cli,shared);
        }
        if(paths.mcp)changes=changes.concat(mcpPlan(fs,paths,creds.key));
        return changes.filter(function(x){return x.before!==x.after;});
    }
    function commit(fs, changes, backup) {
        if (!changes.length) return false;
        changes.forEach(function(x){if(current(fs,x)!==x.before) fail('配置在操作期间被其他程序更改，请退出客户端后重试。');});
        var manifest={version:1,status:'pending',restored:false,entries:changes};
        fs.write(backup,json(manifest));
        var written=[];
        try {
            changes.forEach(function(x){
                if(current(fs,x)!==x.before) fail('检测到配置被同时修改。');
                written.push(x); put(fs,x,x.after);
                if(current(fs,x)!==x.after) fail('配置写入校验失败。');
            });
            manifest.status='applied';fs.write(backup,json(manifest));
        } catch(e) {
            var errors=0;
            written.reverse().forEach(function(x){try{put(fs,x,x.before);}catch(_){errors++;}});
            manifest.status=errors?'partial':'rolled_back';try{fs.write(backup,json(manifest));}catch(_){}
            fail(errors ? '写入失败，部分恢复未完成。请保留备份并联系服务方。' : '写入失败，本次更改已恢复。请检查文件权限后重试。');
        }
        return true;
    }
    function restore(fs, backup, paths) {
        var m=parse(fs.read(backup),'备份');
        if(m.version!==1 || m.status!=='applied' || m.restored || !Array.isArray(m.entries)) fail('该备份不可恢复或已经恢复过。');
        m.entries.forEach(function(x){
            if(x.kind==='environment'){
                if(!paths.desktopStartup||x.name!==STARTUP_FLAG||x.after!=='1')fail('备份包含意外环境设置，已停止。');
            }else{
                if(x.kind!==undefined||typeof x.path!=='string')fail('备份内容格式不正确。');
                var name=x.path.slice(paths.desktop.length+1);
                if(x.path!==paths.cli && x.path!==paths.mcp && x.path!==paths.desktopMode && x.path!==paths.startupFile && (paths.shellFiles||[]).indexOf(x.path)<0 && !(x.path.indexOf(paths.desktop+'/')===0 && (name==='_meta.json'||ID.test(name.replace(/\.json$/,''))&&/\.json$/.test(name)))) fail('备份包含意外路径，已停止。');
            }
            if(typeof x.after!=='string'||!(x.before===null||typeof x.before==='string')) fail('备份内容格式不正确。');
            if(current(fs,x)!==x.after) fail('配置在运行工具后又被修改。为保留后续更改，本次不自动恢复，请联系服务方使用备份。');
        });
        var done=[];
        try {
            m.entries.slice().reverse().forEach(function(x){done.push(x);put(fs,x,x.before);});
        } catch(e) {
            done.reverse().forEach(function(x){try{put(fs,x,x.after);}catch(_){}});
            fail('恢复未完成，请保留备份并检查文件权限。');
        }
        m.restored=true;fs.write(backup,json(m));return true;
    }
    return {validate:validate,keyOnly:keyOnly,existingKeys:existingKeys,fromText:fromText,parse:parse,privacyPlan:privacyPlan,plan:plan,commit:commit,restore:restore};
}());
if (typeof module !== 'undefined') module.exports=Kivi;
