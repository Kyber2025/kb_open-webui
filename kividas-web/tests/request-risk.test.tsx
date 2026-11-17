// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RiskManagement, RiskRules, OverrideEditor } from '../src/pages/RiskManagement';
import { riskApi, type RiskPolicyState } from '../src/lib/request-risk';
vi.mock('../src/lib/request-risk',async original=>({...await original<typeof import('../src/lib/request-risk')>(),
  riskApi:{policy:vi.fn(),events:vi.fn(),overrides:vi.fn(),savePolicy:vi.fn(),saveOverride:vi.fn(),test:vi.fn()}}));
const policy:RiskPolicyState={version:3,updatedAt:'2026-11-17T03:00:00Z',enabled:true,rules:[{id:'specific',name:'具体项目组合',enabled:true,action:'block',groups:[['g:/example/project'],['distinct-project']]}]};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.clearAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(riskApi.policy).mockResolvedValue(structuredClone(policy));vi.mocked(riskApi.events).mockResolvedValue({items:[],total:0,page:1,pageSize:30});
  vi.mocked(riskApi.overrides).mockResolvedValue({items:[],total:0,page:1,pageSize:30});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=async(el:React.ReactNode)=>{await act(async()=>root.render(el));};
const click=async(label:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeTruthy();await act(async()=>b!.click());};
async function input(label:string,value:string){const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el).toBeTruthy();await act(async()=>{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
it('opens the management subtab with real loading/error states and navigable rules/users',async()=>{
  await mount(<RiskManagement/>);expect(host.textContent).toContain('防护已启用');expect(host.textContent).toContain('暂无符合条件');
  await click('规则设置');expect(host.textContent).toContain('修改原因');await click('用户处理');expect(host.textContent).toContain('新增用户处理');
});
it('keeps rule edits local until a reason and confirmation, and preserves optimistic version',async()=>{
  const reload=vi.fn().mockResolvedValue(undefined);vi.mocked(riskApi.savePolicy).mockResolvedValue({ok:true,version:4});
  await mount(<RiskRules initial={policy} reload={reload}/>);
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='保存规则')!.disabled).toBe(true);
  await input('修改原因','人工复核具体项目');await click('保存规则');expect(riskApi.savePolicy).not.toHaveBeenCalled();
  await click('Cancel');expect(riskApi.savePolicy).not.toHaveBeenCalled();
  await click('保存规则');await click('Confirm');expect(riskApi.savePolicy).toHaveBeenCalledWith(3,{enabled:true,rules:policy.rules},'人工复核具体项目');expect(reload).toHaveBeenCalledOnce();
});
it('previews the draft without saving it and never renders supplied content as HTML',async()=>{
  vi.mocked(riskApi.test).mockResolvedValue({matches:[{id:'test',name:'<img src=x onerror=alert(1)>',action:'block',terms:[]}]});
  await mount(<RiskRules initial={policy} reload={async()=>{}}/>);await input('检查样例','G:/example/project distinct-project');await click('检查匹配');
  expect(host.textContent).toContain('将拒绝');expect(host.querySelector('img')).toBeNull();expect(riskApi.savePolicy).not.toHaveBeenCalled();
});
it('requires an explicit user action and reason; a conflict leaves the editor open',async()=>{
  vi.mocked(riskApi.saveOverride).mockRejectedValue(new Error('该用户的风控状态已变化'));const saved=vi.fn();
  await mount(<OverrideEditor initial={{userId:'id',email:'local@example.invalid',mode:'allow',version:4}} close={()=>{}} saved={saved}/>);
  expect(host.querySelector<HTMLInputElement>('[aria-label="用户邮箱"]')!.readOnly).toBe(true);
  await input('处理原因','已核实为正常使用');
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(riskApi.saveOverride).toHaveBeenCalledWith(expect.objectContaining({email:'local@example.invalid',mode:'allow',version:4,reason:'已核实为正常使用',expiresAt:expect.any(String)}));
  expect(saved).not.toHaveBeenCalled();expect(host.textContent).toContain('状态已变化');
});
