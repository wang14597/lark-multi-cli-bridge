// SPDX-License-Identifier: MIT
import pino, { type Logger } from 'pino';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LoggerOpts {
  file?: string;
  level?: string;
  base?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOpts): Logger {
  if (opts.file) {
    mkdirSync(dirname(opts.file), { recursive: true, mode: 0o700 });
    const transport = pino.transport({
      target: 'pino-roll',
      options: { file: opts.file, frequency: 'daily', mkdir: true, dateFormat: 'yyyy-MM-dd' },
    });
    return pino({ level: opts.level ?? 'info', base: opts.base ?? {} }, transport);
  }
  return pino(
    { level: opts.level ?? 'info', base: opts.base ?? {} },
    pino.destination({ dest: 1, sync: false }),
  );
}
