// SPDX-License-Identifier: MIT
import { mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type * as Lark from '@larksuiteoapi/node-sdk';
import { paths } from '../config/paths.js';
import type { Attachment } from '../adapters/types.js';
import type { RawAttachment } from './types.js';

export interface AttachmentDownloaderOpts {
  client: Lark.Client;
  chatId: string;
}

export async function downloadAttachment(
  opts: AttachmentDownloaderOpts,
  messageId: string,
  raw: RawAttachment,
): Promise<Attachment> {
  const ext = extname(raw.fileName) || (raw.type === 'image' ? '.png' : '.bin');
  const localPath = join(paths.mediaChat(opts.chatId), `${messageId}-${raw.fileKey}${ext}`);
  await mkdir(dirname(localPath), { recursive: true, mode: 0o700 });

  const res = await opts.client.im.messageResource.get({
    path: { message_id: messageId, file_key: raw.fileKey },
    params: { type: raw.type },
  });

  // SDK returns { writeFile(filePath: string): Promise<unknown>, getReadableStream(): Readable }
  await res.writeFile(localPath);

  return {
    kind: raw.type,
    localPath,
    fileName: raw.fileName,
    ...(raw.mimeType !== undefined ? { mimeType: raw.mimeType } : {}),
  };
}
