import { useEffect, useRef, useState } from 'react';
import { commerceApi, commerceDate, statuses, chains, type Profile, type Transaction } from '../lib/commerce';
import { ErrorPanel, Loading, Modal, messageOf } from '../components/UI';
import { TransactionList } from './Transactions';
import './commerce.css';

export function PurchaseOrder({initial,onClose}: {initial:Transaction;onClose:()=>void}){
  const [order,setOrder]=useState(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const next=await commerceApi.order(initial.id);if(!active)return;setOrder(next);setError('');if(!next.fulfilled&&!['EXPIRED','FAILED'].includes(next.status))timer=setTimeout(poll,6000);}catch(e){if(active){setError(messageOf(e));timer=setTimeout(poll,15000);}}}void poll();return()=>{active=false;clearTimeout(timer);};},[initial.id]);
  const qr=order.payment?.qrCodeImage;
  const canPay=order.status==='PENDING'&&!order.fulfilled&&!!order.expires_at&&order.expires_at*1000>Date.now();
  return <Modal title="代理采购订单" onClose={onClose} wide>
    {error&&<ErrorPanel error={error}/>}
    <div className="commerce-notice">{order.fulfilled?`已发放 ${order.quantity} 个激活码。`:order.status==='PAID_REQUIRES_ADMIN'?'付款已确认，订单待管理员处理，请勿重复付款。':statuses[order.status]||order.status}</div>
    <dl className="commerce-details"><dt>订单号</dt><dd>{order.id}</dd><dt>采购内容</dt><dd>{order.tier_name} × {order.quantity} · {order.duration_days} 天</dd><dt>应付金额</dt><dd><strong>{order.amount} USDT</strong></dd><dt>网络</dt><dd>{chains[order.chain_id||'']||order.chain_id}</dd><dt>付款截止</dt><dd>{commerceDate(order.expires_at)}（UTC+8）</dd></dl>
    {canPay&&<><p className="commerce-notice">请在 15 分钟付款窗口内，使用指定网络支付准确金额。库存已为本订单预留；到期后请勿继续转账，系统会核对到账。</p>{typeof qr==='string'&&qr.startsWith('data:image/png;base64,')&&qr.length<300000&&<img className="commerce-qr" src={qr} alt="USDT 收款地址二维码"/>}<label>收款地址<input readOnly value={order.address||'生成中…'} onFocus={e=>e.currentTarget.select()}/></label></>}
    {order.fulfilled&&<><h3>激活码</h3><textarea className="commerce-codes" readOnly value={(order.cards||[]).map(c=>c.code).join('\n')} onFocus={e=>e.currentTarget.select()}/><button className="btn" onClick={()=>{const content=(order.cards||[]).map(c=>`${c.code}\t${order.tier_name}\t${c.duration_days}天`).join('\n');const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`激活码-${order.id}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出激活码</button></>}
    <button className="btn primary" disabled={busy} onClick={()=>{setBusy(true);void commerceApi.order(order.id).then(setOrder).catch(e=>setError(messageOf(e))).finally(()=>setBusy(false));}}>{busy?'查询中…':'刷新订单'}</button>
  </Modal>;
}

export function ResellerPurchase(){
  const [profile,setProfile]=useState<Profile>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[tier,setTier]=useState('pro'),[quantity,setQuantity]=useState(1),[chain,setChain]=useState(''),[order,setOrder]=useState<Transaction>(),[version,setVersion]=useState(0);
  const requestId=useRef(crypto.randomUUID());
  async function load(){const next=await commerceApi.profile();setProfile(next);setChain(c=>c||next.chains?.[0]?.id||'');}
  useEffect(()=>{void load().catch(e=>setError(messageOf(e))).finally(()=>setLoading(false));},[]);
  const price=profile?.prices?.find(p=>p.tier_id===tier);
  function change(action:()=>void){requestId.current=crypto.randomUUID();action();}
  return <section className="commerce-purchase"><div className="eyebrow">KIVIDAS PARTNERS</div><h1>代理采购</h1><p className="muted">按您的代理价格批量购买激活码，支付确认后自动发放。</p>
    {error&&<ErrorPanel error={error}/>}{loading?<Loading/>:!profile?.is_reseller?<div className="panel">此账号尚未开通代理商权限，请联系管理员。</div>:<>
      {!profile.enabled&&<p className="commerce-notice">代理采购权限已停用。您仍可查看历史订单和已购激活码。</p>}
      {profile.enabled&&<p className="commerce-notice">每个账号同时只能有一笔待支付订单。未付款订单到期后核对链上状态再释放库存，多次未付款会触发冷却限制。</p>}
      {profile.enabled&&<form className="panel commerce-purchase-form" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void commerceApi.purchase(tier,quantity,chain,requestId.current).then(setOrder).catch(e=>setError(messageOf(e))).finally(()=>setBusy(false));}}>
        <label>订阅档位<select value={tier} onChange={e=>change(()=>setTier(e.target.value))}>{profile.prices?.map(p=><option key={p.tier_id} value={p.tier_id}>{p.name} · {p.duration_days} 天</option>)}</select></label>
        <label>购买数量<input type="number" min={1} max={Math.min(price?.remaining??0,100)} step={1} required value={quantity} onChange={e=>change(()=>setQuantity(Number(e.target.value)))}/></label>
        <label>USDT 网络<select required value={chain} onChange={e=>change(()=>setChain(e.target.value))}>{profile.chains?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <p className="muted">{price?.price?`代理单价 ${price.price} USDT`:'尚未配置代理价格'} · 剩余可购买 {price?.remaining??0}</p>
        <div className="commerce-purchase-total"><span>合计 <strong>{price?.price?(Number(price.price)*quantity).toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false}):'—'}</strong> USDT</span><button className="btn primary" disabled={busy||!price?.price||!chain||quantity<1||!Number.isInteger(quantity)||quantity>(price?.remaining??0)}>{busy?'创建订单中…':'创建采购订单'}</button></div>
      </form>}
      <h2>我的购买明细</h2><TransactionList key={version} own onOrder={setOrder}/>
    </>}
    {order&&<PurchaseOrder initial={order} onClose={()=>{setOrder(undefined);setVersion(v=>v+1);void load().catch(e=>setError(messageOf(e)));}}/>}
  </section>;
}
