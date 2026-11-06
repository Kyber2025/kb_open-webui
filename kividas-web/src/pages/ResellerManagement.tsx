import { useEffect, useState } from 'react';
import { commerceApi, type Reseller, type Price } from '../lib/commerce';
import { api, type ResellerInvite } from '../lib/api';
import type { User } from '../lib/types';
import { ErrorPanel, Loading, Modal, messageOf, useNotify } from '../components/UI';
import { TransactionList } from './Transactions';
import { ResellerInvites } from './ResellerInvites';
import './commerce.css';

function Prices({prices,scope,onSaved}: {prices:Price[];scope:string;onSaved:()=>Promise<void>}){
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(prices.map(p=>[p.tier_id,(scope==='default'?p.default_price:p.override_price)||'']))),[busy,setBusy]=useState(''),[error,setError]=useState('');
  return <><p className="muted">价格单位为 USDT / 个激活码。{scope==='default'?'未配置统一代理价的档位不可购买。':'留空表示使用统一代理价。'}已创建订单保留原报价。</p>{error&&<ErrorPanel error={error}/>}<div className="commerce-price-grid">{prices.map(p=><form className="panel" key={p.tier_id} onSubmit={e=>{e.preventDefault();setBusy(p.tier_id);setError('');void commerceApi.price(scope,p.tier_id,values[p.tier_id]||null).then(onSaved).catch(e=>setError(messageOf(e))).finally(()=>setBusy(''));}}>
    <h3>{p.name}</h3><p className="muted">{p.duration_days} 天 · 零售价 {p.retail_price} USDT</p>
    {scope!=='default'&&<small>统一代理价：{p.default_price??'未配置'}</small>}
    <label>{scope==='default'?'统一代理价':'专属代理价'}<input aria-label={`${p.name}代理价`} type="number" min="0.000001" max="1000000" step="0.000001" value={values[p.tier_id]} onChange={e=>setValues(v=>({...v,[p.tier_id]:e.target.value}))} placeholder={scope==='default'?'输入价格':'使用统一代理价'}/></label>
    <button className="btn primary" disabled={!!busy}>{busy===p.tier_id?'保存中…':'保存价格'}</button>
  </form>)}</div></>;
}

export function ResellerManagement(){
  const [tab,setTab]=useState('agents'),[data,setData]=useState<{items:Reseller[];defaults:Price[]}>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [adding,setAdding]=useState(false),[search,setSearch]=useState(''),[users,setUsers]=useState<User[]>([]),[selected,setSelected]=useState(''),[name,setName]=useState(''),[invite,setInvite]=useState(''),[invites,setInvites]=useState<ResellerInvite[]>([]),[editing,setEditing]=useState<Reseller>();
  const notify=useNotify();
  async function load(){const [next,links]=await Promise.all([commerceApi.resellers(),api.resellerInvites()]);setData(next);setInvites(links);}
  useEffect(()=>{void load().catch(e=>setError(messageOf(e))).finally(()=>setLoading(false));},[]);
  async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await load();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
  return <section className="admin-content commerce-content"><div className="section-heading"><div><h2>代理管理</h2><p>指定代理商、管理采购价格与邀请链接，查询代理购买明细。</p></div>{tab==='agents'&&<button className="btn primary" onClick={()=>setAdding(true)}>指定代理商</button>}</div>
    <nav className="commerce-tabs" aria-label="代理管理分类">{[['agents','代理商'],['prices','统一代理价格'],['orders','代理购买明细'],['invites','邀请链接']].map(([id,label])=><button key={id} className={`btn ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<ErrorPanel error={error}/>}{loading?<Loading/>:<>
      {tab==='agents'&&(!data?.items.length?<div className="panel commerce-empty">尚未指定代理商。选择已注册用户即可开通代理采购权限。</div>:data.items.map(agent=><article className="panel commerce-reseller" key={agent.user_id}>
        <div className="section-heading"><div><h3>{agent.name} <span className="commerce-status" data-paid={agent.enabled}>{agent.enabled?'使用中':'已停用'}</span></h3><p>{agent.user_name} · {agent.email} · {agent.customers} 位客户</p></div><div className="commerce-toolbar"><button className="btn" onClick={()=>setEditing(agent)}>专属价格</button><button className="btn" disabled={busy} onClick={()=>void run(()=>commerceApi.status(agent.user_id,!agent.enabled))}>{agent.enabled?'停用采购':'启用采购'}</button></div></div>
        <div className="commerce-reseller-prices">{agent.prices.map(p=><div key={p.tier_id}>{p.name} · {p.price??'未配置'} USDT<small>{p.override_price?'专属代理价':'统一代理价'} · {p.duration_days} 天</small></div>)}</div>
        <label>客户邀请链接<input readOnly value={`https://proxy.kividas.com/i/${agent.short_code}`} onFocus={e=>e.currentTarget.select()}/></label>
      </article>))}
      {tab==='prices'&&data&&<Prices prices={data.defaults} scope="default" onSaved={async()=>{await load();notify('统一代理价已保存');}}/>}
      {tab==='orders'&&<TransactionList fixedSource="reseller"/>}
      {tab==='invites'&&<ResellerInvites/>}
    </>}
    {adding&&<Modal title="指定已注册用户为代理商" onClose={()=>setAdding(false)} wide>
      {error&&<ErrorPanel error={error}/>}
      <form className="commerce-assign" onSubmit={e=>{e.preventDefault();void run(async()=>{await commerceApi.assign(selected,invite,name);setAdding(false);setSelected('');setName('');setInvite('');notify('代理商已开通');});}}>
        <label>搜索注册用户<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="用户邮箱或名称"/></label><button type="button" className="btn" disabled={busy||!search.trim()} onClick={()=>void run(async()=>setUsers((await commerceApi.users(search)).users))}>搜索</button>
        <div className="commerce-user-results">{users.map(u=><label key={u.id}><input type="radio" name="reseller-user" required checked={selected===u.id} onChange={()=>setSelected(u.id)}/><span>{u.name} · {u.email}{data?.items.some(a=>a.user_id===u.id)?'（已是代理）':''}</span></label>)}</div>
        <label>代理名称<input maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="留空使用用户名称"/></label>
        <label>关联邀请链接<select value={invite} onChange={e=>setInvite(e.target.value)}><option value="">创建新的专属邀请链接</option>{invites.filter(i=>!data?.items.some(a=>a.invite_id===i.id)).map(i=><option key={i.id} value={i.id}>{i.name}（{i.customers} 位客户）</option>)}</select></label>
        <p className="muted">代理商可按代理价采购激活码，仅能查看自己的订单。邀请客户继续使用兑换码开通。</p><button className="btn primary" disabled={busy||!selected||data?.items.some(a=>a.user_id===selected)}>开通代理权限</button>
      </form>
    </Modal>}
    {editing&&<Modal title={`${editing.name} · 专属价格`} onClose={()=>setEditing(undefined)} wide><Prices prices={editing.prices} scope={editing.user_id} onSaved={async()=>{await load();notify('专属代理价已保存');}}/></Modal>}
  </section>;
}
