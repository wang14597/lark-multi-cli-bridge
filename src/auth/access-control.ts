// SPDX-License-Identifier: MIT
import type { AccessSchema } from '../config/schema.js';
import type { z } from 'zod';

export type Access = z.infer<typeof AccessSchema>;

export interface AuthCheckInput {
  access: Access;
  senderOpenId: string;
  chatId: string;
  appOwnerOpenId?: string;
}

export function isAuthorized(input: AuthCheckInput): boolean {
  if (input.appOwnerOpenId && input.senderOpenId === input.appOwnerOpenId) return true;
  if (input.access.allowed_users.length > 0 && !input.access.allowed_users.includes(input.senderOpenId)) {
    return false;
  }
  if (input.access.allowed_chats.length > 0 && !input.access.allowed_chats.includes(input.chatId)) {
    return false;
  }
  return true;
}

export function isAdmin(input: {
  access: Access;
  senderOpenId: string;
  appOwnerOpenId?: string;
}): boolean {
  if (input.appOwnerOpenId && input.senderOpenId === input.appOwnerOpenId) return true;
  return input.access.admins.includes(input.senderOpenId);
}
