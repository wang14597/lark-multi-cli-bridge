// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';
import type { SdkLogger } from './sdk-logger.js';

export interface LarkClientOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
  // Optional custom logger. Without it, the SDK falls back to console.log
  // which truncates nested error payloads via util.inspect's default
  // depth. Pass adaptLarkLogger(workerPino) at the call site to get full
  // structured errors in the worker log file.
  logger?: SdkLogger;
}

export function createLarkClient(opts: LarkClientOpts): Lark.Client {
  return new Lark.Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
    loggerLevel: Lark.LoggerLevel.warn,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}

/**
 * Resolve the app owner's open_id. Returns undefined if the SDK can't answer.
 * The Lark Open Platform exposes the app owner via application.application.get;
 * exact field names depend on SDK version. If unavailable, callers should fall back
 * to the LMCB_APP_OWNER_OPEN_ID env var.
 */
export async function fetchAppOwnerOpenId(client: Lark.Client, appId: string): Promise<string | undefined> {
  try {
    // Cast to a relaxed shape because SDK type narrowness differs across versions.
    const sdk = client as unknown as { application?: { application?: { get?: (req: unknown) => Promise<unknown> } } };
    const get = sdk.application?.application?.get;
    if (typeof get !== 'function') return undefined;
    // `lang` is mandatory: the API 400s with "lang is required" without it,
    // which made this helper silently return undefined on every startup.
    const res = (await get({ path: { app_id: appId }, params: { lang: 'zh_cn' } })) as {
      data?: {
        app?: { owner?: { open_id?: string; owner_id?: string }; creator_id?: string };
      };
    };
    const owner = res.data?.app?.owner;
    // owner.owner_id is the populated field on real payloads; open_id kept
    // for older SDK shapes. Self-built apps may return an owner object with
    // empty ids — creator_id is always populated, fall back to it.
    return (
      owner?.open_id || owner?.owner_id || res.data?.app?.creator_id || undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Resolve the bot's own open_id via GET /open-apis/bot/v3/info.
 * This is the open_id that Lark uses when the bot is @-mentioned in group chats.
 * Returns undefined if the API is unavailable; callers should fall back to
 * the LMCB_BOT_OPEN_ID env var.
 */
export async function fetchBotSelfOpenId(client: Lark.Client, _appId: string): Promise<string | undefined> {
  try {
    // Go through Client.request, NOT the raw httpInstance: only the former
    // injects the tenant token and prefixes the domain. The raw axios
    // instance has neither, so a relative-URL request through it always
    // threw and this helper silently returned undefined — every worker
    // logged "bot self open_id NOT resolved".
    const res = (await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' })) as {
      bot?: { open_id?: string };
      data?: { bot?: { open_id?: string } };
    };
    // Handle both unwrapped (res.bot) and wrapped (res.data.bot) shapes.
    return res.bot?.open_id ?? res.data?.bot?.open_id ?? undefined;
  } catch {
    return undefined;
  }
}
