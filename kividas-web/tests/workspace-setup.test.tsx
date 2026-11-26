// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import * as api from '../src/lib/api';
import {CodeDownloads} from '../src/pages/Code';
vi.mock('../src/components/GatewayResources',()=>({GatewayResources:()=>null}));
let host:HTMLDivElement, root:Root;
const workspace={instanceId:'i-123abc',name:'ssh01',host:'192.0.2.12',port:2222,username:'ws_0123456789abcdef',directory:'/workspace/claude'};
function button(text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));if(!b)throw Error(text);return b;}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.spyOn(api,'request').mockResolvedValue({workspaces:[]});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<MemoryRouter><CodeDownloads onGateway={()=>{}} /></MemoryRouter>));}
it('shows SSH recommended first, Gateway second, and disables downloads without a binding',async()=>{
 await render();const tabs=[...host.querySelectorAll('[role=tab]')];expect(tabs).toHaveLength(2);
 expect(tabs[0].textContent).toContain('SSH 工作区');expect(tabs[0].textContent).toContain('推荐');expect(tabs[0].getAttribute('aria-selected')).toBe('true');
 expect(tabs[1].textContent).toContain('Claude Code Gateway');expect(host.textContent).not.toContain('Kividas CLI');expect(host.textContent).not.toContain('Kividas Code');
 expect(button('下载个人连接 TXT').disabled).toBe(true);expect(button('下载 .sh 脚本').disabled).toBe(true);expect(button('使用教程').disabled).toBe(false);
 await act(async()=>tabs[1].click());expect(host.querySelector('[role=tabpanel]')?.textContent).toContain('我的 Gateway 接入资料');
});
it('offers only the selected owner binding and explains expiry cleanup',async()=>{
 vi.mocked(api.request).mockResolvedValue({workspaces:[workspace],expiresAt:'2099-01-01'});await render();
 expect(button('下载个人连接 TXT').disabled).toBe(false);expect(host.textContent).toContain('ssh01 · 已绑定');expect(host.textContent).toContain('订阅到期会自动解绑');
 await act(async()=>host.querySelector<HTMLButtonElement>('.ssh-platforms button:last-child')!.click());expect(button('下载 PowerShell 脚本').disabled).toBe(false);expect(host.textContent).toContain('kividas-ssh-setup.ps1');
});
it('fails closed on load failure and supports retry',async()=>{
 vi.mocked(api.request).mockRejectedValueOnce(new Error('暂不可用'));await render();expect(host.textContent).toContain('暂不可用');expect(button('下载个人连接 TXT').disabled).toBe(true);
 vi.mocked(api.request).mockResolvedValue({workspaces:[workspace]});await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="刷新绑定状态"]')!.click());expect(button('下载个人连接 TXT').disabled).toBe(false);
});
