// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { commerceApi, type Transaction } from '../src/lib/commerce';
import { ResellerPurchase, PurchaseOrder } from '../src/pages/ResellerPurchase';
import { TransactionDetails, TransactionList } from '../src/pages/Transactions';
vi.mock('../src/lib/commerce', async original => ({...await original<typeof import('../src/lib/commerce')>(),
  commerceApi:{profile:vi.fn(),purchase:vi.fn(),transactions:vi.fn(),order:vi.fn(),export:vi.fn(),sync:vi.fn(),retry:vi.fn()}}));
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
