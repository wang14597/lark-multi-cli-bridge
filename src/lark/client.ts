// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';

export interface LarkClientOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
}

export function createLarkClient(opts: LarkClientOpts): Lark.Client {
  return new Lark.Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
    loggerLevel: Lark.LoggerLevel.warn,
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
    const res = (await get({ path: { app_id: appId } })) as {
      data?: { app?: { owner?: { open_id?: string; owner_id?: string } } };
    };
    return res.data?.app?.owner?.open_id ?? res.data?.app?.owner?.owner_id ?? undefined;
  } catch {
    return undefined;
  }
}
