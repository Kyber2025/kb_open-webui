import type { ResellerInvite } from './api';

export const RESELLER_PORTAL_HOST = 'proxy.kividas.com';

export function inviteTokenFromLocation(location: { pathname: string; search: string }): string | null {
  const shortPath = /^\/i\/([^/]+)\/?$/.exec(location.pathname);
  return shortPath ? shortPath[1] : new URLSearchParams(location.search).get('invite');
}

export function resellerInviteLink(origin: string, invite: Pick<ResellerInvite, 'token' | 'short_code'>): string {
  return invite.short_code
    ? `https://${RESELLER_PORTAL_HOST}/i/${encodeURIComponent(invite.short_code)}`
    : `${origin}/auth?invite=${encodeURIComponent(invite.token)}`;
}
