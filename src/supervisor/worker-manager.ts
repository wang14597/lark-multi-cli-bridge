// SPDX-License-Identifier: MIT
import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { BotConfig } from '../config/schema.js';
import type { WorkerState, WorkerStatus } from './ipc-protocol.js';

export interface CrashBudget {
  maxCrashes: number;
  windowMs: number;
}

export interface WorkerManagerOpts {
  workerScript: string;
  bots: BotConfig[];
  crashBudget: CrashBudget;
  delays: number[];
}

// Internal slot uses non-optional union types so `= undefined` assignments satisfy
// exactOptionalPropertyTypes without needing `delete` on every exit.
interface WorkerSlot {
  bot: BotConfig;
  child: ChildProcess | undefined;
  state: WorkerState;
  startedAt: string | undefined;
  restartCount: number;
  crashTimestamps: number[];
  attempt: number;
  lastError: string | undefined;
}

export class WorkerManager extends EventEmitter {
  private slots = new Map<string, WorkerSlot>();
  private stopping = false;

  constructor(private opts: WorkerManagerOpts) {
    super();
    for (const bot of opts.bots) {
      this.slots.set(bot.name, {
        bot,
        child: undefined,
        state: 'starting',
        startedAt: undefined,
        restartCount: 0,
        crashTimestamps: [],
        attempt: 0,
        lastError: undefined,
      });
    }
  }

  async start(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (slot.bot.enabled) this.spawn(slot);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const slot of this.slots.values()) {
      if (slot.child) {
        slot.state = 'stopped';
        slot.child.kill('SIGTERM');
      }
    }
  }

  statusOf(bot: string): WorkerStatus {
    const slot = this.slots.get(bot);
    if (!slot) throw new Error(`unknown bot: ${bot}`);
    return {
      bot,
      ...(slot.child?.pid !== undefined ? { pid: slot.child.pid } : {}),
      state: slot.state,
      ...(slot.startedAt !== undefined ? { startedAt: slot.startedAt } : {}),
      ...(slot.lastError !== undefined ? { lastError: slot.lastError } : {}),
      restartCount: slot.restartCount,
    };
  }

  list(): WorkerStatus[] {
    return Array.from(this.slots.keys()).map((name) => this.statusOf(name));
  }

  async restart(bot: string): Promise<void> {
    const slot = this.slots.get(bot);
    if (!slot) throw new Error(`unknown bot: ${bot}`);
    if (slot.child) {
      slot.state = 'restarting';
      slot.child.kill('SIGTERM');
    }
    slot.crashTimestamps = [];
    slot.attempt = 0;
    slot.state = 'starting';
    this.spawn(slot);
  }

  private spawn(slot: WorkerSlot): void {
    if (this.stopping) return;
    slot.state = 'starting';
    slot.startedAt = new Date().toISOString();
    const child = fork(this.opts.workerScript, [], {
      env: { ...process.env, LMCB_WORKER_BOT: slot.bot.name },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    slot.child = child;

    child.on('message', (msg: unknown) => {
      if (typeof msg === 'object' && msg && (msg as { kind?: string }).kind === 'ready') {
        slot.state = 'ready';
        this.emit('ready', slot.bot.name);
      }
    });

    child.once('exit', (code) => {
      slot.child = undefined;
      if (this.stopping || slot.state === 'stopped') return;
      const wasReady = slot.state === 'ready';
      slot.lastError = `exit code ${code ?? 'unknown'}`;
      if (code === 0 && wasReady) {
        slot.state = 'stopped';
        return;
      }
      slot.state = 'crashed';
      const now = Date.now();
      slot.crashTimestamps.push(now);
      slot.crashTimestamps = slot.crashTimestamps.filter(
        (t) => now - t < this.opts.crashBudget.windowMs,
      );
      if (slot.crashTimestamps.length >= this.opts.crashBudget.maxCrashes) {
        slot.state = 'disabled';
        this.emit('disabled', slot.bot.name);
        return;
      }
      const delay = this.opts.delays[Math.min(slot.attempt, this.opts.delays.length - 1)] ?? 30_000;
      slot.attempt++;
      slot.restartCount++;
      slot.state = 'restarting';
      setTimeout(() => this.spawn(slot), delay).unref();
    });
  }
}
