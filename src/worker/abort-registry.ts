// SPDX-License-Identifier: MIT
import type { AbortRegistry } from '../commands/handlers/stop.js';
import type { Dispatcher } from './dispatcher.js';

export function abortRegistryFromDispatcher(d: Dispatcher): AbortRegistry {
  return { abort: (chatId) => d.abort(chatId) };
}
