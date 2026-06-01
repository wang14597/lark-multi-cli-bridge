// SPDX-License-Identifier: MIT
import type { Logger } from 'pino';
import type { CardActionEvent } from '../lark/card-action.js';
import type { Dispatcher } from './dispatcher.js';
import type { IngressMessage } from '../lark/types.js';
import type { AccessConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import { isAuthorized } from '../auth/access-control.js';

export interface CardActionHandlerDeps {
  access: AccessConfig;
  dispatcher: Pick<Dispatcher, 'enqueue' | 'abort'>;
  log: Logger;
  lastIngressByChat: Map<string, IngressMessage>;
  sessions: Pick<SessionStore, 'get'>;
  botDefaultCwd: string;
  botBackendType: string;
  idleTimeoutMs: number;
  appOwnerOpenId?: string;
}

export function makeCardActionHandler(deps: CardActionHandlerDeps): (act: CardActionEvent) => Promise<void> {
  return async (act) => {
    const { access, dispatcher, log, sessions, botDefaultCwd, idleTimeoutMs, appOwnerOpenId } = deps;

    log.info({ chatId: act.chatId, cmd: act.cmd, operator: act.operatorOpenId }, 'card action');

    if (!isAuthorized({
      access,
      senderOpenId: act.operatorOpenId,
      chatId: act.chatId,
      ...(appOwnerOpenId ? { appOwnerOpenId } : {}),
    })) {
      log.info({ chatId: act.chatId, sender: act.operatorOpenId }, 'card-action dropped: unauthorized');
      return;
    }

    // Priority 1: LLM callback marker. If both __claude_cb and cmd are set,
    // the LLM wins — don't preempt user-authored flows with our internal cmds.
    if (act.value['__claude_cb'] === true) {
      const stripped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(act.value)) {
        if (k !== '__claude_cb') stripped[k] = v;
      }
      const synthPrompt = `[card-click] ${JSON.stringify(stripped)}`;

      const existing = sessions.get(act.chatId);
      const cwd = existing?.cwd ?? botDefaultCwd;

      log.info({ chatId: act.chatId, synthPrompt }, 'card-action: __claude_cb -> enqueue');
      try {
        await dispatcher.enqueue({
          chatId: act.chatId,
          prompt: synthPrompt,
          cwd,
          ...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
          idleTimeoutMs,
        });
      } catch (err) {
        log.error({ err: (err as Error).message }, '__claude_cb dispatch failed');
      }
      return;
    }

    // Priority 2: internal slash-command buttons (preserved).
    switch (act.cmd) {
      case 'stop': {
        const aborted = dispatcher.abort(act.chatId);
        log.info({ chatId: act.chatId, aborted }, 'stop action');
        break;
      }
      default:
        log.info({ cmd: act.cmd }, 'unknown card action');
    }
  };
}
