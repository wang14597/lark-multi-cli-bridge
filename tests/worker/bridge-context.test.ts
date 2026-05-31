// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildBridgeContext } from '../../src/worker/bridge-context.js';
import type { IngressMessage } from '../../src/lark/types.js';

const baseMsg: IngressMessage = {
  chatId: 'oc_x',
  chatType: 'p2p',
  senderOpenId: 'ou_user',
  messageId: 'om_1',
  text: 'hi',
  mentions: [],
  rawType: 'text',
  attachments: [],
  receivedAt: new Date().toISOString(),
};

describe('buildBridgeContext', () => {
  it('emits a minimal bridge_context block', () => {
    const prefix = buildBridgeContext(baseMsg);
    expect(prefix).toMatch(/<bridge_context>[\s\S]+chat_id: oc_x[\s\S]+<\/bridge_context>/);
  });

  it('includes quoted_message when present', () => {
    const prefix = buildBridgeContext({
      ...baseMsg,
      quoted: {
        id: 'om_q',
        senderOpenId: 'ou_q',
        createdAt: 'now',
        type: 'text',
        content: 'orig',
      },
    });
    expect(prefix).toContain('<quoted_message id="om_q"');
    expect(prefix).toContain('orig');
  });

  it('includes interactive_card block when cardJson present', () => {
    const card = JSON.stringify({ schema: '2.0', body: { elements: [] } });
    const prefix = buildBridgeContext({ ...baseMsg, cardJson: card });
    expect(prefix).toContain('<interactive_card>');
    expect(prefix).toContain('"schema": "2.0"');
  });
});
