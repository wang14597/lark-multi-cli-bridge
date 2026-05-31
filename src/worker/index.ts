// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { paths } from '../config/paths.js';
import { loadAllBots } from '../config/load.js';
import { SessionStore } from '../session/store.js';
import { createLogger } from '../telemetry/logger.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { createLarkClient } from '../lark/client.js';
import { LarkWsClient } from '../lark/ws.js';
import { CardStreamer } from './card-streamer.js';
import { LarkCardSink } from './lark-sink.js';
import { Dispatcher } from './dispatcher.js';
import type { BotConfig } from '../config/schema.js';
import type { Adapter } from '../adapters/types.js';
import type { IngressMessage } from '../lark/types.js';

function buildAdapter(bot: BotConfig): Adapter {
  if (bot.backend.type === 'claude') {
    const cfg = bot.backend.claude;
    return new ClaudeAdapter({
      permissionMode: cfg.permission_mode,
      ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      extraArgs: cfg.extra_args,
    });
  }
  throw new Error(`backend not implemented in M1: ${bot.backend.type}`);
}

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

  const client = createLarkClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
  });

  const sessions = new SessionStore(paths.sessionsJson);
  await sessions.load();

  const ws = new LarkWsClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
  });

  const dispatcher = new Dispatcher({
    adapter,
    makeStreamer: (chatId) =>
      new CardStreamer({
        header: `${botName} @ ${chatId.slice(0, 12)}`,
        sink: new LarkCardSink(client, chatId),
        throttleMs: 500,
        throttleChars: 50,
      }),
    onSessionUpdate: (chatId, sessionId) => {
      const existing = sessions.get(chatId);
      const cwd = existing?.cwd ?? resolveCwd(bot.behavior.default_cwd);
      void sessions.upsert(chatId, {
        backend: bot.backend.type,
        bot: bot.name,
        cwd,
        sessionId,
      });
    },
  });

  ws.on('message', async (msg: IngressMessage) => {
    if (!msg.text.trim()) return;

    const existing = sessions.get(msg.chatId);
    const cwd = existing?.cwd ?? resolveCwd(bot.behavior.default_cwd);

    log.info({ chatId: msg.chatId, sender: msg.senderOpenId }, 'dispatching message');
    try {
      await dispatcher.dispatch({
        chatId: msg.chatId,
        prompt: msg.text,
        cwd,
        ...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
        idleTimeoutMs: bot.behavior.idle_timeout_seconds * 1000,
      });
    } catch (err) {
      log.error({ err: (err as Error).message }, 'dispatch failed');
    }
  });

  await ws.start();
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
