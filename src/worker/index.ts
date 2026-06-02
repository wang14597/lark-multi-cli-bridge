// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { paths } from '../config/paths.js';
import { loadAllBots } from '../config/load.js';
import {
  ensureLarkProfile,
  provisionLarkShim,
  resolveRealLarkCli,
  makeRunLarkCli,
  which,
} from '../lark/lark-cli-provision.js';
import { SessionStore } from '../session/store.js';
import { createLogger } from '../telemetry/logger.js';
import { buildAdapter } from '../adapters/registry.js';
import { createLarkClient, fetchAppOwnerOpenId, fetchBotSelfOpenId } from '../lark/client.js';
import { LarkWsClient } from '../lark/ws.js';
import { adaptLarkLogger } from '../lark/sdk-logger.js';
import { CardStreamer } from './card-streamer.js';
import { LarkCardSink } from './lark-sink.js';
import { Dispatcher } from './dispatcher.js';
import { buildBridgeContext } from './bridge-context.js';
import { downloadAttachment } from '../lark/attachment.js';
import { fetchQuotedContext, asMessageGetClient } from '../lark/fetch-quote.js';
import type { IngressMessage } from '../lark/types.js';
import { WorkspaceStore } from '../session/workspace.js';
import { CommandRouter } from '../commands/router.js';
import { makeHelpHandler } from '../commands/handlers/help.js';
import { statusHandler } from '../commands/handlers/status.js';
import { newHandler } from '../commands/handlers/new.js';
import { cdHandler } from '../commands/handlers/cd.js';
import { timeoutHandler } from '../commands/handlers/timeout.js';
import { makeStopHandler } from '../commands/handlers/stop.js';
import { wsHandler } from '../commands/handlers/ws.js';
import { abortRegistryFromDispatcher } from './abort-registry.js';
import { isAuthorized, isAdmin } from '../auth/access-control.js';
import { accessHandler } from '../commands/handlers/access.js';
import { sessionsHandler } from '../commands/handlers/sessions.js';
import { makeReconnectHandler } from '../commands/handlers/reconnect.js';
import { makeDoctorHandler } from '../commands/handlers/doctor.js';
import { makeCardActionHandler } from './card-action-handler.js';

function resolveCwd(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export async function runWorker(botName: string): Promise<void> {
  const bots = await loadAllBots(paths.bots);
  const bot = bots.find((b) => b.name === botName);
  if (!bot) throw new Error(`bot not found: ${botName}`);
  if (!bot.enabled) throw new Error(`bot disabled: ${botName}`);
  if (!bot.lark.app_secret) {
    throw new Error(`bot ${botName}: app_secret required in M1 (secret refs not yet supported)`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const log = createLogger({
    file: paths.workerLog(botName, today),
    base: { bot: botName },
  });
  log.info('worker starting');

  const adapter = buildAdapter(bot);
  const preflight = await adapter.preflight();
  if (!preflight.ok) {
    log.error({ err: preflight.error }, 'adapter preflight failed');
    process.exit(2);
  }
  log.info({ version: preflight.version }, 'adapter ready');

  // Every lark-cli call from inside the LLM subprocess must hit THIS bot's
  // app identity. lark-cli 1.0.43 cannot accept credentials purely via env
  // (LARKSUITE_CLI_APP_ID/SECRET enter "external credentials" mode but never
  // mint a usable bot token); the only working path is a registered profile
  // + the --profile flag. We provision a profile per bot and expose it via a
  // PATH shim that hard-pins --profile on every invocation.
  const shimDir = paths.shimsDir(bot.name);
  const realLarkCliPath = resolveRealLarkCli(
    process.env.LMCB_LARK_CLI_PATH ?? (await which('lark-cli')),
    paths.shimsRoot,
  );
  const runLarkCli = makeRunLarkCli(realLarkCliPath);
  // Narrow the loaded Bot's optional app_secret to the required-string shape
  // expected by ensureLarkProfile/provisionLarkShim. The `if (!bot.lark.app_secret)`
  // guard above already proves this is a string at runtime.
  const provisioningBot = {
    name: bot.name,
    lark: {
      app_id: bot.lark.app_id,
      app_secret: bot.lark.app_secret,
      tenant: bot.lark.tenant,
    },
  };
  await ensureLarkProfile(provisioningBot, {
    runLarkCli,
    writeFile: (p, c, m) => writeFile(p, c, { mode: m }),
    mkdirp: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  });
  await provisionLarkShim(provisioningBot, shimDir, realLarkCliPath, {
    writeFile: (p, c, m) => writeFile(p, c, { mode: m }),
    mkdirp: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  });
  log.info({ shimDir, realLarkCliPath }, 'lark-cli profile + shim provisioned');

  const larkCliEnv: Record<string, string> = {
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  };

  // Route Lark SDK's own logger through pino so SDK-level errors (auth
  // refresh failures, API 4xx/5xx with field_violations, WS reconnect)
  // land in the worker log file with full structure instead of getting
  // truncated to `[Object]` / `[Array]` by Node's default console.log.
  const sdkLogger = adaptLarkLogger(log);

  const client = createLarkClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
    logger: sdkLogger,
  });

  const appOwnerOpenId =
    (await fetchAppOwnerOpenId(client, bot.lark.app_id)) ??
    process.env.LMCB_APP_OWNER_OPEN_ID ??
    '';

  const botSelfOpenId =
    (await fetchBotSelfOpenId(client, bot.lark.app_id)) ??
    process.env.LMCB_BOT_OPEN_ID ??
    undefined;
  if (botSelfOpenId) log.info({ botSelfOpenId }, 'bot self open_id resolved');
  else log.warn('bot self open_id NOT resolved; group @-mention will not strip prefix');

  const sessions = new SessionStore(paths.sessionsJson);
  await sessions.load();

  const workspaces = new WorkspaceStore(paths.workspacesJson);
  await workspaces.load();

  const ws = new LarkWsClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
    ...(botSelfOpenId ? { botSelfOpenId } : {}),
    logger: sdkLogger,
  });

  const reconnector = { reconnect: async (): Promise<void> => { await ws.stop(); await ws.start(); } };

  const lastIngressByChat = new Map<string, IngressMessage>();

  const dispatcher = new Dispatcher({
    adapter,
    makeStreamer: (chatId, replyTo) =>
      new CardStreamer({
        sink: new LarkCardSink(client, chatId, replyTo),
        throttleMs: 500,
        throttleChars: 50,
      }),
    onSessionUpdate: (chatId, sessionId) => {
      const existing = sessions.get(chatId, bot.name);
      const cwd = existing?.cwd ?? resolveCwd(bot.behavior.default_cwd);
      void sessions.upsert(chatId, {
        backend: bot.backend.type,
        bot: bot.name,
        cwd,
        sessionId,
      });
    },
    prefixPrompt: (chatId, prompt) => {
      const last = lastIngressByChat.get(chatId);
      if (!last) return prompt;
      return `${buildBridgeContext(last)}\n\n${prompt}`;
    },
    extraEnv: larkCliEnv,
  });

  const baseHandlers = [
    statusHandler,
    newHandler,
    cdHandler,
    timeoutHandler,
    wsHandler,
    makeStopHandler(abortRegistryFromDispatcher(dispatcher)),
    accessHandler,
    sessionsHandler,
    makeReconnectHandler(reconnector),
    makeDoctorHandler(adapter),
  ];
  let router: CommandRouter;
  router = new CommandRouter([
    makeHelpHandler(() => router.list(true)),
    ...baseHandlers,
  ]);

  ws.on('card-action', makeCardActionHandler({
    access: bot.access,
    dispatcher,
    log,
    lastIngressByChat,
    sessions,
    botDefaultCwd: resolveCwd(bot.behavior.default_cwd),
    botBackendType: bot.backend.type,
    botName: bot.name,
    idleTimeoutMs: bot.behavior.idle_timeout_seconds * 1000,
    ...(appOwnerOpenId ? { appOwnerOpenId } : {}),
  }));

  ws.on('message', async (msg: IngressMessage) => {
    log.info({ chatId: msg.chatId, chatType: msg.chatType, sender: msg.senderOpenId }, 'message received');

    if (!msg.text.trim()) return;

    if (!isAuthorized({ access: bot.access, senderOpenId: msg.senderOpenId, chatId: msg.chatId, ...(appOwnerOpenId ? { appOwnerOpenId } : {}) })) {
      log.info({ chatId: msg.chatId, sender: msg.senderOpenId }, 'dropped: unauthorized');
      return;
    }
    const admin = isAdmin({ access: bot.access, senderOpenId: msg.senderOpenId, ...(appOwnerOpenId ? { appOwnerOpenId } : {}) });
    const replyText = async (text: string): Promise<void> => {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: msg.chatId, msg_type: 'text', content: JSON.stringify({ text }) },
      });
    };
    const replyCard = async (card: unknown): Promise<void> => {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: msg.chatId, msg_type: 'interactive', content: JSON.stringify(card) },
      });
    };
    const handled = await router.dispatch(msg.text, {
      chatId: msg.chatId,
      senderOpenId: msg.senderOpenId,
      isAdmin: admin,
      bot,
      sessions,
      workspaces,
      reply: replyText,
      replyCard,
    });
    if (handled) return;

    // Reply-quote: resolve the quoted parent (if any) before stashing the
    // ingress for prompt assembly. Best-effort — if the SDK call fails the
    // user's message still flows through, just without the <quoted_message>
    // block. The asMessageGetClient cast narrows the full SDK Client down to
    // the slice fetch-quote actually depends on.
    if (msg.parentMessageId) {
      const quoted = await fetchQuotedContext(
        asMessageGetClient(client),
        msg.parentMessageId,
        { openId: botSelfOpenId ?? '', name: bot.name },
      );
      if (quoted) {
        msg.quoted = quoted;
        log.info(
          { chatId: msg.chatId, parentId: msg.parentMessageId, type: quoted.type },
          'quoted parent resolved',
        );
      } else {
        log.warn(
          { chatId: msg.chatId, parentId: msg.parentMessageId },
          'quoted parent fetch returned no content',
        );
      }
    }

    lastIngressByChat.set(msg.chatId, msg);

    const downloaded: string[] = [];
    for (const att of msg.attachments) {
      try {
        const a = await downloadAttachment({ client, chatId: msg.chatId }, msg.messageId, att);
        downloaded.push(`[Attached ${a.kind}: ${a.localPath}]`);
      } catch (err) {
        log.warn({ err: (err as Error).message, fileKey: att.fileKey }, 'attachment download failed');
      }
    }
    const promptText = downloaded.length ? `${msg.text}\n\n${downloaded.join('\n')}` : msg.text;

    // Session and cwd are both scoped per (chatId, botName). Two bots
    // active in the same chat keep independent continuation IDs and
    // independent cwds — no cross-bot inheritance of either field.
    const sessionEntry = sessions.get(msg.chatId, bot.name);
    const cwd = sessionEntry?.cwd ?? resolveCwd(bot.behavior.default_cwd);

    log.info({ chatId: msg.chatId, sender: msg.senderOpenId }, 'dispatching message');
    try {
      await dispatcher.enqueue({
        chatId: msg.chatId,
        prompt: promptText,
        cwd,
        ...(sessionEntry?.sessionId !== undefined ? { sessionId: sessionEntry.sessionId } : {}),
        idleTimeoutMs: bot.behavior.idle_timeout_seconds * 1000,
        // Quote-reply the user's actual message. Card-action handler
        // (synthesized [card-click] events) intentionally does NOT set
        // this — those have no real user message to anchor the reply to.
        replyToMessageId: msg.messageId,
      });
    } catch (err) {
      log.error({ err: (err as Error).message }, 'dispatch failed');
    }
  });

  await ws.start();
  if (typeof process.send === 'function') {
    process.send({ kind: 'ready', workerId: botName });
  }
  log.info('worker started; awaiting messages');

  const onShutdown = async (sig: NodeJS.Signals): Promise<void> => {
    log.info({ sig }, 'worker shutting down');
    await ws.stop();
    process.exit(0);
  };
  process.on('SIGTERM', (sig) => void onShutdown(sig));
  process.on('SIGINT', (sig) => void onShutdown(sig));
}

// When this file is run directly (e.g., spawned by tsx, or fork'd later in M3),
// pick up the bot name from LMCB_WORKER_BOT and start.
const botFromEnv = process.env.LMCB_WORKER_BOT;
if (botFromEnv) {
  runWorker(botFromEnv).catch((err) => {
    console.error('worker failed:', err);
    process.exit(1);
  });
}
