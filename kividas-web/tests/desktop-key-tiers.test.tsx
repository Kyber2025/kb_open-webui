// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopKeysModal } from '../src/components/DesktopKeysModal';
import { Gateway } from '../src/components/Gateway';
import { desktopKeysApi, type DesktopKey } from '../src/lib/desktop-keys';
import { gatewayApi } from '../src/lib/gateway';
import type { ManagedUser } from '../src/lib/admin-users';
vi.mock('../src/lib/desktop-keys', async importOriginal => ({...await importOriginal<typeof import('../src/lib/desktop-keys')>(),desktopKeysApi:{list:vi.fn()}}));
vi.mock('../src/lib/gateway', async importOriginal => ({...await importOriginal<typeof import('../src/lib/gateway')>(),gatewayApi:{status:vi.fn()}}));
const user={id:'test-user',name:'Test',email:'test@example.invalid',role:'user'} as ManagedUser;
const key={id:'key-1',label:'Laptop',suffix:'1234',createdAt:'2026-10-30',expiresAt:'2099-01-01',revokedAt:null,boundAt:null,installationId:'test-installation',canReveal:true,concurrentLimit:0} as DesktopKey;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 vi.clearAllMocks(); Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 HTMLDialogElement.prototype.close=function(){this.open=false;};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
for(const portal of ['admin','subscriber']) for(const [limit,count,disabled] of [[1,1,true],[2,1,false],[2,2,true]] as const) {
 it(`${portal}: ${count} of ${limit} keys controls creation and device text`,async()=>{
  const state={eligible:true,subscribed:true,canCreate:count<limit,reason:null,policy:{maxActiveKeys:limit,maxDevices:limit,requestsPerMinute:120,concurrentPerKey:0,concurrentPerUser:0,networksPerHour:3},keys:Array.from({length:count},(_,i)=>({...key,id:'key-'+i}))};
  vi.mocked(desktopKeysApi.list).mockResolvedValue(state);vi.mocked(gatewayApi.status).mockResolvedValue(state);
  await act(async()=>root.render(portal==='admin'?<DesktopKeysModal user={user} onClose={()=>{}}/>:<Gateway user={user} onClose={()=>{}} onSubscription={()=>{}}/>));
  const create=[...host.querySelectorAll('button')].find(b=>b.textContent=== (portal==='admin'?'生成 Key':'生成接入资料'));
  expect(create).toBeDefined();expect(create!.disabled).toBe(disabled);
  expect(host.textContent).toContain(`最多保留 ${limit} 个有效 Key`);
  expect(host.textContent).toContain(`可用于 ${limit} 台电脑`);
 });
}
