// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env['LMCB_HOME'] ?? join(homedir(), '.lark-multi-cli-bridge');

export const paths = {
  root,
  configYaml: join(root, 'config.yaml'),
  bots: join(root, 'bots'),
  state: join(root, 'state'),
  // Legacy single shared sessions file (pre per-bot split). Kept only as a
  // one-time migration source; workers no longer write it.
  sessionsJson: join(root, 'state', 'sessions.json'),
  // Per-bot session files live under state/sessions/<bot>.json so each worker
  // owns its own file — no cross-process last-writer-wins clobber.
  sessionsDir: join(root, 'state', 'sessions'),
  workspacesJson: join(root, 'state', 'workspaces.json'),
  processesJson: join(root, 'state', 'processes.json'),
  logs: join(root, 'logs'),
  supervisorLog: join(root, 'logs', 'supervisor.log'),
  workerLogsDir: join(root, 'logs', 'workers'),
  media: join(root, 'media'),
  ipcSock: join(root, 'ipc.sock'),
  workerLog(bot: string, dateYmd: string): string {
    return join(root, 'logs', 'workers', bot, `${dateYmd}.log`);
  },
  botYaml(bot: string): string {
    return join(root, 'bots', `${bot}.yaml`);
  },
  mediaChat(chatId: string): string {
    return join(root, 'media', chatId);
  },
  shimsRoot: join(root, 'shims'),
  shimsDir(botName: string): string {
    if (!botName || botName.includes('/') || botName.includes('\\') || botName.includes('..')) {
      throw new Error(`invalid bot name: ${botName}`);
    }
    return join(root, 'shims', botName);
  },
  sessionBotJson(botName: string): string {
    if (!botName || botName.includes('/') || botName.includes('\\') || botName.includes('..')) {
      throw new Error(`invalid bot name: ${botName}`);
    }
    return join(root, 'state', 'sessions', `${botName}.json`);
  },
} as const;
