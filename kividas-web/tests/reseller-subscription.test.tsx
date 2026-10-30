// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { Subscription } from '../src/components/Subscription';
vi.mock('../src/lib/api', () => ({ api: { subscription:vi.fn(),plans:vi.fn(),checkout:vi.fn(),redeem:vi.fn() } }));
let root:Root, host:HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(api.plans).mockResolvedValue([{id:'pro',name:'Max 5x',price_usd:120,duration_days:30,enabled:true,can_purchase:true,remaining:2,sort_order:1} as any]);
  vi.mocked(api.checkout).mockResolvedValue(null);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('managed accounts retain plan, expiry and redemption even if stale tiers contain a price',async()=>{
  vi.mocked(api.subscription).mockResolvedValue({tier:{id:'pro',name:'Max 5x'},expires_at:1900000000,commerce:{managed_by_reseller:true,show_prices:false,can_purchase:false}});
  await act(async()=>root.render(<Subscription onClose={()=>{}} onChanged={async()=>{}} />));
  expect(host.textContent).toContain('Max 5x');expect(host.textContent).toContain('Active until');
  expect(host.querySelector('.kvs-code')).not.toBeNull();
  expect(host.querySelector('.kvs-price,.kvs-purchase')).toBeNull();
  expect(host.textContent).not.toMatch(/120|USDT|Available plans/);
});
it('ordinary accounts still see prices and purchase controls',async()=>{
  vi.mocked(api.subscription).mockResolvedValue({tier:{id:'free',name:'Free'}});
  await act(async()=>root.render(<Subscription onClose={()=>{}} onChanged={async()=>{}} />));
  expect(host.querySelector('.kvs-price')?.textContent).toContain('120');
  expect(host.querySelector('.kvs-purchase button')).not.toBeNull();
});
