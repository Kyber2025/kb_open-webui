import { expect, it } from 'vitest';
import { inviteTokenFromLocation, resellerInviteLink } from '../src/lib/reseller-invites';

it('uses opaque short paths without exposing the legacy invitation token', () => {
  const link = resellerInviteLink('https://chat.kividas.com', { token:'legacy-secret',short_code:'AbCd1234_-xy' });
  expect(link).toBe('https://proxy.kividas.com/i/AbCd1234_-xy');
  expect(inviteTokenFromLocation(new URL(link))).toBe('AbCd1234_-xy');
  expect(inviteTokenFromLocation(new URL(link + '/'))).toBe('AbCd1234_-xy');
});
it('keeps existing invitation links usable and leaves the homepage uninvited', () => {
  const link = resellerInviteLink('https://chat.kividas.com', {token:'legacy-secret'});
  expect(inviteTokenFromLocation(new URL(link))).toBe('legacy-secret');
  expect(inviteTokenFromLocation(new URL('https://chat.kividas.com/'))).toBeNull();
});
