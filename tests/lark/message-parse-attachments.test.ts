// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseIngressEvent } from '../../src/lark/message-parse.js';

const imageMsg = {
  event: {
    sender: { sender_id: { open_id: 'ou_u' } },
    message: {
      message_id: 'om_img',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'image',
      create_time: '1700000000000',
      content: JSON.stringify({ image_key: 'img_k_1' }),
      mentions: [],
    },
  },
};

describe('parseIngressEvent attachments', () => {
  it('exposes image_key as a raw attachment', () => {
    const m = parseIngressEvent(imageMsg);
    expect(m?.attachments).toEqual([
      { fileKey: 'img_k_1', fileName: 'image-img_k_1.png', type: 'image' },
    ]);
  });
});
