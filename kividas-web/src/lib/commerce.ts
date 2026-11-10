import { request, rawRequest } from './api';
import type { GiftCard, User } from './types';
const base = '/api/v1/commerce';
const post = <T>(path: string, body?: unknown) => request<T>(base + path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export type Price = { tier_id: string; name: string; duration_days: number; default_price: string | null; override_price: string | null; price: string | null; retail_price: string; remaining?: number };
export type Reseller = { user_id: string; invite_id: string; name: string; user_name: string; email: string; enabled: boolean; invite_enabled: boolean; short_code: string; customers: number; created_at: number; prices: Price[] };
export type Profile = { is_reseller: boolean; enabled?: boolean; name?: string; short_code?: string; prices?: Price[]; chains?: {id:string;name:string}[] };
export type Transaction = { id: string; source: string; user_id?: string; actor_id?: string; buyer?: Pick<User,'id'|'name'|'email'>; actor?: Pick<User,'id'|'name'|'email'>;
  tier_id?: string; tier_name?: string; quantity: number; duration_days?: number; unit_price?: string; amount?: string; chain_id?: string;
  status: string; fulfilled: boolean; batch_id?: string; address?: string; tx_hash?: string; payment?: Record<string, unknown>;
  collections?: { items: Record<string, unknown>[]; shared: boolean; unmatched?: Record<string, unknown>[] }; note?: string; expires_at?: number; created_at: number; synced_at?: number; cards?: GiftCard[] };
export type Filters = Record<string, string | number | undefined>;
export type TransactionPage = { items: Transaction[]; total: number; page: number; page_size: number; synced_at?: number };
const query = (values: Filters) => { const q = new URLSearchParams(); for (const [k,v] of Object.entries(values)) if (v !== '' && v !== undefined) q.set(k,String(v)); return q.toString(); };
export const commerceApi = {
  resellers: () => request<{ items: Reseller[]; defaults: Price[] }>(base+'/admin/resellers'),
  assign: (user_id: string, invite_id?: string, name?: string) => post('/admin/resellers', {user_id, invite_id: invite_id || null, name: name || null}),
  status: (id: string, enabled: boolean) => post(`/admin/resellers/${encodeURIComponent(id)}/status`, {enabled}),
  price: (scope: string, tier_id: string, price: string | null) => post('/admin/prices', {scope,tier_id,price}),
  profile: () => request<Profile>(base+'/reseller/me'),
  users: (search: string) => request<{users: User[]; total: number}>('/api/v1/users/?limit=20&query='+encodeURIComponent(search)),
  purchase: (tier_id: string, quantity: number, chain_id: string, request_id: string) => post<Transaction>('/reseller/purchases', {tier_id,quantity,chain_id,request_id}),
  order: (id: string) => request<Transaction>(base+'/reseller/purchases/'+encodeURIComponent(id)),
  transactions: (filters: Filters, own=false) => request<TransactionPage>(base+(own ? '/reseller/purchases' : '/admin/transactions')+'?'+query(filters)),
  sync: () => post<{synced_at:number; updated:number}>('/admin/transactions/sync'),
  retry: (id: string) => post<{success:boolean;fulfilled:boolean}>(`/admin/transactions/${encodeURIComponent(id)}/retry`),
  export: async (filters: Filters, own=false) => {
    const response = await rawRequest(base+(own ? '/reseller/purchases' : '/admin/transactions')+'/export?'+query(filters));
    const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
    a.href=url; a.download=own?'代理购买明细.csv':'交易明细.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
};
export const sources: Record<string,string> = {subscription:'普通用户购买',reseller:'代理购买',manual:'管理员发码',payment:'支付平台记录'};
export const statuses: Record<string,string> = {CREATING:'创建中',PENDING:'待支付',PAID:'已到账',PAID_REQUIRES_ADMIN:'已到账 · 待处理',EXPIRED_CHECKING:'过期核对中',EXPIRED:'已过期',CANCELLED:'已取消',FAILED:'失败',ISSUED:'已发码'};
export const chains: Record<string,string> = {'56':'BSC','1':'Ethereum','728126428':'TRON','-1':'Solana'};
export function transactionLink(chain: string | undefined, hash: unknown) {
  const root: Record<string,string> = {'56':'https://bscscan.com/tx/','1':'https://etherscan.io/tx/','728126428':'https://tronscan.org/#/transaction/','-1':'https://solscan.io/tx/'};
  return chain && root[chain] && typeof hash === 'string' && hash ? root[chain]+encodeURIComponent(hash) : undefined;
}
export const commerceDate = (seconds?: number) => seconds ? new Date(seconds*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
