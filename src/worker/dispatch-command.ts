// SPDX-License-Identifier: MIT
import type { Logger } from 'pino';
import type { BotConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../session/workspace.js';
import type { CommandRouter, ParsedCommand } from '../commands/router.js';
import { isAdmin } from '../auth/access-control.js';

/** The chat a card click came from, plus who clicked. */
export interface CardClickMeta {
  chatId: string;
  operatorOpenId: string;
}

/**
 * Per-chat reply closures. `worker/index.ts` builds these over the Lark SDK;
 * the card-button path and the typed-message path share one implementation so
 * both send through the identical SDK call. Single source of truth for the
 * shape so producer (index.ts) and consumers can't drift silently.
 */
export interface ChatReplies {
  reply: (text: string) => Promise<void>;
  replyCard: (card: unknown) => Promise<void>;
}

/**
 * The callback `makeCardActionHandler` invokes for an internal command button.
 * Exported so the producer here and the consumer (card-action-handler.ts) share
 * one contract — a drift in `meta` or the return type becomes a compile error
 * instead of a structurally-accepted mismatch at the wiring site.
 */
export type DispatchCommand = (cmd: ParsedCommand, meta: CardClickMeta) => Promise<void>;

export interface DispatchCommandDeps {
  router: Pick<CommandRouter, 'dispatchParsed'>;
  bot: BotConfig;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  /** Build the per-chat reply/replyCard closures (worker/index.ts wires Lark). */
  makeReplies: (chatId: string) => ChatReplies;
  log: Logger;
  appOwnerOpenId?: string;
}

function renderSlash(cmd: ParsedCommand): string {
  return cmd.args.length ? `/${cmd.name} ${cmd.args.join(' ')}` : `/${cmd.name}`;
}

/**
 * Build the `dispatchCommand` callback the card-action handler invokes when an
 * internal button (new / status / help / ws.*) is clicked. It runs the command
 * through the **same `CommandRouter`** the typed `/command` path uses, with
 * admin status recomputed from the clicker's `open_id` and reply/replyCard
 * targeting the click's chat.
 *
 * On a throw it sends a best-effort `⚠️ command failed: …` fallback instead of
 * logging silently. The realistic case this rescues is a handler that fails
 * *before* producing its own reply — a session/workspace store write that
 * throws, or an exception building the response card. It deliberately does NOT
 * promise to cover a hard transport outage: if the command's own reply send is
 * what failed, the fallback send to the same chat will usually fail too (then
 * we only log). And because it fires after any successful state change, the
 * message means "this click did not complete cleanly", not "nothing happened".
 */
export function makeDispatchCommand(deps: DispatchCommandDeps): DispatchCommand {
  const { router, bot, sessions, workspaces, makeReplies, log, appOwnerOpenId } = deps;
  return async (cmd, meta) => {
    const admin = isAdmin({
      access: bot.access,
      senderOpenId: meta.operatorOpenId,
      ...(appOwnerOpenId ? { appOwnerOpenId } : {}),
    });
    const { reply, replyCard } = makeReplies(meta.chatId);
    try {
      await router.dispatchParsed(cmd, {
        chatId: meta.chatId,
        senderOpenId: meta.operatorOpenId,
        isAdmin: admin,
        bot,
        sessions,
        workspaces,
        reply,
        replyCard,
      });
    } catch (err) {
      log.error(
        { err: (err as Error).message, cmd: cmd.name },
        'card-action dispatchCommand failed',
      );
      try {
        await reply(`⚠️ command failed: ${renderSlash(cmd)}`);
      } catch (replyErr) {
        log.error(
          { err: (replyErr as Error).message },
          'card-action fallback reply failed',
        );
      }
    }
  };
}
