import { useEffect, useRef, useState } from 'react';
import { commerceApi, commerceDate, statuses, chains, cancellableStatuses, type Profile, type Transaction } from '../lib/commerce';
import { resellerInviteLink } from '../lib/reseller-invites';
import { ErrorPanel, Loading, Modal, messageOf, useNotify } from '../components/UI';
import { TransactionList } from './Transactions';
import './commerce.css';

export function PurchaseOrder({initial,onClose}: {initial:Transaction;onClose:(latest:Transaction)=>void}){
  const [order,setOrder]=useState(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  // Two steps on purpose: cancelling after the transfer was sent turns automatic delivery into manual handling.
  const [confirming,setConfirming]=useState(false),[pollKey,setPollKey]=useState(0),keepError=useRef(false);
  // Restarting the poll (pollKey) also drops any response that was requested before a cancel.
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const next=await commerceApi.order(initial.id);if(!active)return;setOrder(next);if(keepError.current)keepError.current=false;else setError('');if(!next.fulfilled&&!['EXPIRED','FAILED','CANCELLED'].includes(next.status))timer=setTimeout(poll,6000);}catch(e){if(active){setError(messageOf(e));timer=setTimeout(poll,15000);}}}void poll();return()=>{active=false;clearTimeout(timer);};},[initial.id,pollKey]);
  const qr=order.payment?.qrCodeImage;
  const canPay=order.status==='PENDING'&&!order.fulfilled&&!!order.expires_at&&order.expires_at*1000>Date.now();
  const canCancel=!order.fulfilled&&cancellableStatuses.includes(order.status);
  async function cancel(){
    setBusy(true);setError('');
    try{const result=await commerceApi.cancel(order.id);setOrder(result.order);}
    // A refused cancel usually means the payment arrived first: show why, then reload the real state.
    catch(e){keepError.current=true;setError(messageOf(e));}
    finally{setBusy(false);setConfirming(false);setPollKey(k=>k+1);}
  }
  return <Modal title="代理采购订单" onClose={()=>onClose(order)} wide>
    {error&&<ErrorPanel error={error}/>}
    <div className="commerce-notice">{order.fulfilled?`已发放 ${order.quantity} 个激活码。`:order.status==='PAID_REQUIRES_ADMIN'?'付款已确认，订单待管理员处理，请勿重复付款。':order.status==='CANCELLED'?'订单已取消，库存预留已释放。请勿再向原收款地址转账。':statuses[order.status]||order.status}</div>
    <dl className="commerce-details"><dt>订单号</dt><dd>{order.id}</dd><dt>采购内容</dt><dd>{order.tier_name} × {order.quantity} · {order.duration_days} 天</dd><dt>应付金额</dt><dd><strong>{order.amount} USDT</strong></dd><dt>网络</dt><dd>{chains[order.chain_id||'']||order.chain_id}</dd><dt>付款截止</dt><dd>{commerceDate(order.expires_at)}（UTC+8）</dd></dl>
    {canPay&&<><p className="commerce-notice">请在 15 分钟付款窗口内，使用指定网络支付准确金额。库存已为本订单预留；到期后请勿继续转账，系统会核对到账。</p>{typeof qr==='string'&&qr.startsWith('data:image/png;base64,')&&qr.length<300000&&<img className="commerce-qr" src={qr} alt="USDT 收款地址二维码"/>}<label>收款地址<input readOnly value={order.address||'生成中…'} onFocus={e=>e.currentTarget.select()}/></label></>}
    {order.fulfilled&&<><h3>激活码</h3><textarea className="commerce-codes" readOnly value={(order.cards||[]).map(c=>c.code).join('\n')} onFocus={e=>e.currentTarget.select()}/><button className="btn" onClick={()=>{const content=(order.cards||[]).map(c=>`${c.code}\t${order.tier_name}\t${c.duration_days}天`).join('\n');const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`激活码-${order.id}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出激活码</button></>}
    <div className="commerce-order-actions"><button className="btn primary" disabled={busy} onClick={()=>{setBusy(true);void commerceApi.order(order.id).then(setOrder).catch(e=>setError(messageOf(e))).finally(()=>setBusy(false));}}>{busy&&!confirming?'查询中…':'刷新订单'}</button>
      {canCancel&&(confirming?<span className="commerce-cancel-confirm" role="group" aria-label="确认取消订单"><span>确认取消这笔订单？如已转账请不要取消。</span><button className="btn danger-solid" disabled={busy} onClick={()=>void cancel()}>{busy?'正在取消…':'确认取消'}</button><button className="btn" disabled={busy} onClick={()=>setConfirming(false)}>返回</button></span>
        :<button className="btn danger" disabled={busy} onClick={()=>setConfirming(true)}>取消订单</button>)}</div>
  </Modal>;
}

export function ResellerPurchase(){
  const [profile,setProfile]=useState<Profile>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[tier,setTier]=useState('pro'),[quantity,setQuantity]=useState(1),[chain,setChain]=useState(''),[order,setOrder]=useState<Transaction>(),[version,setVersion]=useState(0);
  const requestId=useRef(crypto.randomUUID()),notify=useNotify();
  // BSC is the default network when it is offered; an explicit choice made earlier is kept.
  async function load(){const next=await commerceApi.profile();setProfile(next);setChain(c=>c||(next.chains?.some(x=>x.id==='56')?'56':next.chains?.[0]?.id)||'');}
  useEffect(()=>{void load().catch(e=>setError(messageOf(e))).finally(()=>setLoading(false));},[]);
  const price=profile?.prices?.find(p=>p.tier_id===tier);
  function change(action:()=>void){requestId.current=crypto.randomUUID();action();}
  return <section className="commerce-purchase"><div className="eyebrow">KIVIDAS PARTNERS</div><h1>代理采购</h1><p className="muted">按您的代理价格批量购买激活码，支付确认后自动发放。</p>
    {error&&<ErrorPanel error={error}/>}{loading?<Loading/>:!profile?.is_reseller?<div className="panel">此账号尚未开通代理商权限，请联系管理员。</div>:<>
      {!profile.enabled&&<p className="commerce-notice">代理采购权限已停用。您仍可查看历史订单和已购激活码。</p>}
      {profile.short_code&&<div className="panel commerce-invite"><div><h2>我的客户邀请链接</h2><p className="muted">客户通过此链接注册后归属到您名下，使用您发放的激活码开通或续费。已邀请 {profile.customers??0} 位客户。</p></div>
        <div className="commerce-invite-row"><input readOnly aria-label="我的客户邀请链接" value={resellerInviteLink(window.location.origin,{token:'',short_code:profile.short_code})} onFocus={e=>e.currentTarget.select()}/><button type="button" className="btn" onClick={()=>void navigator.clipboard.writeText(resellerInviteLink(window.location.origin,{token:'',short_code:profile.short_code})).then(()=>notify('邀请链接已复制')).catch(e=>setError(messageOf(e)))}>复制链接</button></div>
        {profile.invite_enabled===false&&<p className="commerce-notice">此邀请链接已被管理员停用，新客户暂时无法通过它注册；已注册的客户不受影响。</p>}
      </div>}
      {profile.enabled&&<p className="commerce-notice">每个账号同时只能有一笔待支付订单。未付款的订单可以在订单窗口里主动取消；不取消的话，到期后核对链上状态再释放库存，多次未付款会触发冷却限制。</p>}
      {profile.enabled&&!!profile.prices?.length&&<div className="commerce-stock" role="list" aria-label="各档位剩余数量">{profile.prices.map(p=><div role="listitem" className="commerce-stock-item" data-selected={p.tier_id===tier} data-available={(p.remaining??0)>0} key={p.tier_id}>
        <strong>{p.name}</strong><span className="muted">{p.duration_days} 天 · {p.price?`代理价 ${p.price} USDT`:'未配置代理价'}</span><span className="commerce-stock-count">{(p.remaining??0)>0?`剩余 ${p.remaining}`:'暂无库存'}</span></div>)}</div>}
      {profile.enabled&&<form className="panel commerce-purchase-form" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void commerceApi.purchase(tier,quantity,chain,requestId.current).then(setOrder).catch(e=>setError(messageOf(e))).finally(()=>setBusy(false));}}>
        <label>订阅档位<select value={tier} onChange={e=>change(()=>setTier(e.target.value))}>{profile.prices?.map(p=><option key={p.tier_id} value={p.tier_id}>{p.name} · {p.duration_days} 天（剩余 {p.remaining??0}）</option>)}</select></label>
        <label>购买数量<input type="number" min={1} max={Math.min(price?.remaining??0,100)} step={1} required value={quantity} onChange={e=>change(()=>setQuantity(Number(e.target.value)))}/></label>
        <label>USDT 网络<select required value={chain} onChange={e=>change(()=>setChain(e.target.value))}>{profile.chains?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <p className="muted">{price?.price?`代理单价 ${price.price} USDT`:'尚未配置代理价格'} · 剩余可购买 {price?.remaining??0}</p>
        <div className="commerce-purchase-total"><span>合计 <strong>{price?.price?(Number(price.price)*quantity).toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false}):'—'}</strong> USDT</span><button className="btn primary" disabled={busy||!price?.price||!chain||quantity<1||!Number.isInteger(quantity)||quantity>(price?.remaining??0)}>{busy?'创建订单中…':'创建采购订单'}</button></div>
      </form>}
      <h2>我的购买明细</h2><TransactionList key={version} own onOrder={setOrder}/>
    </>}
    {order&&<PurchaseOrder initial={order} onClose={latest=>{
      // A finished or cancelled order must not be returned again by the idempotency key; an unpaid one stays resumable.
      if(latest.fulfilled||!cancellableStatuses.includes(latest.status))requestId.current=crypto.randomUUID();
      setOrder(undefined);setVersion(v=>v+1);void load().catch(e=>setError(messageOf(e)));}}/>}
  </section>;
}
