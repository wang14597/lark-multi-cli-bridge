// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import * as Lark from '@larksuiteoapi/node-sdk';
import { baseSdkOptions } from '../../src/lark/sdk-options.js';
import type { SdkLogger } from '../../src/lark/sdk-logger.js';

const noopLogger: SdkLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

describe('baseSdkOptions', () => {
  it('maps domain "feishu" to Lark.Domain.Feishu', () => {
    expect(baseSdkOptions({ domain: 'feishu' }).domain).toBe(Lark.Domain.Feishu);
  });

  it('maps domain "lark" (and the default) to Lark.Domain.Lark', () => {
    expect(baseSdkOptions({ domain: 'lark' }).domain).toBe(Lark.Domain.Lark);
    expect(baseSdkOptions({}).domain).toBe(Lark.Domain.Lark);
  });

  it('always sets loggerLevel to warn', () => {
    expect(baseSdkOptions({}).loggerLevel).toBe(Lark.LoggerLevel.warn);
  });

  it('includes logger only when one is provided', () => {
    expect('logger' in baseSdkOptions({})).toBe(false);
    const withLogger = baseSdkOptions({ logger: noopLogger });
    expect(withLogger.logger).toBe(noopLogger);
  });
});
