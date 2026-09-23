import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {authorizationPath,connectorURL,newConnection,connectorsApi,installPlugin,ownedPluginSkills,pluginSkillForm,type PluginBundle,type ToolConnection} from '../src/lib/marketplace';
import {skillsApi,type Skill} from '../src/lib/skills';
const bundle:PluginBundle={id:'data',name:'Data',description:'Data skills',author:'Anthropic',version:'1',category:'data',skillCount:2,source:'',revision:'test',connectors:[],hasScripts:false,skills:[{id:'sql',name:'SQL',description:'Queries',content:'Check schema.'},{id:'charts',name:'Charts',description:'Charts',content:'Label units.'}]};
beforeEach(()=>{vi.stubGlobal('crypto',{randomUUID:()=> 'unique-id'});vi.stubGlobal('localStorage',{getItem:()=>null});});afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('plugin installs',()=>{
 it('stores private instructions with stable component tags and provenance',()=>{const form=pluginSkillForm(bundle,bundle.skills[0]);expect(form.access_grants).toEqual([]);expect(form.content).toBe('Check schema.');expect(form.meta.tags).toContain('kividas-plugin:data');expect(form.meta.tags).toContain('kividas-plugin-skill:sql');});
 it('excludes shared skills owned by someone else from manage/uninstall',()=>{const form=pluginSkillForm(bundle,bundle.skills[0]);expect(ownedPluginSkills([{...form,user_id:'other'}],'me','data')).toEqual([]);});
 it('retries partial installs without duplicating skills already saved',async()=>{let stored:Skill[]=[];vi.spyOn(skillsApi,'all').mockImplementation(async()=>stored);let fail=true;const create=vi.spyOn(skillsApi,'create').mockImplementation(async form=>{if(form.name==='Charts'&&fail)throw new Error('Network interrupted');const item={...form,user_id:'me'};stored.push(item);return item;});await expect(installPlugin(bundle,['sql','charts'],'me',()=>{})).rejects.toThrow('Network interrupted');expect(stored).toHaveLength(1);fail=false;await installPlugin(bundle,['sql','charts'],'me',()=>{});expect(stored.map(s=>s.name)).toEqual(['SQL','Charts']);expect(create).toHaveBeenCalledTimes(3);});
});
describe('connector configuration',()=>{
 it('keeps a new server private and sends API tokens only in the key field',()=>{const c=newConnection('Private','https://mcp.example.test/mcp','me','bearer','secret');expect(c.config.access_grants).toEqual([{principal_type:'user',principal_id:'me',permission:'read'}]);expect(c.key).toBe('secret');expect(c.url).not.toContain('secret');});
 it('rejects credential URLs and non-HTTPS addresses',()=>{for(const url of ['javascript:alert(1)','http://mcp.example.test','https://user:secret@mcp.example.test','https://mcp.example.test/#secret'])expect(()=>connectorURL(url)).toThrow();});
 it('preserves unrelated servers including unknown configuration fields',async()=>{const old={url:'https://existing.test/mcp',info:{id:'existing'},custom:{keep:true}} as unknown as ToolConnection;vi.spyOn(connectorsApi,'config').mockResolvedValue({TOOL_SERVER_CONNECTIONS:[old]});const fetch=vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);const next=newConnection('New','https://new.test/mcp','me','none','');await connectorsApi.add(next);expect(JSON.parse(fetch.mock.calls[0][1].body).TOOL_SERVER_CONNECTIONS).toEqual([old,next]);});
 it('rejects duplicate server URLs before overwriting config',async()=>{const c=newConnection('New','https://new.test/mcp','me','none','');vi.spyOn(connectorsApi,'config').mockResolvedValue({TOOL_SERVER_CONNECTIONS:[c]});await expect(connectorsApi.add(c)).rejects.toThrow('already configured');});
 it('builds a same-origin authorization route without a token in the URL',()=>{expect(authorizationPath('server:mcp:notion')).toBe('/oauth/clients/mcp%3Anotion/authorize');expect(()=>authorizationPath('https://evil.test')).toThrow();});
});

describe('bundled public catalog',()=>{
 it('ships matching bundles, attribution and readable skill metadata',async()=>{
  const {readFile}=await import('node:fs/promises');
  const base=new URL('../public/catalog/plugins/',import.meta.url);
  const index=JSON.parse(await readFile(new URL('index.json',base),'utf8'));
  let count=0;
  for(const entry of index){
   const pack=JSON.parse(await readFile(new URL(`${entry.id}.json`,base),'utf8')) as PluginBundle;
   expect(pack.skills).toHaveLength(entry.skillCount);
   expect(pack.source).toContain('github.com/anthropics/knowledge-work-plugins/tree/');
   expect(new Set(pack.skills.map(s=>s.id)).size).toBe(pack.skills.length);
   for(const skill of pack.skills){expect(skill.content.length).toBeGreaterThan(30);expect(skill.description.length).toBeGreaterThan(5);}
   count+=pack.skills.length;
  }
  expect(index).toHaveLength(17);expect(count).toBe(181);
 });
});
