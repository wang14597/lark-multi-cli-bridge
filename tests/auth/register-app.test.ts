// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { scanRegisterApp } from '../../src/auth/register-app.js';

describe('scanRegisterApp', () => {
  it('exports an async function', () => {
    expect(typeof scanRegisterApp).toBe('function');
  });
});
