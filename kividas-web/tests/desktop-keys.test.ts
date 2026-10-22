import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopKeysApi, desktopKeyStatus, desktopClientText, validDesktopConcurrency, type DesktopKey } from '../src/lib/desktop-keys';
afterEach(() => vi.unstubAllGlobals());
const key: DesktopKey = { id: 'id', concurrentLimit:0, canReveal:true, lastRevealedAt:null, label: 'Laptop', suffix: '1234', createdAt: '2026-10-22', expiresAt: '2027-01-01', revokedAt: null, revokeReason: null, boundAt: null, lastUsedAt: null };
describe('desktop key administration', () => {
  it('accepts zero and arbitrary nonnegative integers without a preset ceiling', () => {
    for(const value of ['0','12','24','32','1234']) expect(validDesktopConcurrency(value)).toBe(true);
    for(const value of ['','-1','1.5','no']) expect(validDesktopConcurrency(value)).toBe(false);
  });
  it('uses only admin desktop endpoints and never submits web keys or arbitrary gateway user ids', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('localStorage', {getItem: () => 'admin-session'});
    await desktopKeysApi.list('user/a'); await desktopKeysApi.create('user/a'); await desktopKeysApi.revoke('user/a','key/b');
    expect(fetch.mock.calls.map((c:any) => c[0])).toEqual(['/api/v1/kyber/admin/users/user%2Fa/desktop-keys','/api/v1/kyber/admin/users/user%2Fa/desktop-keys','/api/v1/kyber/admin/users/user%2Fa/desktop-keys/key%2Fb/revoke']);
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body)).toEqual({concurrentLimit:0});
  });
  it('gives revocation precedence over expiry and device binding', () => {
    expect(desktopKeyStatus(key,0)).toBe('等待首次使用');
    expect(desktopKeyStatus({...key,boundAt:'2026-10-22'},0)).toBe('已绑定电脑');
    expect(desktopKeyStatus(key,Date.parse('2028-01-01'))).toBe('订阅已到期');
    expect(desktopKeyStatus({...key,revokedAt:'2026-10-23'},Date.parse('2028-01-01'))).toBe('已停用');
  });
  it('exports only the newly issued credential and the intended customer email', () => {
    const txt=desktopClientText({key,token:'demo-not-a-real-key',gatewayUrl:'https://gateway.example/api',usageUrl:'https://chat.example/'},'customer@example.invalid');
    expect(txt).toContain('demo-not-a-real-key'); expect(txt).toContain('customer@example.invalid'); expect(txt).toContain('不包含密码'); expect(txt).toContain('不能登录 Chat');
  });
});
