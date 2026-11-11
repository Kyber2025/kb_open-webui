// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { commerceApi, type Transaction } from '../src/lib/commerce';
import { ResellerPurchase, PurchaseOrder } from '../src/pages/ResellerPurchase';
import { TransactionDetails, TransactionList } from '../src/pages/Transactions';
vi.mock('../src/lib/commerce', async original => ({...await original<typeof import('../src/lib/commerce')>(),
  commerceApi:{profile:vi.fn(),purchase:vi.fn(),transactions:vi.fn(),order:vi.fn(),cancel:vi.fn(),export:vi.fn(),sync:vi.fn(),retry:vi.fn()}}));
let root: Root, host: HTMLDivElement;
const order: Transaction={id:'kvr-example_56',source:'reseller',tier_id:'pro',tier_name:'Max',quantity:2,
  amount:'15',duration_days:30,chain_id:'56',status:'PENDING',fulfilled:false,address:'server-owned-address',
  expires_at:1900000000,created_at:1800000000,payment:{qrCodeImage:'data:image/png;base64,AAAA'}};
beforeEach(()=>{
  vi.clearAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(commerceApi.transactions).mockResolvedValue({items:[],total:0,page:1,page_size:20});
  vi.mocked(commerceApi.order).mockResolvedValue(order);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=async(element:React.ReactNode)=>{await act(async()=>root.render(element));};
const click=async(label:string)=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(label));expect(button).toBeTruthy();await act(async()=>button!.click());};
it('requires reseller role before showing the purchase form',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue({is_reseller:false});
  await mount(<ResellerPurchase/>);expect(host.textContent).toContain('尚未开通');expect(host.querySelector('form')).toBeNull();
});
it('submits only product choices and an idempotency key and displays the server quote',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue({is_reseller:true,enabled:true,chains:[{id:'56',name:'BSC'}],
    prices:[{tier_id:'pro',name:'Max',duration_days:30,price:'7.5',default_price:'10',override_price:'7.5',retail_price:'120',remaining:3}]});
  vi.mocked(commerceApi.purchase).mockResolvedValue(order);
  await mount(<ResellerPurchase/>);
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(commerceApi.purchase).toHaveBeenCalledWith('pro',1,'56',expect.any(String));
  expect(host.querySelector('dialog')?.textContent).toContain('15 USDT');
  expect(host.querySelector('dialog input')?.getAttribute('readonly')).not.toBeNull();
});
it('hides the payment address when paid fulfillment needs an administrator',async()=>{
  const pending={...order,status:'PAID_REQUIRES_ADMIN'};vi.mocked(commerceApi.order).mockResolvedValue(pending);
  await mount(<PurchaseOrder initial={pending} onClose={()=>{}}/>);
  expect(host.textContent).toContain('请勿重复付款');expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('textarea')).toBeNull();
});
it('only renders activation codes after confirmed fulfillment',async()=>{
  const paid={...order,status:'PAID',fulfilled:true,cards:[{code:'SERVER-ISSUED',duration_days:30}]} as Transaction;
  vi.mocked(commerceApi.order).mockResolvedValue(paid);
  await mount(<PurchaseOrder initial={paid} onClose={()=>{}}/>);
  expect(host.querySelector('textarea')?.value).toBe('SERVER-ISSUED');expect(host.textContent).toContain('导出激活码');
  expect(host.querySelector('input')).toBeNull();
});
it('exports the current reseller filter and keeps ownership in the API mode',async()=>{
  vi.mocked(commerceApi.export).mockResolvedValue(undefined);
  await mount(<TransactionList own fixedSource="reseller"/>);
  await click('导出筛选结果');
  expect(commerceApi.export).toHaveBeenCalledWith(expect.objectContaining({source:'reseller'}),true);
});
it('marks manual issuance as no revenue and labels pooled collections correctly',async()=>{
  await mount(<TransactionDetails item={{...order,source:'manual',amount:undefined,status:'ISSUED',fulfilled:true}} onClose={()=>{}}/>);
  expect(host.textContent).toContain('无收款（手动发码）');expect(host.textContent).not.toContain('链上交易');
  await mount(<TransactionDetails item={{...order,collections:{shared:true,items:[]}}} onClose={()=>{}}/>);
  expect(host.textContent).toContain('归集金额包含多笔订单');
});
const cancelButton=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='取消订单');
const resellerProfile={is_reseller:true,enabled:true,chains:[{id:'56',name:'BSC'}],short_code:'abc123XYZ_-9',invite_enabled:true,customers:3,
  prices:[{tier_id:'pro',name:'Max',duration_days:30,price:'7.5',default_price:'10',override_price:'7.5',retail_price:'120',remaining:3}]};
it('cancels an unpaid purchase only after an explicit confirmation',async()=>{
  const cancelled={...order,status:'CANCELLED'};
  vi.mocked(commerceApi.cancel).mockResolvedValue({cancelled:true,order:cancelled});
  const closed=vi.fn();
  await mount(<PurchaseOrder initial={order} onClose={closed}/>);
  await click('取消订单');
  expect(host.textContent).toContain('如已转账请不要取消');expect(commerceApi.cancel).not.toHaveBeenCalled();
  await click('返回');expect(host.textContent).not.toContain('如已转账请不要取消');expect(cancelButton()).toBeTruthy();
  vi.mocked(commerceApi.order).mockResolvedValue(cancelled);
  await click('取消订单');await click('确认取消');
  expect(commerceApi.cancel).toHaveBeenCalledWith(order.id);
  expect(host.textContent).toContain('订单已取消');expect(host.querySelector('input')).toBeNull();expect(cancelButton()).toBeUndefined();
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!.click());
  expect(closed).toHaveBeenCalledWith(expect.objectContaining({id:order.id,status:'CANCELLED'}));
});
it('keeps the purchase on screen and explains when the payment arrived before the cancel',async()=>{
  vi.mocked(commerceApi.cancel).mockRejectedValue(new Error('付款已到账，订单不能取消'));
  await mount(<PurchaseOrder initial={order} onClose={()=>{}}/>);
  const delivered={...order,status:'PAID',fulfilled:true,cards:[{code:'SERVER-ISSUED',duration_days:30}]} as Transaction;
  vi.mocked(commerceApi.order).mockResolvedValue(delivered);
  await click('取消订单');await click('确认取消');
  expect(host.textContent).toContain('付款已到账，订单不能取消');
  expect(host.querySelector('textarea')?.value).toBe('SERVER-ISSUED');expect(cancelButton()).toBeUndefined();
});
it.each(['PAID','PAID_REQUIRES_ADMIN','EXPIRED','FAILED','CANCELLED'])('never offers cancellation for a %s purchase',async status=>{
  const settled={...order,status};vi.mocked(commerceApi.order).mockResolvedValue(settled);
  await mount(<PurchaseOrder initial={settled} onClose={()=>{}}/>);
  expect(cancelButton()).toBeUndefined();
});
it('offers cancellation while an ended payment window is still being verified, but not for delivered orders',async()=>{
  const checking={...order,status:'EXPIRED_CHECKING'};vi.mocked(commerceApi.order).mockResolvedValue(checking);
  await mount(<PurchaseOrder initial={checking} onClose={()=>{}}/>);
  expect(cancelButton()).toBeTruthy();
});
it('uses a fresh idempotency key after a cancelled order but keeps it for an unpaid one',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue(resellerProfile);
  vi.mocked(commerceApi.purchase).mockResolvedValue(order);
  await mount(<ResellerPurchase/>);
  const submit=async()=>{await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
  const close=async()=>{const b=host.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');expect(b).toBeTruthy();await act(async()=>b!.click());};
  await submit();const first=vi.mocked(commerceApi.purchase).mock.calls[0][3];
  await close();expect(host.querySelector('dialog')).toBeNull();
  await submit();expect(vi.mocked(commerceApi.purchase).mock.calls[1][3]).toBe(first);
  vi.mocked(commerceApi.cancel).mockResolvedValue({cancelled:true,order:{...order,status:'CANCELLED'}});
  vi.mocked(commerceApi.order).mockResolvedValue({...order,status:'CANCELLED'});
  await click('取消订单');await click('确认取消');await close();
  await submit();expect(vi.mocked(commerceApi.purchase).mock.calls[2][3]).not.toBe(first);
});
it('shows the reseller their own customer invitation link and copies it',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue(resellerProfile);
  const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  await mount(<ResellerPurchase/>);
  const link='https://proxy.kividas.com/i/abc123XYZ_-9';
  expect(host.querySelector<HTMLInputElement>('input[aria-label="我的客户邀请链接"]')?.value).toBe(link);
  expect(host.textContent).toContain('已邀请 3 位客户');expect(host.textContent).not.toContain('已被管理员停用');
  await click('复制链接');expect(writeText).toHaveBeenCalledWith(link);
});
it('tells the reseller when the invitation link is disabled and hides the panel without a link',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue({...resellerProfile,invite_enabled:false});
  await mount(<ResellerPurchase/>);
  expect(host.textContent).toContain('已被管理员停用');
  await act(async()=>root.unmount());root=createRoot(host);
  vi.mocked(commerceApi.profile).mockResolvedValue({...resellerProfile,short_code:null});
  await mount(<ResellerPurchase/>);
  expect(host.querySelector('input[aria-label="我的客户邀请链接"]')).toBeNull();expect(host.querySelector('form')).not.toBeNull();
});
it('shows the remaining stock of every tier and defaults the payment network to BSC',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue({...resellerProfile,chains:[{id:'728126428',name:'TRON'},{id:'1',name:'Ethereum'},{id:'56',name:'BSC'}],
    prices:[...resellerProfile.prices,{tier_id:'ultra',name:'Ultra',duration_days:30,price:'260',default_price:'260',override_price:null,retail_price:'360',remaining:0}]});
  vi.mocked(commerceApi.purchase).mockResolvedValue(order);
  await mount(<ResellerPurchase/>);
  const stock=[...host.querySelectorAll('.commerce-stock-item')].map(e=>e.textContent);
  expect(stock).toHaveLength(2);expect(stock[0]).toContain('Max');expect(stock[0]).toContain('剩余 3');
  expect(stock[1]).toContain('Ultra');expect(stock[1]).toContain('暂无库存');
  const selects=host.querySelectorAll('select');
  expect([...selects[0].options].map(o=>o.textContent)).toEqual(['Max · 30 天（剩余 3）','Ultra · 30 天（剩余 0）']);
  expect(selects[1].value).toBe('56');
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(commerceApi.purchase).toHaveBeenCalledWith('pro',1,'56',expect.any(String));
});
it('falls back to the first offered network when BSC is not available',async()=>{
  vi.mocked(commerceApi.profile).mockResolvedValue({...resellerProfile,chains:[{id:'728126428',name:'TRON'},{id:'1',name:'Ethereum'}]});
  await mount(<ResellerPurchase/>);
  expect(host.querySelectorAll('select')[1].value).toBe('728126428');
});
