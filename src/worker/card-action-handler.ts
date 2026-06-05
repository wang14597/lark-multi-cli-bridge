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
  botName: string;
  idleTimeoutMs: number;
  appOwnerOpenId?: string;
  /**
   * Run an internal slash command on behalf of a card button click. Wired in
   * worker/index.ts to dispatch through the same CommandRouter the typed
   * `/command` path uses, with reply/replyCard targeting the click's chat.
   * Optional so unit tests exercising the __claude_cb / stop paths don't have
   * to provide it.
   */
  dispatchCommand?: (
    slashText: string,
    meta: { chatId: string; operatorOpenId: string },
  ) => Promise<void>;
}

/**
 * Translate an internal card `cmd` (the `value.cmd` set by command-cards.ts
 * buttons) into the equivalent slash-command text. Returns undefined for
 * commands not routed this way (e.g. `stop`, handled inline) or for malformed
 * values (e.g. `ws.use` without a name).
 */
export function cmdToSlash(
  cmd: string | undefined,
  value: Record<string, unknown>,
): string | undefined {
  switch (cmd) {
    case 'new':
      return '/new';
    case 'status':
      return '/status';
    case 'help':
      return '/help';
    case 'ws.list':
      return '/ws list';
    case 'ws.use': {
      const name = typeof value['name'] === 'string' ? value['name'] : undefined;
      return name ? `/ws use ${name}` : undefined;
    }
    case 'ws.remove': {
      const name = typeof value['name'] === 'string' ? value['name'] : undefined;
      return name ? `/ws remove ${name}` : undefined;
    }
    default:
      return undefined;
  }
}

export function makeCardActionHandler(deps: CardActionHandlerDeps): (act: CardActionEvent) => Promise<void> {
  return async (act) => {
    const { access, dispatcher, log, sessions, botDefaultCwd, botName, idleTimeoutMs, appOwnerOpenId, dispatchCommand } = deps;

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

      // Session and cwd are scoped per (chatId, botName). A button
      // rendered by THIS bot only ever continues this bot's session;
      // sibling bots in the same chat have their own slot.
      const sessionEntry = sessions.get(act.chatId, botName);
      const cwd = sessionEntry?.cwd ?? botDefaultCwd;

      log.info({ chatId: act.chatId, synthPrompt }, 'card-action: __claude_cb -> enqueue');
      try {
        await dispatcher.enqueue({
          chatId: act.chatId,
          prompt: synthPrompt,
          cwd,
          ...(sessionEntry?.sessionId !== undefined ? { sessionId: sessionEntry.sessionId } : {}),
          idleTimeoutMs,
        });
      } catch (err) {
        log.error({ err: (err as Error).message }, '__claude_cb dispatch failed');
      }
      return;
    }

    // Priority 2: the live-run stop button aborts directly — there's no
    // command-router round trip, and it must work even mid-stream.
    if (act.cmd === 'stop') {
      const aborted = dispatcher.abort(act.chatId);
      log.info({ chatId: act.chatId, aborted }, 'stop action');
      return;
    }

    // Priority 3: every other internal button (new / status / help / ws.*)
    // routes through the same CommandRouter the typed `/command` path uses,
    // so a click and a typed command share one implementation. Without
    // dispatchCommand wired (or for an unknown cmd) the click is a no-op.
    const slash = cmdToSlash(act.cmd, act.value);
    if (slash !== undefined && dispatchCommand !== undefined) {
      log.info({ chatId: act.chatId, cmd: act.cmd, slash }, 'card-action: internal cmd -> dispatch');
      try {
        await dispatchCommand(slash, { chatId: act.chatId, operatorOpenId: act.operatorOpenId });
      } catch (err) {
        log.error({ err: (err as Error).message, cmd: act.cmd }, 'card-action dispatch failed');
      }
      return;
    }

    log.info({ cmd: act.cmd }, 'unknown card action');
  };
}
