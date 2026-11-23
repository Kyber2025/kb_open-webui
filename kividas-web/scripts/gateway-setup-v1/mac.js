ObjC.import('Foundation');
ObjC.import('AppKit');
var fm=$.NSFileManager.defaultManager;
function exists(p){return fm.fileExistsAtPath($(p));}
function safePath(p){
    var current=p;
    while(current && current!=='/'){
        if(exists(current)){
            var a=fm.attributesOfItemAtPathError($(current),null);
            if(ObjC.unwrap(a.objectForKey($.NSFileType))===ObjC.unwrap($.NSFileTypeSymbolicLink)) throw Error('配置路径含符号链接，请联系服务方确认位置。');
        }
        current=current.substring(0,current.lastIndexOf('/'));
    }
}
function read(p){
    safePath(p);if(!exists(p))return null;
    var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);
    if(!s)throw Error('无法读取配置文件，请检查权限和 UTF-8 编码。');
    return ObjC.unwrap(s);
}
function mkdir(p){
    safePath(p);
    if(!exists(p)&&!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(p),true,$({NSFilePosixPermissions:448}),null)) throw Error('无法创建配置目录。');
}
function write(p,s){
    safePath(p);mkdir(p.substring(0,p.lastIndexOf('/')));
    if(!$(s).writeToFileAtomicallyEncodingError($(p),true,$.NSUTF8StringEncoding,null))throw Error('无法写入配置文件。');
    if(!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384}),$(p),null))throw Error('无法设置配置文件权限。');
}
function list(p){safePath(p);return exists(p)?ObjC.unwrap(fm.contentsOfDirectoryAtPathError($(p),null)):[];}
function remove(p){safePath(p);if(exists(p)&&!fm.removeItemAtPathError($(p),null))throw Error('无法恢复文件。');}
var fs={read:read,write:write,list:list,remove:remove,uuid:function(){return ObjC.unwrap($.NSUUID.UUID.UUIDString).toLowerCase();}};
function launchEnvironment(args){
    var task=$.NSTask.alloc.init,output=$.NSPipe.pipe;
    task.launchPath='/bin/launchctl';task.arguments=args;
    task.standardOutput=output;task.standardError=$.NSPipe.pipe;task.launch;
    var value=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(output.fileHandleForReading.readDataToEndOfFile,$.NSUTF8StringEncoding));
    task.waitUntilExit;return {status:Number(task.terminationStatus),value:value.replace(/\n$/,'')};
}
function assertStartupName(name){if(name!=='_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL')throw Error('未知桌面启动设置。');}
fs.envRead=function(name){assertStartupName(name);var r=launchEnvironment(['getenv',name]);if(r.status===0)return r.value;if(r.status===1)return null;throw Error('无法读取桌面启动环境。');};
fs.envWrite=function(name,value){assertStartupName(name);var r=launchEnvironment(value===null?['unsetenv',name]:['setenv',name,value]);if(r.status!==0)throw Error('无法更新桌面启动环境。');};
function desktopStartupPaths(paths,home){
    paths.desktopMode=home+'/Library/Application Support/Claude-3p/claude_desktop_config.json';
    paths.desktopStartup=true;
    paths.startupFile=home+'/Library/LaunchAgents/com.kividas.claude-startup-v1.plist';
    // One built-in OS command at login; no daemon, helper executable or credentials.
    paths.startupText='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.kividas.claude-startup-v1</string><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL</string><string>1</string></array><key>RunAtLoad</key><true/></dict></plist>\n';
}
function shellFiles(home){return ['.zshrc','.zprofile','.zshenv','.zlogin','.bashrc','.bash_profile','.profile'].map(function(n){return home+'/'+n;});}
function officialCli(home){
    return [home+'/.local/bin/claude','/opt/homebrew/bin/claude','/usr/local/bin/claude'].filter(function(p){
        var resolved=ObjC.unwrap($(p).stringByResolvingSymlinksInPath);
        return fm.isExecutableFileAtPath($(p)) && !/\/Kividas Code\.app\/|\/\.kividas\//.test(resolved);
    })[0];
}
function checkMcpKey(key){
    if(!/^sk-kiv-desktop-[A-Za-z0-9_-]{40,128}$/.test(key))throw Error('网关 Key 格式不正确。');
    var payload=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'kividas-setup',version:'1.1'}}});
    var task=$.NSTask.alloc.init, input=$.NSPipe.pipe, output=$.NSPipe.pipe;
    task.launchPath='/usr/bin/curl';
    task.arguments=['--silent','--show-error','--proto','=https','--tlsv1.2','--max-time','15','--request','POST','--header','Content-Type: application/json','--header','Accept: application/json, text/event-stream','--data-binary',payload,'--config','-','--write-out','\\n%{http_code}','https://ai.kividas.com/api/mcp/usage'];
    task.standardInput=input;task.standardOutput=output;task.standardError=$.NSPipe.pipe;
    task.launch;
    input.fileHandleForWriting.writeData($('header = "Authorization: Bearer '+key+'"\n').dataUsingEncoding($.NSUTF8StringEncoding));
    input.fileHandleForWriting.closeFile;
    var raw=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(output.fileHandleForReading.readDataToEndOfFile,$.NSUTF8StringEncoding));
    task.waitUntilExit;
    if(task.terminationStatus!==0)throw Error('暂时无法连接用量服务，请联网后重试。本次未修改配置。');
    var cut=raw.lastIndexOf('\n'), status=Number(raw.substring(cut+1));
    if(status===401||status===403)return false;
    if(status!==200)throw Error('用量服务暂不可用，请稍后重试。本次未修改配置。');
    var reply=JSON.parse(raw.substring(0,cut));
    if(!reply.result||!reply.result.serverInfo||reply.result.serverInfo.name!=='kividas-usage')throw Error('用量服务响应不正确，本次未修改配置。');
    return true;
}
function setupMenu(){
    var alert=$.NSAlert.alloc.init;
    alert.messageText='配置 Claude';
    alert.informativeText='KIVIDAS  ·  V1.1\n\n一次完成接入初始化、用量 MCP 和遥测设置。';
    alert.addButtonWithTitle('继续');alert.addButtonWithTitle('取消');
    var view=$.NSView.alloc.initWithFrame($.NSMakeRect(0,0,440,126));
    function label(text,y,size,color){
        var field=$.NSTextField.labelWithString(text);
        field.frame=$.NSMakeRect(0,y,440,25);field.font=$.NSFont.systemFontOfSize(size);
        field.textColor=color;view.addSubview(field);
    }
    label('选择要配置的客户端',97,13,$.NSColor.labelColor);
    var choice=$.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0,58,440,32),false);
    choice.addItemsWithTitles(['一键配置 · 桌面端与 CLI','仅配置桌面端','仅配置 CLI','恢复上一次配置']);
    view.addSubview(choice);
    label('自动备份原配置，可随时恢复。',25,12,$.NSColor.secondaryLabelColor);
    label('请先保存任务，并完全退出 Claude。',2,12,$.NSColor.secondaryLabelColor);
    alert.accessoryView=view;
    $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
    if(Number(alert.runModal)!==1000)throw Error('cancelled');
    return ['both','desktop','cli','restore'][Number(choice.indexOfSelectedItem)];
}
function run(args){
    var packageDir=args[0];
    eval(read(packageDir+'/core.js'));
    if(args[1]==='--preview-menu'){try{return setupMenu();}catch(e){return 'cancelled';}}
    // Test entry point only uses an explicit temporary tree, never the account's config.
    if(args[1]==='--fixture'){
        var request=JSON.parse(read(args[2]));
        var root=request.root;
        if(!/^\/private\/tmp\/kividas-fixture-[a-zA-Z0-9_-]+$/.test(root))throw Error('Invalid fixture root');
        var testPaths={desktop:root+'/desktop',cli:root+'/cli/settings.json',mcp:root+'/.claude.json',shellFiles:shellFiles(root),officialCli:officialCli(root)};
        if(request.startup===true)desktopStartupPaths(testPaths,root);
        if(request.action==='restore'){Kivi.restore(fs,root+'/backup.json',testPaths);return 'restored';}
        var changes=Kivi.plan(fs,testPaths,request.target,request.credentials);
        Kivi.commit(fs,changes,root+'/backup.json');return 'configured '+changes.length;
    }
    var app=Application.currentApplication();app.includeStandardAdditions=true;
    var home=ObjC.unwrap($.NSHomeDirectory());
    var paths={desktop:home+'/Library/Application Support/Claude-3p/configLibrary',cli:home+'/.claude/settings.json',mcp:home+'/.claude.json'};
    desktopStartupPaths(paths,home);
    paths.shellFiles=shellFiles(home);
    paths.officialCli=officialCli(home);
    var backups=home+'/Library/Application Support/KividasSetup/backups';
    function dialog(s){return app.displayDialog(s,{withTitle:'Kividas 一键配置 · V1.1',buttons:['好'],defaultButton:'好'});}
    function choose(items,prompt){var result=app.chooseFromList(items,{withTitle:'Kividas 一键配置',withPrompt:prompt,defaultItems:[items[0]],multipleSelectionsAllowed:false});if(result===false)throw Error('cancelled');return result[0];}
    function privacyUpdate(restore){
        if(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('CLAUDE_CONFIG_DIR')) || ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('CLAUDE_USER_DATA_DIR')))throw Error('检测到自定义配置目录，请联系服务方适配该位置。');
        if($.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.anthropic.claudefordesktop').count>0)throw Error('请先保存任务，在 Claude 菜单选择 Quit Claude，并结束 CLI 会话，再运行更新。');
        ['/Library/Managed Preferences/com.anthropic.claudefordesktop.plist','/Library/Managed Preferences/'+ObjC.unwrap($.NSUserName())+'/com.anthropic.claudefordesktop.plist','/Library/Application Support/ClaudeCode/managed-settings.json'].forEach(function(p){if(exists(p))throw Error('此电脑有 Claude 管理策略，请联系管理员更新隐私设置。');});
        if(restore){
            var pending=list(backups).filter(function(n){return /^\d.*-privacy-.*\.json$/.test(n);}).sort().reverse().filter(function(n){var m=Kivi.parse(read(backups+'/'+n),'备份');return m.status==='applied'&&!m.restored;});
            if(!pending.length)throw Error('没有可以恢复的隐私更新备份。');
            Kivi.restore(fs,backups+'/'+pending[0],paths);return '已恢复上一次隐私设置。请重新打开 Claude 和 CLI。';
        }
        var plan=Kivi.privacyPlan(fs,paths);
        var backup=backups+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-privacy-'+fs.uuid()+'.json';
        var changed=Kivi.commit(fs,plan.changes,backup);
        var verify=Kivi.privacyPlan(fs,paths);
        if(verify.changes.length||verify.clients.join(',')!==plan.clients.join(','))throw Error('更新后配置又发生变化，请保留备份并联系服务方。');
        return (changed?'隐私设置已更新并备份。':'隐私设置已经关闭，无需重复更新。')+'\n已核对：'+plan.clients.join('、')+(plan.skipped.length?'\n'+plan.skipped.join('\n'):'')+'\n\n请重新打开 Claude 和 CLI，新建会话后测试对话和工具调用。\n不需要重新登录、填写 Key 或安装识别码。\n本工具只验证本机配置；正常联网与工具调用需在新会话确认。\n如需撤销，运行同目录的“恢复Mac.sh”。';
    }
    // Dedicated pilot launchers update existing files without opening dialogs,
    // inspecting credentials, contacting the gateway or creating an identity.
    if(args[1]==='--privacy-only'||args[1]==='--restore-privacy')return privacyUpdate(args[1]==='--restore-privacy');
    try{
        var action=setupMenu(),target=action==='restore'?'both':action;
        if(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('CLAUDE_CONFIG_DIR')) || ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('CLAUDE_USER_DATA_DIR')))throw Error('检测到自定义配置目录，请联系服务方适配该位置。');
        if($.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.anthropic.claudefordesktop').count>0)throw Error('桌面与 CLI 共用部分配置。请先保存任务，退出 Claude 并结束 CLI 会话，再运行工具。');
        if(target!=='cli'){
            [' /Library/Managed Preferences/com.anthropic.claudefordesktop.plist','/Library/Managed Preferences/'+ObjC.unwrap($.NSUserName())+'/com.anthropic.claudefordesktop.plist'].forEach(function(p){if(exists(p.trim()))throw Error('此电脑有 Claude 管理配置，请联系管理员；工具不会覆盖它。');});
        }
        if(target!=='desktop'&&exists('/Library/Application Support/ClaudeCode/managed-settings.json'))throw Error('CLI 已有管理策略，请联系管理员确认接入方式。');
        if(action==='restore'){
            var names=list(backups).filter(function(n){return /^\d.*\.json$/.test(n);}).sort().reverse();
            var pending=names.filter(function(n){var m=Kivi.parse(read(backups+'/'+n),'备份');return m.status==='applied'&&!m.restored;});
            if(!pending.length)throw Error('没有可以恢复的备份。');
            Kivi.restore(fs,backups+'/'+pending[0],paths);dialog('已恢复上一次配置。请重新打开对应客户端。');return;
        }
        var creds=null, selectedSource='接入资料';
        if(target==='mcp'){
            var candidates=Kivi.existingKeys(fs,paths);
            for(var c=0;c<candidates.length;c++){
                var check=checkMcpKey(candidates[c].key);
                if(check){creds={key:candidates[c].key};selectedSource=candidates[c].source;break;}
            }
        }
        if(!creds){
            var source=choose(['读取客户接入资料 TXT','手动填写 Key'+(target==='mcp'?'':' 和识别码')],target==='mcp'?'未读取到有效明文配置。可导入原接入资料；不会要求钥匙串或管理员密码。':'读取原客户接入资料，网关和用量 MCP 会一起配置。');
            if(source==='读取客户接入资料 TXT'){
                var file=app.chooseFile({withPrompt:'选择客户接入资料 TXT',ofType:['txt']});
                creds=Kivi.fromText(read(String(file)));
            }else{
                var key=app.displayDialog('粘贴完整 Gateway API key：',{withTitle:'Kividas 一键配置',defaultAnswer:'',hiddenAnswer:true}).textReturned;
                if(target==='mcp')creds={key:Kivi.keyOnly(key)};
                else{var id=app.displayDialog('粘贴与这个 Key 配套的安装识别码：',{withTitle:'Kividas 一键配置',defaultAnswer:''}).textReturned;creds=Kivi.validate(key,id);}
            }
            if(!checkMcpKey(creds.key))throw Error('Key 无效或订阅暂不可用，请核对原接入资料。本次未修改配置。');
        }
        var changes=Kivi.plan(fs,paths,target,creds);
        var backup=backups+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+fs.uuid()+'.json';
        var changed=Kivi.commit(fs,changes,backup);
        if(target==='mcp'){dialog((changed?'用量 MCP 已接入并自动备份。':'用量 MCP 已配置，无需重复写入。')+'\n身份来源：'+selectedSource+'\n\n请重新打开 Claude Code 会话，再说“查询我的 Kividas 用量”。原网关配置保持不变。');return;}
        var repaired=changes.some(function(x){return paths.shellFiles.indexOf(x.path)>=0;});
        dialog((changed?'已完成接入初始化、用量 MCP 配置，并关闭遥测与错误上报。\n原配置已自动备份；项目文件、记忆和历史记录保留。':'配置已经一致，无需重复写入。')+(repaired?'\n已修复旧 Claude 命令入口，请打开新的终端窗口。':'')+'\n\n重新打开 Claude，并新建会话。桌面首次可能需要 Continue。桌面启动设置已配置，无需安装辅助程序。\n\nCLI 可用 /status 检查连接，再发送一条消息。\n需要撤销时，运行本工具并选择“恢复上一次配置”。');
    }catch(e){if(String(e).indexOf('cancelled')>=0||e.errorNumber===-128)return;dialog(String(e.message||e));}
}
