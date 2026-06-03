// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';
import type { SdkLogger } from './sdk-logger.js';

export interface BaseSdkOpts {
  domain?: 'lark' | 'feishu';
  // Optional custom logger. Without it, the SDK falls back to console.log
  // which truncates nested error payloads via util.inspect's default depth.
  // Pass adaptLarkLogger(workerPino) at the call site for full structured
  // errors in the worker log file.
  logger?: SdkLogger;
}

/**
 * SDK construction options shared by `Lark.Client` and `Lark.WSClient`:
 * domain mapping, the warn logger level, and the conditional logger spread.
 * Both constructors took identical copies of these three lines — keep them
 * in one place so a change (e.g. a new shared knob, a logger-level bump)
 * lands on both transports at once. Caller adds its own appId/appSecret and
 * any transport-specific options (e.g. WSClient's wsConfig/pingTimeout).
 */
export function baseSdkOptions(opts: BaseSdkOpts): {
  domain: typeof Lark.Domain.Feishu | typeof Lark.Domain.Lark;
  loggerLevel: typeof Lark.LoggerLevel.warn;
  logger?: SdkLogger;
} {
  return {
    domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
    loggerLevel: Lark.LoggerLevel.warn,
    ...(opts.logger ? { logger: opts.logger } : {}),
  };
}
