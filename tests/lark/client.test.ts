// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import type * as Lark from '@larksuiteoapi/node-sdk';
import { fetchBotSelfOpenId, fetchAppOwnerOpenId } from '../../src/lark/client.js';

interface FakeClient {
  request: ReturnType<typeof vi.fn>;
  application: { application: { get: ReturnType<typeof vi.fn> } };
}

function makeClient(overrides?: Partial<FakeClient>): { client: Lark.Client; fake: FakeClient } {
  const fake: FakeClient = {
    request:
      overrides?.request ??
      vi.fn().mockResolvedValue({ bot: { open_id: 'ou_bot_self' }, code: 0, msg: 'ok' }),
    application: overrides?.application ?? {
      application: {
        get: vi.fn().mockResolvedValue({
          data: { app: { owner: { owner_id: 'ou_owner' }, creator_id: 'ou_creator' } },
        }),
      },
    },
  };
  return { client: fake as unknown as Lark.Client, fake };
}

describe('fetchBotSelfOpenId', () => {
  it('resolves open_id via the authenticated client.request (not raw httpInstance)', async () => {
    // The raw httpInstance has no auth interceptor and no domain baseURL, so a
    // relative-URL request through it always throws and the helper silently
    // returned undefined — every worker logged "bot self open_id NOT resolved".
    const { client, fake } = makeClient();
    const openId = await fetchBotSelfOpenId(client, 'cli_app');
    expect(openId).toBe('ou_bot_self');
    expect(fake.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/open-apis/bot/v3/info' }),
    );
  });

  it('handles the wrapped data.bot shape', async () => {
    const { client } = makeClient({
      request: vi.fn().mockResolvedValue({ data: { bot: { open_id: 'ou_wrapped' } } }),
    });
    expect(await fetchBotSelfOpenId(client, 'cli_app')).toBe('ou_wrapped');
  });

  it('returns undefined when the request throws', async () => {
    const { client } = makeClient({ request: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(await fetchBotSelfOpenId(client, 'cli_app')).toBeUndefined();
  });
});

describe('fetchAppOwnerOpenId', () => {
  it('passes the mandatory lang param (API 400s with "lang is required" without it)', async () => {
    const { client, fake } = makeClient();
    const openId = await fetchAppOwnerOpenId(client, 'cli_app');
    expect(openId).toBe('ou_owner');
    expect(fake.application.application.get).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { app_id: 'cli_app' },
        params: expect.objectContaining({ lang: expect.any(String) }),
      }),
    );
  });

  it('falls back to creator_id when owner has no usable id', async () => {
    // Real payloads carry owner.owner_id, but self-built apps may return an
    // owner object with empty ids while creator_id is always populated.
    const { client } = makeClient({
      application: {
        application: {
          get: vi.fn().mockResolvedValue({
            data: { app: { owner: { owner_id: '' }, creator_id: 'ou_creator' } },
          }),
        },
      },
    });
    expect(await fetchAppOwnerOpenId(client, 'cli_app')).toBe('ou_creator');
  });

  it('returns undefined when the API throws', async () => {
    const { client } = makeClient({
      application: { application: { get: vi.fn().mockRejectedValue(new Error('400')) } },
    });
    expect(await fetchAppOwnerOpenId(client, 'cli_app')).toBeUndefined();
  });
});
