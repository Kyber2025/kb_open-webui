import { useEffect, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Confirm, ErrorPanel, Loading, Modal, messageOf, useNotify } from '../components/UI';
import { riskApi, riskActions, riskDate, overrideModes, type RiskEvent, type RiskMatch, type RiskOverride, type RiskPage, type RiskPolicy, type RiskPolicyState, type RiskRule } from '../lib/request-risk';
import './request-risk.css';

export function RiskManagement() {
  const [policy, setPolicy] = useState<RiskPolicyState>(), [error, setError] = useState('');
  const [tab, setTab] = useState<'events' | 'rules' | 'users'>('events');
  async function load() { setError(''); try { setPolicy(await riskApi.policy()); } catch (e) { setError(messageOf(e)); } }
  useEffect(() => { void load(); }, []);
  return <section className="admin-content risk-content">
    <div className="section-heading"><div><h2><ShieldCheck size={22}/>风控管理</h2><p>在模型请求发出前检查项目目录与内容特征，保留规则命中及管理员处理记录。</p></div>
      {policy && <span className="risk-state" data-active={policy.enabled}>{policy.enabled ? '防护已启用' : '防护已停用'}</span>}
    </div>
    {error ? <ErrorPanel error={error} retry={load}/> : !policy ? <Loading/> : <>
      <div className="risk-tabs" role="tablist" aria-label="风控管理分类">{([['events','处理记录'],['rules','规则设置'],['users','用户处理']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      {!policy.enabled && <p className="risk-note">风控总开关已关闭：本模块的规则与用户覆盖均不生效。</p>}
      {tab === 'events' ? <RiskEvents/> : tab === 'rules' ? <RiskRules initial={policy} reload={load}/> : <RiskUsers/>}
    </>}
  </section>;
}

function Pager({page,total,size,busy,change}: {page:number;total:number;size:number;busy:boolean;change:(p:number)=>void}) {
  return <div className="risk-pager"><span>共 {total} 条 · 第 {page} 页</span><button className="btn" disabled={busy || page <= 1} onClick={()=>change(page-1)}>上一页</button><button className="btn" disabled={busy || page*size >= total} onClick={()=>change(page+1)}>下一页</button></div>;
}

export function RiskEvents() {
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[filter,setFilter]=useState(''),[action,setAction]=useState('');
  const [refresh,setRefresh]=useState(0),[data,setData]=useState<RiskPage<RiskEvent>>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [detail,setDetail]=useState<RiskEvent>();
  useEffect(()=>{let cancelled=false;setBusy(true);setError('');riskApi.events(page,filter,action).then(v=>{if(!cancelled)setData(v);}).catch(e=>{if(!cancelled)setError(messageOf(e));}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};},[page,filter,action,refresh]);
  return <div>
    <form className="risk-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setFilter(search.trim());}}><input aria-label="搜索风控记录" placeholder="搜索用户邮箱、操作人或请求ID" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="处理结果" value={action} onChange={e=>{setAction(e.target.value);setPage(1);}}><option value="">全部结果</option>{Object.entries(riskActions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className="btn">搜索</button><button type="button" className="btn" disabled={busy} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={15}/>刷新</button></form>
    <p className="muted risk-help">记录保留30天。命中依据仅包含配置中的规则特征，不保存原始对话；隐私锁定用户不写入逐请求记录。</p>
    {error && <ErrorPanel error={error}/>}
    {busy ? <Loading/> : <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>用户 / 操作人</th><th>处理结果</th><th>依据</th><th>时间（香港）</th><th>详情</th></tr></thead><tbody>{data?.items.map(r=><tr key={r.id}><td>{r.userEmail || '全局配置'}<small>{r.actorId || r.model || '—'}</small></td><td><span className="risk-badge" data-action={r.action}>{riskActions[r.action] || r.action}</span></td><td>{r.reason}<small>{r.details.matches?.map(m=>m.name).join('；')}</small></td><td>{riskDate(r.createdAt)}</td><td><button className="btn" onClick={()=>setDetail(r)}>查看</button></td></tr>)}{!data?.items.length && <tr><td colSpan={5} className="risk-empty">暂无符合条件的处理记录</td></tr>}</tbody></table></div>}
    <Pager page={page} total={data?.total || 0} size={30} busy={busy} change={setPage}/>
    {detail && <Modal title="风控处理详情" onClose={()=>setDetail(undefined)} wide><dl className="risk-details"><dt>用户</dt><dd>{detail.userEmail || '全局配置'}</dd><dt>处理结果</dt><dd>{riskActions[detail.action]}</dd><dt>原因</dt><dd>{detail.reason}</dd><dt>时间</dt><dd>{riskDate(detail.createdAt)}（香港）</dd><dt>请求ID</dt><dd>{detail.requestId || '—'}</dd><dt>接口 / 模型</dt><dd>{detail.endpoint || '—'} / {detail.model || '—'}</dd><dt>操作人</dt><dd>{detail.actorId || '规则引擎'}</dd></dl>
      {detail.details.matches?.map(m=><div className="risk-match" key={m.id}><strong>{m.name}</strong><p>{m.action === 'block' ? '拒绝规则' : '观察规则'}</p>{m.terms.map((t,i)=><code key={i}>{t}</code>)}</div>)}
      {detail.details.after !== undefined && <><h3>变更前</h3><pre className="risk-json">{JSON.stringify(detail.details.before,null,2)}</pre><h3>变更后</h3><pre className="risk-json">{JSON.stringify(detail.details.after,null,2)}</pre></>}
    </Modal>}
  </div>;
}

function RuleEditor({rule,update,remove}: {rule:RiskRule;update:(r:RiskRule)=>void;remove:()=>void}) {
  const [groups,setGroups]=useState(rule.groups.map(g=>g.join(' | ')).join('\n'));
  return <article className="risk-rule"><div className="risk-rule-title"><input aria-label="规则名称" value={rule.name} maxLength={100} onChange={e=>update({...rule,name:e.target.value})}/><label className="risk-check"><input type="checkbox" checked={rule.enabled} onChange={e=>update({...rule,enabled:e.target.checked})}/>启用</label><select aria-label={`${rule.name}处理方式`} value={rule.action} onChange={e=>update({...rule,action:e.target.value as RiskRule['action']})}><option value="block">直接拒绝</option><option value="observe">仅观察</option></select><button className="icon-btn" aria-label={`删除${rule.name}`} onClick={remove}><Trash2 size={17}/></button></div>
    <label>匹配条件<textarea aria-label={`${rule.name}匹配条件`} value={groups} rows={3} spellCheck={false} onChange={e=>{setGroups(e.target.value);update({...rule,groups:e.target.value.split('\n').map(line=>line.split('|').map(t=>t.trim()).filter(Boolean)).filter(g=>g.length)});}}/></label>
    <small className="muted">每行需同时命中；同一行用 | 分隔表示任选其一。忽略大小写、斜杠方向与重复转义，每个匹配词至少6个字符。</small>
  </article>;
}

export function RiskRules({initial,reload}: {initial:RiskPolicyState;reload:()=>Promise<void>}) {
  const [draft,setDraft]=useState<RiskPolicy>({enabled:initial.enabled,rules:initial.rules}),[reason,setReason]=useState('');
  const [text,setText]=useState(''),[matches,setMatches]=useState<RiskMatch[] | null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const notify=useNotify();
  useEffect(()=>{setDraft({enabled:initial.enabled,rules:initial.rules});setReason('');setMatches(null);},[initial]);
  function replace(index:number,rule:RiskRule){setDraft(v=>({...v,rules:v.rules.map((r,i)=>i===index?rule:r)}));setMatches(null);}
  return <div className="risk-rules">
    <div className="risk-note">规则命中只拒绝本次请求。项目相似不等于违规或封号原因；请使用具体目录或多项内容组合，避免使用“new api”等通用词。</div>
    <div className="risk-toolbar"><label className="risk-check"><input type="checkbox" checked={draft.enabled} onChange={e=>{setDraft({...draft,enabled:e.target.checked});setMatches(null);}}/>启用请求风控</label><span className="muted">版本 {initial.version} · 修改后需保存，最长5秒生效</span><button className="btn" disabled={draft.rules.length >= 32} onClick={()=>setDraft(v=>({...v,rules:[...v.rules,{id:'rule-'+crypto.randomUUID(),name:'新规则',enabled:true,action:'observe',groups:[['待填写具体项目特征']]}]}))}><Plus size={15}/>新增规则</button></div>
    {draft.rules.map((rule,i)=><RuleEditor key={`${initial.version}:${rule.id}`} rule={rule} update={r=>replace(i,r)} remove={()=>{setDraft(v=>({...v,rules:v.rules.filter((_,n)=>n!==i)}));setMatches(null);}}/>)}
    {!draft.rules.length && <p className="risk-note">当前没有规则；仍可通过“用户处理”设置手动禁用。</p>}
    <label>修改原因<input aria-label="修改原因" value={reason} minLength={3} maxLength={500} placeholder="填写本次调整原因（至少3个字符）" onChange={e=>setReason(e.target.value)}/></label>
    {error && <ErrorPanel error={error}/>}
    <div className="risk-toolbar"><button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={()=>setConfirm(true)}>保存规则</button></div>
    <div className="risk-test"><h3>检查样例</h3><p className="muted">使用当前草稿检查，不保存样例、不发送模型请求。请勿粘贴密钥。</p><textarea aria-label="检查样例" rows={4} maxLength={500000} value={text} onChange={e=>{setText(e.target.value);setMatches(null);}} placeholder="粘贴目录或请求内容片段"/><button className="btn" disabled={busy || !text.trim()} onClick={async()=>{setBusy(true);setError('');try{setMatches((await riskApi.test(draft,text)).matches);}catch(e){setError(messageOf(e));}finally{setBusy(false);}}}>检查匹配</button>{matches && <div role="status">{matches.length ? matches.map(m=><p key={m.id}>{m.action==='block'?'将拒绝':'仅观察'} · {m.name}</p>) : <p>{draft.enabled?'未命中规则':'草稿总开关已关闭，不检查规则'}</p>}</div>}</div>
    {confirm && <Confirm title="保存风控规则？" description={draft.enabled?'保存后会按这些规则检查新请求，命中拒绝规则的请求不会发送到上游。':'保存后将停止本模块的全部规则和用户覆盖。'} onClose={()=>setConfirm(false)} onConfirm={async()=>{setBusy(true);setError('');try{await riskApi.savePolicy(initial.version,draft,reason.trim());await reload();notify('风控规则已保存');}finally{setBusy(false);}}}/>}
  </div>;
}

export function RiskUsers() {
  const [data,setData]=useState<RiskPage<RiskOverride>>(),[page,setPage]=useState(1),[search,setSearch]=useState(''),[filter,setFilter]=useState(''),[refresh,setRefresh]=useState(0);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState<Partial<RiskOverride>>();
  useEffect(()=>{let cancelled=false;setBusy(true);setError('');riskApi.overrides(page,filter).then(v=>{if(!cancelled)setData(v);}).catch(e=>{if(!cancelled)setError(messageOf(e));}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};},[page,filter,refresh]);
  return <div><p className="risk-note">放行仅跳过本模块的拒绝规则，不恢复已禁用账号或失效 Key。选择“恢复按规则检查”可撤销人工覆盖；所有操作记录原因和管理员。</p>
    <form className="risk-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setFilter(search.trim());}}><input aria-label="搜索风控用户" placeholder="按用户邮箱搜索" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn">搜索</button><button type="button" className="btn" disabled={busy} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={15}/>刷新</button><button type="button" className="btn primary" onClick={()=>setEditing({version:0,mode:'block'})}><Plus size={15}/>新增用户处理</button></form>
    {error && <ErrorPanel error={error}/>}{busy ? <Loading/> : <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>用户邮箱</th><th>处理方式</th><th>原因</th><th>有效期（香港）</th><th>操作</th></tr></thead><tbody>{data?.items.map(r=><tr key={r.userId}><td>{r.email}</td><td>{overrideModes[r.mode]}{r.expiresAt && +new Date(r.expiresAt)<=Date.now() && <small>已过期，按规则检查</small>}</td><td>{r.reason}<small>{r.updatedBy} · {riskDate(r.updatedAt)}</small></td><td>{r.mode==='inherit'?'—':r.expiresAt?riskDate(r.expiresAt):'持续生效'}</td><td><button className="btn" onClick={()=>setEditing(r)}>处理</button></td></tr>)}{!data?.items.length && <tr><td colSpan={5} className="risk-empty">暂无用户人工处理记录</td></tr>}</tbody></table></div>}
    <Pager page={page} total={data?.total || 0} size={30} busy={busy} change={setPage}/>
    {editing && <OverrideEditor initial={editing} close={()=>setEditing(undefined)} saved={()=>{setEditing(undefined);setRefresh(v=>v+1);}}/>}
  </div>;
}

export function OverrideEditor({initial,close,saved}: {initial:Partial<RiskOverride>;close:()=>void;saved:()=>void}) {
  const [email,setEmail]=useState(initial.email || ''),[mode,setMode]=useState<RiskOverride['mode']>(initial.mode || 'block'),[reason,setReason]=useState(''),[duration,setDuration]=useState('24');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="管理员处理用户" onClose={close}><form className="risk-override" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await riskApi.saveOverride({email:email.trim(),mode,reason:reason.trim(),version:initial.version || 0,expiresAt:mode==='inherit'||duration==='0'?null:new Date(Date.now()+Number(duration)*3600000).toISOString()});saved();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}}>
    <label>用户邮箱<input aria-label="用户邮箱" type="email" required readOnly={!!initial.userId} value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>处理方式<select aria-label="用户处理方式" value={mode} onChange={e=>setMode(e.target.value as RiskOverride['mode'])}>{Object.entries(overrideModes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    {mode!=='inherit' && <label>本次处理有效期<select value={duration} onChange={e=>setDuration(e.target.value)}><option value="1">1小时</option><option value="24">24小时</option><option value="168">7天</option><option value="0">持续生效，直到管理员撤销</option></select></label>}
    <label>处理原因<textarea aria-label="处理原因" required minLength={3} maxLength={500} rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <p className="muted">{mode==='block'?'将拒绝该用户在本模块覆盖的模型接口发起的所有请求。':mode==='allow'?'即使命中拒绝规则，也允许该用户通过本模块检查。':'撤销人工覆盖，之后每次请求重新按规则检查。'}</p>
    {error && <ErrorPanel error={error}/>}<button className="btn primary" disabled={busy || reason.trim().length<3}>{busy?'保存中…':'确认处理'}</button>
  </form></Modal>;
}
