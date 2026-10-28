// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { Checkout } from '../src/components/Subscription';
import type { SubscriptionCheckout, Tier } from '../src/lib/types';
vi.mock('../src/lib/api', () => ({ api: { checkout: vi.fn(), paymentChains: vi.fn(), subscriptionOrder: vi.fn(), buySubscription: vi.fn() } }));
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
it('starts at current price and lets an old BSC customer create a TRON order', async () => {
 const fresh = { ...old, order_id: 'kvs-'+'b'.repeat(32)+'_728126428', chain_id: '728126428', amount: '120', address: 'new-tron' };
 vi.mocked(api.buySubscription).mockResolvedValue(fresh); vi.mocked(api.subscriptionOrder).mockResolvedValue(fresh);
 await mount(); expect(host.querySelector('.kvs-price strong')?.textContent).toBe('120'); expect(host.querySelectorAll('select option')).toHaveLength(3);
 expect(api.buySubscription).not.toHaveBeenCalled(); expect(host.textContent).toContain('90 USDT');
 await act(async () => { const select = host.querySelector('select')!; select.value = '728126428'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 await click('生成 USDT'); expect(api.buySubscription).toHaveBeenCalledWith('pro', '728126428'); expect(host.querySelector('input')?.value).toBe('new-tron');
 await click('重新选择'); expect(host.querySelector('select')?.value).toBe('728126428'); expect(host.querySelector('.kvs-price strong')?.textContent).toBe('120');
});
it('does not let an old polling response overwrite the network picker', async () => {
 let resolve!: (value: SubscriptionCheckout) => void;
 vi.mocked(api.subscriptionOrder).mockImplementation(() => new Promise(r => { resolve = r; }));
 await mount(old, true); expect(host.querySelector('input')?.value).toBe('old-bsc');
 await click('重新选择'); await act(async () => resolve(old));
 expect(host.querySelector('.kvs-price strong')?.textContent).toBe('120'); expect(host.querySelector('select')).not.toBeNull(); expect(host.querySelector('input')).toBeNull();
});
it('waits for existing order lookup before allowing a new payment', async () => {
 let resolve!: (value: SubscriptionCheckout | null) => void;
 vi.mocked(api.checkout).mockImplementation(() => new Promise(r => { resolve = r; }));
 await mount(null); expect(host.querySelector<HTMLButtonElement>('.kvs-checkout-action')?.disabled).toBe(true);
 await act(async () => resolve(old)); expect(host.querySelector<HTMLButtonElement>('.kvs-checkout-action')?.disabled).toBe(false); expect(host.querySelector('select')).not.toBeNull();
});
it('keeps paid administrator handling visible and never offers another payment', async () => {
 await mount({ ...old, status: 'PAID_REQUIRES_ADMIN' });
 expect(host.textContent).toContain('联系管理员'); expect(host.querySelector('select')).toBeNull(); expect(api.subscriptionOrder).not.toHaveBeenCalled();
 expect(host.textContent).not.toContain('重新选择');
});
