// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { Checkout, Subscription } from '../src/components/Subscription';
import type { SubscriptionCheckout, Tier } from '../src/lib/types';
vi.mock('../src/lib/api', () => ({ api: { checkout: vi.fn(), paymentChains: vi.fn(), subscriptionOrder: vi.fn(), buySubscription: vi.fn(), cancelSubscriptionOrder: vi.fn(), subscription: vi.fn(), plans: vi.fn(), redeem: vi.fn() } }));
const old = { order_id: 'kvs-'+'a'.repeat(32)+'_56', tier_id: 'pro', tier_name: 'Max 5x', chain_id: '56', amount: '90', address: 'old-bsc', status: 'PENDING', expires_at: 1900000000, activated: false } as SubscriptionCheckout;
const plan = { id: 'pro', name: 'Max 5x', price_usd: 120, duration_days: 30 } as Tier;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
 vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
 HTMLDialogElement.prototype.showModal = function() { this.open = true; };
 HTMLDialogElement.prototype.close = function() { this.open = false; };
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 vi.mocked(api.checkout).mockResolvedValue(old);
 vi.mocked(api.paymentChains).mockResolvedValue([{ id: '56', name: 'BSC' }, { id: '1', name: 'Ethereum' }, { id: '728126428', name: 'TRON' }]);
 vi.mocked(api.subscriptionOrder).mockResolvedValue(old);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async (initial: SubscriptionCheckout | null = old, resume = false) => { await act(async () => root.render(<Checkout plan={plan} initial={initial} upgrade={false} resume={resume} onClose={() => {}} onPaid={async () => {}} />)); };
const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); };
it('resumes the reserved quote and prevents creating another network invoice', async () => {
 await mount();
 expect(host.querySelector('.kvs-price strong')?.textContent).toBe('90');
 expect(host.querySelector('input')?.value).toBe('old-bsc');
 expect(host.querySelector('select')).toBeNull();
 expect(host.textContent).not.toContain('重新选择');
 expect(api.buySubscription).not.toHaveBeenCalled();
});
it('allows a new network only after the old order is finally expired', async () => {
 await mount({...old,status:'EXPIRED'});
 await click('重新选择');
 expect(host.querySelector('.kvs-price strong')?.textContent).toBe('120');
 const fresh={...old,order_id:'fresh',chain_id:'728126428',amount:'120',address:'new-tron'};
 vi.mocked(api.buySubscription).mockResolvedValue(fresh);vi.mocked(api.subscriptionOrder).mockResolvedValue(fresh);
 await act(async()=>{const select=host.querySelector('select')!;select.value='728126428';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('生成 USDT');
 expect(api.buySubscription).toHaveBeenCalledWith('pro','728126428');
 expect(host.querySelector('input')?.value).toBe('new-tron');
});
it('waits for existing order lookup then resumes its reserved address', async () => {
 let resolve!: (value: SubscriptionCheckout | null) => void;
 vi.mocked(api.checkout).mockImplementation(() => new Promise(r => { resolve = r; }));
 await mount(null); expect(host.querySelector<HTMLButtonElement>('.kvs-checkout-action')?.disabled).toBe(true);
 await act(async () => resolve(old));
 expect(host.querySelector('select')).toBeNull();expect(host.querySelector('input')?.value).toBe('old-bsc');
 expect(api.buySubscription).not.toHaveBeenCalled();
});
it('keeps paid administrator handling visible and never offers another payment', async () => {
 await mount({ ...old, status: 'PAID_REQUIRES_ADMIN' });
 expect(host.textContent).toContain('联系管理员'); expect(host.querySelector('select')).toBeNull(); expect(api.subscriptionOrder).not.toHaveBeenCalled();
 expect(host.textContent).not.toContain('重新选择');
});
const cancelButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === '取消订单');
it('cancels an unpaid order only after an explicit confirmation', async () => {
 vi.mocked(api.cancelSubscriptionOrder).mockResolvedValue({ cancelled: true, order: { ...old, status: 'CANCELLED' } });
 await mount();
 await click('取消订单');
 expect(host.textContent).toContain('如已转账请不要取消'); expect(api.cancelSubscriptionOrder).not.toHaveBeenCalled();
 await click('返回');
 expect(host.textContent).not.toContain('如已转账请不要取消'); expect(cancelButton()).toBeTruthy();
 await click('取消订单'); await click('确认取消');
 expect(api.cancelSubscriptionOrder).toHaveBeenCalledWith(old.order_id);
 expect(host.textContent).toContain('订单已取消'); expect(host.querySelector('input')).toBeNull(); expect(cancelButton()).toBeUndefined();
 await click('重新选择');
 expect(host.querySelector('select')).not.toBeNull(); expect(host.querySelector('.kvs-price strong')?.textContent).toBe('120');
});
it('keeps the order on screen when the payment arrived before the cancel', async () => {
 vi.mocked(api.cancelSubscriptionOrder).mockRejectedValue(new Error('付款已到账，订单不能取消'));
 await mount();
 await click('取消订单'); await click('确认取消');
 expect(host.textContent).toContain('付款已到账，订单不能取消');
 expect(host.querySelector('input')?.value).toBe('old-bsc');
});
it('shows the settled state instead of "cancelled" when the server reports the payment won', async () => {
 const paid = { ...old, status: 'PAID_REQUIRES_ADMIN' };
 vi.mocked(api.cancelSubscriptionOrder).mockResolvedValue({ cancelled: false, order: paid });
 await mount();
 await click('取消订单'); await click('确认取消');
 expect(host.textContent).toContain('联系管理员'); expect(host.textContent).not.toContain('订单已取消'); expect(cancelButton()).toBeUndefined();
});
it.each(['PAID', 'PAID_REQUIRES_ADMIN', 'EXPIRED', 'FAILED', 'CANCELLED'])('never offers cancellation for a %s order', async (status) => {
 vi.mocked(api.subscriptionOrder).mockResolvedValue({ ...old, status });
 await mount({ ...old, status });
 expect(cancelButton()).toBeUndefined();
});
it('offers cancellation while an ended payment window is still being verified', async () => {
 vi.mocked(api.subscriptionOrder).mockResolvedValue({ ...old, status: 'EXPIRED_CHECKING' });
 await mount({ ...old, status: 'EXPIRED_CHECKING' });
 expect(cancelButton()).toBeTruthy();
});
it('cancels from the pending-order banner and re-enables purchasing', async () => {
 vi.mocked(api.subscription).mockResolvedValue({ tier: { id: 'free', name: 'Free' } });
 vi.mocked(api.plans).mockResolvedValue([{ ...plan, enabled: true, can_purchase: true, remaining: 2, sort_order: 1 } as Tier]);
 vi.mocked(api.checkout).mockReset().mockResolvedValueOnce(old).mockResolvedValue(null);
 vi.mocked(api.cancelSubscriptionOrder).mockResolvedValue({ cancelled: true, order: { ...old, status: 'CANCELLED' } });
 const changed = vi.fn(async () => {});
 await act(async () => root.render(<Subscription onClose={() => {}} onChanged={changed} />));
 const buy = () => host.querySelector<HTMLButtonElement>('.kvs-purchase button')!;
 expect(host.textContent).toContain('有一笔待处理的 Max 5x 订单'); expect(buy().disabled).toBe(true);
 await click('取消订单'); await click('确认取消');
 expect(api.cancelSubscriptionOrder).toHaveBeenCalledWith(old.order_id);
 expect(host.textContent).not.toContain('有一笔待处理'); expect(host.textContent).toContain('订单已取消');
 expect(buy().disabled).toBe(false); expect(changed).toHaveBeenCalled();
});
it('reloads the real order state when the banner cancel is refused', async () => {
 vi.mocked(api.subscription).mockResolvedValue({ tier: { id: 'free', name: 'Free' } });
 vi.mocked(api.plans).mockResolvedValue([{ ...plan, enabled: true, can_purchase: true, remaining: 2, sort_order: 1 } as Tier]);
 vi.mocked(api.checkout).mockReset().mockResolvedValueOnce(old).mockResolvedValue({ ...old, status: 'PAID_REQUIRES_ADMIN' });
 vi.mocked(api.cancelSubscriptionOrder).mockRejectedValue(new Error('付款已到账，订单不能取消'));
 await act(async () => root.render(<Subscription onClose={() => {}} onChanged={async () => {}} />));
 await click('取消订单'); await click('确认取消');
 expect(host.textContent).toContain('付款已到账，订单不能取消');
 expect(host.textContent).toContain('有一笔待处理的 Max 5x 订单'); expect(cancelButton()).toBeUndefined();
});
