// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { paths } from '../config/paths.js';
import { writeJsonAtomic } from '../util/atomic-file.js';
import { createLogger } from '../telemetry/logger.js';
import { loadAllBots, loadGlobalConfig } from '../config/load.js';
import { IpcServer } from './ipc-server.js';
import { WorkerManager } from './worker-manager.js';
import { backoffDelays } from '../util/retry.js';
import { Methods } from './ipc-protocol.js';
import { BotsDirWatcher } from '../config/reload.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = resolve(HERE, '../worker/index.js');

export async function runSupervisor(): Promise<void> {
  const log = createLogger({ file: paths.supervisorLog, base: { proc: 'supervisor' } });
  log.info('supervisor starting');

  await loadGlobalConfig(paths.configYaml);
  const bots = await loadAllBots(paths.bots);
  log.info({ bots: bots.map((b) => b.name) }, 'loaded bots');

  const mgr = new WorkerManager({
    workerScript: WORKER_SCRIPT,
    bots,
    crashBudget: { maxCrashes: 5, windowMs: 3 * 60_000 },
    delays: backoffDelays(),
  });

  // Constructed up-front (side-effect-free until .start()) so teardown can
  // reference it as a const; armed after mgr.start() below.
  const watcher = new BotsDirWatcher(paths.bots);

  const teardown = async (): Promise<void> => {
    log.info('supervisor tearing down');
    watcher.stop();
    await mgr.stop();
    await ipc.stop();
    await writeJsonAtomic(paths.processesJson, { entries: [] }).catch(() => {});
    process.exit(0);
  };

  const ipc = new IpcServer(paths.ipcSock, {
    [Methods.ping]: async () => ({ pong: true }),
    [Methods.listWorkers]: async () => ({
      workers: mgr.list(),
      supervisorPid: process.pid,
      supervisorStartedAt: new Date().toISOString(),
    }),
    [Methods.restartWorker]: async (params) => {
      const bot = (params as { bot?: string } | undefined)?.bot;
      if (!bot) throw new Error('bot required');
      await mgr.restart(bot);
      return { restarted: bot };
    },
    [Methods.reloadWorker]: async (params) => {
      const bot = (params as { bot?: string } | undefined)?.bot;
      if (!bot) throw new Error('bot required');
      await mgr.restart(bot);
      return { reloaded: bot };
    },
    [Methods.shutdown]: async () => {
      log.info('shutdown requested via ipc');
      // run teardown without blocking response
      void teardown();
      return { ok: true };
    },
  });

  await ipc.start();
  await mgr.start();

  let reloadTimer: NodeJS.Timeout | undefined;
  watcher.on('change', (filename: string) => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      const newBots = await loadAllBots(paths.bots);
      const target = newBots.find((b) => `${b.name}.yaml` === filename || `${b.name}.yml` === filename);
      if (target) {
        log.info({ bot: target.name }, 'config changed; restarting worker');
        await mgr.restart(target.name).catch((err) => log.warn({ err }, 'restart on reload failed'));
      }
    }, 500);
  });
  watcher.start();

  await writeJsonAtomic(paths.processesJson, {
    entries: [{ pid: process.pid, startedAt: new Date().toISOString() }],
  });

  process.on('SIGTERM', () => void teardown());
  process.on('SIGINT', () => void teardown());

  log.info('supervisor ready');
}

if (process.argv[1]?.endsWith('supervisor/index.js')) {
  runSupervisor().catch((err) => {
    console.error('supervisor failed:', err);
    process.exit(1);
  });
}
