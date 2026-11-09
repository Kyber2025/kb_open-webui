// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Gateway } from '../src/components/Gateway';
import { gatewayApi, type GatewayState } from '../src/lib/gateway';
import type { DesktopKey } from '../src/lib/desktop-keys';
import type { User } from '../src/lib/types';

vi.mock('../src/components/GatewayResources', () => ({ GatewayResources: () => null }));
const original: DesktopKey = { id:'old-key', label:'My laptop', suffix:'old1', installationId:'fixture-installation',
  canReveal:true, concurrentLimit:0, createdAt:'2026-11-09', expiresAt:'2099-01-01',
  lastRevealedAt:null, revokedAt:null, revokeReason:null, boundAt:'2026-11-09', lastUsedAt:null };
let state: GatewayState, host: HTMLDivElement, root: Root;
function button(text: string, parent: ParentNode = host) {
  const found = [...parent.querySelectorAll('button')].find(b=>b.textContent===text);
  if (!found) throw Error('Missing button: '+text);
  return found;
}
const click = async (text: string, parent: ParentNode = host) => act(async()=>button(text,parent).click());
async function render() {
  await act(async()=>root.render(<Gateway user={{id:'owner',email:'owner@example.invalid'} as User} onClose={()=>{}} onSubscription={()=>{}} />));
}
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:vi.fn()});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:vi.fn()});
  state={subscribed:true,eligible:true,canCreate:false,reason:null,usageUrl:'https://chat.example/',
    policy:{maxActiveKeys:1,requestsPerMinute:120,concurrentPerKey:0,concurrentPerUser:0,networksPerHour:3},keys:[{...original}]};
  vi.spyOn(gatewayApi,'status').mockImplementation(async()=>structuredClone(state));
  vi.spyOn(gatewayApi,'revoke').mockImplementation(async id=>{
    state.keys=state.keys.map(k=>k.id===id?{...k,revokedAt:'2026-11-09',revokeReason:'user_revoked',canReveal:false}:k);
    state.canCreate=true; return {ok:true};
  });
  vi.spyOn(gatewayApi,'delete').mockImplementation(async id=>{
    state.keys=state.keys.filter(k=>k.id!==id); state.canCreate=!state.keys.some(k=>!k.revokedAt); return {ok:true};
  });
  vi.spyOn(gatewayApi,'create').mockImplementation(async label=>{
    const key={...original,id:'new-key',label,suffix:'new1',installationId:'new-installation',boundAt:null};
    state.keys.unshift(key); state.canCreate=false; return {key};
  });
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async()=>{ await act(async()=>root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('confirms revocation, frees a slot, generates a replacement and deletes an active key', async()=>{
  await render();
  expect(button('生成接入资料').disabled).toBe(true);
  await click('停用'); expect(gatewayApi.revoke).not.toHaveBeenCalled();
  await click('取消'); expect(gatewayApi.revoke).not.toHaveBeenCalled();
  await click('停用'); await click('确认停用');
  expect(gatewayApi.revoke).toHaveBeenCalledOnce(); expect(gatewayApi.revoke).toHaveBeenCalledWith('old-key');
  expect(host.textContent).toContain('已停用');
  expect(host.textContent).not.toContain('下载客户资料 TXT');
  expect(button('生成接入资料').disabled).toBe(false);
  await click('生成接入资料');
  expect(gatewayApi.create).toHaveBeenCalledOnce(); expect(gatewayApi.create).toHaveBeenCalledWith('Claude Desktop');
  expect(host.querySelectorAll('article')).toHaveLength(2);
  expect(button('生成接入资料').disabled).toBe(true);
  const active=[...host.querySelectorAll('article')].find(a=>a.textContent?.includes('new1'))!;
  await click('删除',active); expect(gatewayApi.delete).not.toHaveBeenCalled();
  await click('确认删除');
  expect(gatewayApi.delete).toHaveBeenCalledOnce(); expect(gatewayApi.delete).toHaveBeenCalledWith('new-key');
  expect(host.querySelectorAll('article')).toHaveLength(1);
  expect(button('生成接入资料').disabled).toBe(false);
});

it('shows automatic revocation and lets the owner create without deleting history first', async()=>{
  state.keys=[{...original,revokedAt:'2026-11-09',revokeReason:'device_conflicts',canReveal:false}];state.canCreate=true;
  await render();
  expect(host.textContent).toContain('已自动停用：检测到多设备复用');
  expect(host.textContent).not.toContain('下载客户资料 TXT');
  await click('生成接入资料');
  expect(gatewayApi.create).toHaveBeenCalledOnce();
  expect(gatewayApi.delete).not.toHaveBeenCalled();
});

it('keeps the key and slot unchanged when revocation fails', async()=>{
  vi.mocked(gatewayApi.revoke).mockRejectedValueOnce(new Error('Service temporarily unavailable'));
  await render(); await click('停用'); await click('确认停用');
  expect(host.textContent).toContain('Service temporarily unavailable');
  expect(host.querySelectorAll('article')).toHaveLength(1);
  expect(button('生成接入资料').disabled).toBe(true);
  expect(button('停用').disabled).toBe(false);
});

it('allows an expired owner to remove keys without showing create or download', async()=>{
  state.subscribed=false;state.eligible=false;state.canCreate=false;state.keys[0].canReveal=false;
  await render();
  expect(host.textContent).not.toContain('下载客户资料 TXT');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='生成接入资料')).toBe(false);
  await click('删除'); await click('确认删除');
  expect(gatewayApi.delete).toHaveBeenCalledOnce(); expect(gatewayApi.delete).toHaveBeenCalledWith('old-key');
  expect(host.querySelectorAll('article')).toHaveLength(0);
});
