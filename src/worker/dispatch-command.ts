// SPDX-License-Identifier: MIT
import type { Logger } from 'pino';
import type { BotConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../session/workspace.js';
import type { CommandRouter, ParsedCommand } from '../commands/router.js';
import { isAdmin } from '../auth/access-control.js';

export interface DispatchCommandDeps {
  router: Pick<CommandRouter, 'dispatchParsed'>;
  bot: BotConfig;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  /** Build the per-chat reply/replyCard closures (worker/index.ts wires Lark). */
  makeReplies: (chatId: string) => {
    reply: (text: string) => Promise<void>;
    replyCard: (card: unknown) => Promise<void>;
  };
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
 * Unlike a bare router call, a failure here is never swallowed silently: a card
 * click that throws (router handler error, or a Lark SDK reply failure) sends a
 * best-effort `⚠️ command failed: …` fallback so the user sees a failure rather
 * than a dead button. Only if the fallback reply itself throws do we fall back
 * to logging.
 */
export function makeDispatchCommand(
  deps: DispatchCommandDeps,
): (cmd: ParsedCommand, meta: { chatId: string; operatorOpenId: string }) => Promise<void> {
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
