import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { commerceApi, sources, statuses, chains, commerceDate, transactionLink, type Transaction, type TransactionPage, type Filters } from '../lib/commerce';
import { ErrorPanel, Loading, Modal, messageOf } from '../components/UI';
import './commerce.css';

export function TransactionDetails({item,onClose,onRetry}: {item:Transaction;onClose:()=>void;onRetry?:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const p=item.payment||{};
  const value=(key:string)=>p[key] == null ? '—' : String(p[key]);
  return <Modal title={sources[item.source]+' · 详情'} onClose={onClose} wide>
    <dl className="commerce-details">
      <dt>记录号</dt><dd>{item.id}</dd><dt>购买人</dt><dd>{item.buyer?.email||'—'}</dd>
      <dt>操作人</dt><dd>{item.actor?.email||'—'}</dd><dt>档位 / 数量</dt><dd>{item.tier_name||item.tier_id||'—'} × {item.quantity}{item.duration_days ? ` · ${item.duration_days} 天` : ''}</dd>
      <dt>订单金额</dt><dd>{item.amount == null ? '无收款（手动发码）' : `${item.amount} USDT`}</dd>
      <dt>状态</dt><dd>{statuses[item.status]||item.status}{item.fulfilled?' · 已交付':''}</dd>
      <dt>创建时间</dt><dd>{commerceDate(item.created_at)}（UTC+8）</dd><dt>激活码批次</dt><dd>{item.batch_id||'—'}</dd>
      {item.note&&<><dt>备注</dt><dd>{item.note}</dd></>}
    </dl>
    {onRetry&&!item.fulfilled&&['PAID','PAID_REQUIRES_ADMIN'].includes(item.status)&&<div className="commerce-notice"><p>确认补充库存后可重试交付，系统会重新核验到账并预留库存。</p><button className="btn primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onRetry();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}}>{busy?'核验中…':'核验到账并重试交付'}</button>{error&&<ErrorPanel error={error}/>}</div>}
    {item.source!=='manual'&&<><h3>链上交易</h3><dl className="commerce-details">
      <dt>网络</dt><dd>{chains[item.chain_id||'']||item.chain_id||'—'}</dd><dt>实收金额</dt><dd>{value('paidAmount')} USDT</dd>
      <dt>付款地址</dt><dd>{value('fromAddress')}</dd><dt>收款地址</dt><dd>{item.address||value('toAddress')}</dd>
      <dt>交易哈希</dt><dd>{transactionLink(item.chain_id,item.tx_hash)?<a href={transactionLink(item.chain_id,item.tx_hash)} target="_blank" rel="noreferrer">{item.tx_hash}</a>:item.tx_hash||'—'}</dd>
      <dt>区块 / 确认数</dt><dd>{value('blockNumber')} / {value('confirmations')}</dd><dt>到账时间</dt><dd>{value('paidAt')}</dd>
    </dl>
      {!!item.collections?.unmatched?.length&&<><h3>同地址待认领入账</h3><p className="commerce-notice">以下链上入账尚未绑定订单，可能为迟付或重复付款，需要人工核实付款人，不能直接计为本单销售额。</p>{item.collections.unmatched.map((tx,i)=><p className="commerce-address" key={i}>{String(tx.amount)} USDT · {String(tx.blockTime)}（UTC）<br/><a href={transactionLink(item.chain_id,tx.txHash)} target="_blank" rel="noreferrer">{String(tx.txHash)}</a></p>)}</>}
      <h3>归集记录</h3>
      {item.collections?.shared&&<p className="commerce-notice">此流水为共用地址的合并归集，归集金额包含多笔订单，不等于本单收款金额。</p>}
      {item.collections?.items.length?<div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>类型 / 状态</th><th>归集金额</th><th>Gas（USD）</th><th>去向 / 交易哈希</th><th>时间</th></tr></thead><tbody>
        {item.collections.items.map((c,i)=><tr key={String(c.id||i)}><td>{String(c.transaction_type||'USDT_TRANSFER')}<small>{String(c.transaction_status||'SUCCESS')}</small></td><td>{String(c.token_amount??'—')}</td><td>{String(c.gas_fee_usd??'—')}</td><td className="commerce-address">{String(c.to_address||'—')}<small><a href={transactionLink(item.chain_id,c.transaction_hash)} target="_blank" rel="noreferrer">{String(c.transaction_hash||'—')}</a></small></td><td>{String(c.create_time||'—')}</td></tr>)}
      </tbody></table></div>:<p className="muted">{item.synced_at?'暂无关联归集记录。':'尚未同步支付明细，请在交易明细页点击同步。'}</p>}
    </>}
  </Modal>;
}

export function TransactionList({own=false,fixedSource,onOrder}: {own?:boolean;fixedSource?:string;onOrder?:(item:Transaction)=>void}) {
  const [draft,setDraft]=useState<Filters>({}),[filters,setFilters]=useState<Filters>({}),[page,setPage]=useState(1);
  const [data,setData]=useState<TransactionPage>(),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[detail,setDetail]=useState<Transaction>();
  const params={...filters,...(fixedSource?{source:fixedSource}:{}),page,page_size:20};
  async function load(){setLoading(true);try{setData(await commerceApi.transactions(params,own));}catch(e){setError(messageOf(e));}finally{setLoading(false);}}
  useEffect(()=>{void load();},[filters,page,own,fixedSource]);
  async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await load();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
  function field(key:string,value:string){setDraft(p=>({...p,[key]:value}));}
  return <div className="commerce-ledger">
    <div className="commerce-toolbar"><p className="muted">共 {data?.total??0} 条记录{!own&&data?.synced_at?` · 支付同步于 ${commerceDate(data.synced_at)}`:''}</p><div>
      {!own&&<button className="btn" disabled={busy} onClick={()=>void run(()=>commerceApi.sync())}><RefreshCw size={15}/>同步支付明细</button>}
      <button className="btn" disabled={busy} onClick={()=>void run(()=>commerceApi.export({...params,page:undefined},own))}><Download size={15}/>导出筛选结果</button>
    </div></div>
    <form className="panel commerce-filters" onSubmit={e=>{e.preventDefault();setPage(1);setFilters({...draft});}}>
      <label className="commerce-search">搜索<input value={String(draft.search||'')} onChange={e=>field('search',e.target.value)} placeholder="订单号、用户、地址、交易哈希"/></label>
      {!own&&!fixedSource&&<label>来源<select value={String(draft.source||'')} onChange={e=>field('source',e.target.value)}><option value="">全部来源</option>{Object.entries(sources).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>}
      <label>档位<select value={String(draft.tier_id||'')} onChange={e=>field('tier_id',e.target.value)}><option value="">全部档位</option><option value="pro">Max</option><option value="ultra">Ultra</option></select></label>
      <label>状态<select value={String(draft.status||'')} onChange={e=>field('status',e.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
      <label>网络<select value={String(draft.chain_id||'')} onChange={e=>field('chain_id',e.target.value)}><option value="">全部网络</option>{Object.entries(chains).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
      <label>开始时间（UTC+8）<input type="datetime-local" onChange={e=>setDraft(p=>({...p,start:e.target.value?Math.floor(new Date(e.target.value+'+08:00').getTime()/1000):undefined}))}/></label>
      <label>结束时间（UTC+8）<input type="datetime-local" onChange={e=>setDraft(p=>({...p,end:e.target.value?Math.floor(new Date(e.target.value+'+08:00').getTime()/1000):undefined}))}/></label>
      <button className="btn primary">筛选</button><button type="reset" className="btn" onClick={()=>{setDraft({});setFilters({});setPage(1);}}>重置</button>
    </form>
    {error&&<ErrorPanel error={error}/>}
    {loading?<Loading/>:<div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>记录 / 来源</th><th>购买人 / 操作人</th><th>档位 / 数量</th><th>金额（USDT）</th><th>状态</th><th>时间（UTC+8）</th><th>操作</th></tr></thead><tbody>
      {data?.items.map(item=><tr key={item.id}><td className="commerce-order"><span>{item.id}</span><small>{sources[item.source]}{item.chain_id?' · '+(chains[item.chain_id]||item.chain_id):''}</small></td><td>{item.buyer?.name||item.actor?.name||'—'}<small>{item.buyer?.email||item.actor?.email}</small></td><td>{item.tier_name||item.tier_id||'—'} × {item.quantity}<small>{item.duration_days?`${item.duration_days} 天`:''}</small></td><td>{item.amount??'—'}</td><td><span className="commerce-status" data-paid={item.fulfilled}>{statuses[item.status]||item.status}</span><small>{item.fulfilled?'已交付':''}</small></td><td>{commerceDate(item.created_at)}</td><td><button className="btn" onClick={()=>onOrder?onOrder(item):setDetail(item)}>{own?'查看订单':'详情'}</button></td></tr>)}
      {!data?.items.length&&<tr><td colSpan={7} className="commerce-empty">暂无符合条件的记录</td></tr>}
    </tbody></table></div>}
    <div className="commerce-pagination"><button className="btn" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil((data?.total||0)/20))}</span><button className="btn" disabled={page*20>=(data?.total||0)||loading} onClick={()=>setPage(p=>p+1)}>下一页</button></div>
    {detail&&<TransactionDetails item={detail} onClose={()=>setDetail(undefined)} onRetry={own?undefined:async()=>{const result=await commerceApi.retry(detail.id);if(!result.fulfilled)throw new Error('到账已核验，交付仍待处理，请检查账号资源或订阅同步状态。');setDetail(undefined);await load();}}/>}
  </div>;
}

export function Transactions(){return <section className="admin-content commerce-content"><div className="section-heading"><div><h2>交易明细</h2><p>普通用户购买、代理采购与管理员发码记录。链上交易和归集数据来自支付平台。</p></div></div><TransactionList/></section>;}
