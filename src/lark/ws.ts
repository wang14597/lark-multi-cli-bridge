// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'node:events';
import { parseIngressEvent } from './message-parse.js';
import type { IngressMessage } from './types.js';

export interface LarkWsOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
  botSelfOpenId?: string;
}

// SDK adaptation note: The im.message.receive_v1 handler in IHandles receives
// the event payload directly (sender + message at top level), not wrapped in
// an additional `event` key. parseIngressEvent expects { event: { sender, message } },
// so we wrap it here with a non-undefined event property to satisfy
// exactOptionalPropertyTypes.
export class LarkWsClient extends EventEmitter {
  private wsClient: Lark.WSClient | undefined;
  private eventDispatcher: Lark.EventDispatcher | undefined;
  constructor(private opts: LarkWsOpts) {
    super();
  }

  async start(): Promise<void> {
    this.eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        // The SDK passes the event fields (sender, message) at top level.
        // Wrap in { event: ... } to match the shape parseIngressEvent navigates.
        const stripIds = this.opts.botSelfOpenId !== undefined ? [this.opts.botSelfOpenId] : undefined;
        const parsed = parseIngressEvent(
          { event: data },
          stripIds !== undefined ? { stripMentionOpenIds: stripIds } : {},
        );
        if (parsed) this.emit('message', parsed satisfies IngressMessage);
      },
    });

    const wsClient = new Lark.WSClient({
      appId: this.opts.appId,
      appSecret: this.opts.appSecret,
      domain: this.opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
      loggerLevel: Lark.LoggerLevel.warn,
    });
    this.wsClient = wsClient;

    wsClient.start({ eventDispatcher: this.eventDispatcher });
  }

  async stop(): Promise<void> {
    const ws = this.wsClient;
    if (ws !== undefined) {
      ws.close();
      this.wsClient = undefined;
    }
  }
}
