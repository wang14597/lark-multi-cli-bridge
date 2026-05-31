// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { isAuthorized, isAdmin } from '../../src/auth/access-control.js';

const access = (over: Partial<{ allowed_users: string[]; allowed_chats: string[]; admins: string[] }> = {}) => ({
  allowed_users: [] as string[],
  allowed_chats: [] as string[],
  admins: [] as string[],
  ...over,
});

describe('isAuthorized', () => {
  it('allows everyone when both lists are empty', () => {
    expect(isAuthorized({ access: access(), senderOpenId: 'ou_anyone', chatId: 'oc_a', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('drops a non-whitelisted user', () => {
    expect(
      isAuthorized({
        access: access({ allowed_users: ['ou_alice'] }),
        senderOpenId: 'ou_bob',
        chatId: 'oc_a',
        appOwnerOpenId: 'ou_owner',
      }),
    ).toBe(false);
  });
  it('always allows the app owner', () => {
    expect(
      isAuthorized({
        access: access({ allowed_users: ['ou_alice'] }),
        senderOpenId: 'ou_owner',
        chatId: 'oc_anything',
        appOwnerOpenId: 'ou_owner',
      }),
    ).toBe(true);
  });
});

describe('isAdmin', () => {
  it('treats app owner as admin even without explicit listing', () => {
    expect(isAdmin({ access: access(), senderOpenId: 'ou_owner', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('honors explicit admins list', () => {
    expect(isAdmin({ access: access({ admins: ['ou_admin'] }), senderOpenId: 'ou_admin', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('non-admin denies', () => {
    expect(isAdmin({ access: access(), senderOpenId: 'ou_random', appOwnerOpenId: 'ou_owner' })).toBe(false);
  });
});
