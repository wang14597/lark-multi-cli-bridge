// SPDX-License-Identifier: MIT
import { inspect } from 'node:util';
import type { Logger as PinoLogger } from 'pino';

/**
 * Lark SDK Logger contract from @larksuiteoapi/node-sdk:
 *   { error|warn|info|debug|trace: (...msg: any[]) => void | Promise<void> }
 *
 * The SDK's built-in implementation forwards to `console.log/error`, which
 * uses Node's default `util.inspect` (depth 2). Nested API error payloads
 * like `{ field_violations: [...], error: {...} }` end up rendered as
 * `[Array]` / `[Object]`, so ops can't see which field failed validation.
 *
 * This adapter routes every SDK log line through our pino logger so it
 * lands in the worker log file with full structure preserved, and at the
 * same depth as the rest of the worker's logs.
 */
export interface SdkLogger {
  error: (...msg: unknown[]) => void;
  warn: (...msg: unknown[]) => void;
  info: (...msg: unknown[]) => void;
  debug: (...msg: unknown[]) => void;
  trace: (...msg: unknown[]) => void;
}

const INSPECT_OPTS = { depth: 10, breakLength: 120, maxArrayLength: 100 } as const;

function fmt(msg: unknown[]): string {
  return msg
    .map((m) => (typeof m === 'string' ? m : inspect(m, INSPECT_OPTS)))
    .join(' ');
}

export function adaptLarkLogger(log: PinoLogger): SdkLogger {
  const base = { src: 'lark-sdk' };
  return {
    error: (...msg) => log.error(base, fmt(msg)),
    warn: (...msg) => log.warn(base, fmt(msg)),
    info: (...msg) => log.info(base, fmt(msg)),
    debug: (...msg) => log.debug(base, fmt(msg)),
    trace: (...msg) => log.trace(base, fmt(msg)),
  };
}
