// SPDX-License-Identifier: MIT
import type { Logger } from 'pino';
import type { CardActionEvent } from '../lark/card-action.js';
import type { Dispatcher } from './dispatcher.js';
import type { IngressMessage } from '../lark/types.js';
import type { AccessConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { ParsedCommand } from '../commands/router.js';
import type { DispatchCommand } from './dispatch-command.js';
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
   * Run an internal command on behalf of a card button click. Wired in
   * worker/index.ts to dispatch through the same CommandRouter the typed
   * `/command` path uses, with reply/replyCard targeting the click's chat.
   * Receives an already-parsed `{ name, args }` so a workspace name carrying
   * whitespace survives intact (no slash-string re-split). Optional so unit
   * tests exercising the __claude_cb / stop paths don't have to provide it.
   */
  dispatchCommand?: DispatchCommand;
}

/**
 * Translate an internal card `cmd` (the `value.cmd` set by command-cards.ts
 * buttons) into a structured `{ name, args }` command. Returns undefined for
 * commands not routed this way (e.g. `stop`, handled inline) or for malformed
 * values (e.g. `ws.use` without a name).
 *
 * The free-form `value.name` is carried as a single discrete arg — never
 * spliced into a space-joined string — so names with whitespace/newlines
 * route to the exact workspace the card showed, not a truncated prefix.
 */
export function cmdToCommand(
  cmd: string | undefined,
  value: Record<string, unknown>,
): ParsedCommand | undefined {
  switch (cmd) {
    case 'new':
      return { name: 'new', args: [] };
    case 'status':
      return { name: 'status', args: [] };
    case 'help':
      return { name: 'help', args: [] };
    case 'ws.list':
      return { name: 'ws', args: ['list'] };
    case 'ws.use': {
      const name = typeof value['name'] === 'string' ? value['name'] : undefined;
      return name ? { name: 'ws', args: ['use', name] } : undefined;
    }
    case 'ws.remove': {
      const name = typeof value['name'] === 'string' ? value['name'] : undefined;
      return name ? { name: 'ws', args: ['remove', name] } : undefined;
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
    const command = cmdToCommand(act.cmd, act.value);
    if (command !== undefined && dispatchCommand !== undefined) {
      log.info({ chatId: act.chatId, cmd: act.cmd, command }, 'card-action: internal cmd -> dispatch');
      // dispatchCommand owns the user-visible failure path (best-effort
      // fallback reply); this catch is the last-resort net so a thrown
      // rejection can never escape into the WS event loop.
      try {
        await dispatchCommand(command, { chatId: act.chatId, operatorOpenId: act.operatorOpenId });
      } catch (err) {
        log.error({ err: (err as Error).message, cmd: act.cmd }, 'card-action dispatch failed');
      }
      return;
    }

    log.info({ cmd: act.cmd }, 'unknown card action');
  };
}
