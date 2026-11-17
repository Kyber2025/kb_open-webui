const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname+'/gateway-setup-v1/core.js','utf8'),context);
const K=context.Kivi;
const key='sk-kiv-desktop-'+'A'.repeat(43),id='00000000-0000-4000-8000-000000000001';
const paths={desktop:'/d',cli:'/c/settings.json',mcp:'/c/.claude.json'};
function memory(seed={}){const files={...seed};let fail;return {files,read:p=>Object.hasOwn(files,p)?files[p]:null,write:(p,x)=>{if(p===fail){fail=null;throw Error('injected');}files[p]=x;},remove:p=>delete files[p],list:p=>Object.keys(files).filter(x=>x.startsWith(p+'/')).map(x=>x.slice(p.length+1)),uuid:()=>id,fail:p=>{fail=p;}};}
let cases=0;
for(const target of ['desktop','cli','both']){
 const old=JSON.stringify({promptCacheTtl:'5m',env:{KEEP:'value',ANTHROPIC_AUTH_TOKEN:'another-provider',CLAUDE_CODE_PROMPT_CACHE_TTL:'5m',FORCE_PROMPT_CACHING_5M:'1',CLAUDE_CODE_MESSAGES_PROMPT_CACHE_TTL:'5m'},permissions:{allow:['Read']}});
 const f=memory({[paths.cli]:old});const plan=K.plan(f,paths,target,{key,id});
 K.commit(f,plan,'/backup');
 const shared=JSON.parse(f.files[paths.cli]);assert.equal(shared.promptCacheTtl,'1h');assert.equal(shared.env.CLAUDE_CODE_PROMPT_CACHE_TTL,'1h');assert.equal(shared.env.FORCE_PROMPT_CACHING_5M,'0');assert.equal(shared.env.CLAUDE_CODE_MESSAGES_PROMPT_CACHE_TTL,'');assert.equal(shared.subagentPromptCacheTtl,undefined);assert.equal(shared.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL,undefined);assert.equal(shared.env.KEEP,'value');assert.deepEqual(shared.permissions,{allow:['Read']});
 if(target!=='cli'){const p=JSON.parse(f.files['/d/'+id+'.json']);assert.equal(p.toolSearchEnabled,true);assert.equal(p.inferenceGatewayAuthScheme,'bearer');assert.equal(p.inferenceCustomHeaders['X-Kividas-Config-Version'],'v1');}
 if(target==='desktop')assert.equal(shared.env.ANTHROPIC_AUTH_TOKEN,'another-provider');
 else assert.equal(shared.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL,'1');
 assert.equal(K.plan(f,paths,target,{key,id}).length,0);
 K.restore(f,'/backup',paths);assert.equal(f.files[paths.cli],old);assert(!f.files['/d/_meta.json']);assert(!f.files[paths.mcp]);cases++;
}
{
 const f=memory({[paths.cli]:'{"env":{"KEEP":"x"}}'});const before={...f.files};f.fail(paths.cli);
 assert.throws(()=>K.commit(f,K.plan(f,paths,'both',{key,id}),'/backup'));
 for(const [p,v] of Object.entries(before))assert.equal(f.files[p],v);
 assert(!f.files['/d/_meta.json']);cases++;
}
{
 const f=memory({[paths.cli]:'{broken'});assert.throws(()=>K.plan(f,paths,'desktop',{key,id}));assert.deepEqual(f.files,{[paths.cli]:'{broken'});cases++;
}
for(const original of [null,'0','custom']){
 const p={...paths,desktopMode:'/d-mode.json',desktopStartup:true,startupFile:'/agents/kivi.plist',startupText:'synthetic startup plist'};
 const f=memory({[p.desktopMode]:'{"deploymentMode":"1p","keep":true}'});let env=original;
 f.envRead=()=>env;f.envWrite=(_,v)=>{env=v;};
 K.commit(f,K.plan(f,p,'both',{key,id}),'/backup');
 assert.equal(env,'1');assert.equal(JSON.parse(f.files[p.desktopMode]).deploymentMode,'3p');
 assert.equal(K.plan(f,p,'both',{key,id}).length,0);
 K.restore(f,'/backup',p);assert.equal(env,original);assert.equal(f.files[p.desktopMode],'{"deploymentMode":"1p","keep":true}');assert(!f.files[p.startupFile]);cases++;
}
{
 const p={...paths,desktopStartup:true,startupFile:'/agents/kivi.plist',startupText:'synthetic'};
 const f=memory();let env=null;f.envRead=()=>env;f.envWrite=(_,v)=>{env=v;};f.fail(p.startupFile);
 assert.throws(()=>K.commit(f,K.plan(f,p,'desktop',{key,id}),'/backup'));
 assert.equal(env,null);assert(!f.files['/d/_meta.json']);cases++;
}
{
 const f=memory();let env=null;f.envRead=()=>env;f.envWrite=(_,v)=>{env=v;};
 const p={...paths,desktopStartup:true};K.commit(f,K.plan(f,p,'desktop',{key,id}),'/backup');
 env='external-change';assert.throws(()=>K.restore(f,'/backup',p));assert.equal(env,'external-change');cases++;
}
for(const target of ['desktop','cli','both']){
 for(const subagent of [undefined,'5m','1h']){
  const seed={env:{HTTPS_PROXY:'http://local-proxy',ENABLE_PROMPT_CACHING_1H:'0'},hooks:{Stop:[]},permissions:{allow:['Read']}};
  if(subagent){seed.subagentPromptCacheTtl=subagent;seed.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=subagent;}
  const old=JSON.stringify(seed),f=memory({[paths.cli]:old});
  K.commit(f,K.plan(f,paths,target,{key,id}),'/backup');
  const settings=JSON.parse(f.files[paths.cli]);
  assert.equal(settings.subagentPromptCacheTtl,subagent);assert.equal(settings.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL,subagent);
  assert.equal(settings.env.ENABLE_PROMPT_CACHING_1H,'0');assert.equal(settings.env.HTTPS_PROXY,seed.env.HTTPS_PROXY);assert.deepEqual(settings.hooks,seed.hooks);
  K.restore(f,'/backup',paths);assert.equal(f.files[paths.cli],old);cases++;
 }
 for(const env of [null,[],true,'bad']){
  const raw=JSON.stringify({env}),f=memory({[paths.cli]:raw});assert.throws(()=>K.plan(f,paths,target,{key,id}));assert.deepEqual(f.files,{[paths.cli]:raw});cases++;
 }
}
console.log(JSON.stringify({passed:cases,scope:'configuration, startup environment, deployment selection, idempotence, exact restoration, failure rollback, concurrent edit protection'}));
