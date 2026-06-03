// SPDX-License-Identifier: MIT
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveSupervisorEntry } from '../../src/cli/commands/start.js';

describe('resolveSupervisorEntry', () => {
  it('resolves to the sibling supervisor bundle in the built layout', () => {
    // tsup flattens src/cli/commands/start.ts into dist/cli/index.js, so the
    // supervisor entry must resolve ONE level up — not two (the old bug).
    expect(resolveSupervisorEntry('/app/dist/cli')).toBe(resolve('/app/dist/supervisor/index.js'));
  });

  describe('against a simulated dist layout on disk', () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('points at a file that exists', () => {
      dir = mkdtempSync(join(tmpdir(), 'lmcb-dist-'));
      mkdirSync(join(dir, 'cli'), { recursive: true });
      mkdirSync(join(dir, 'supervisor'), { recursive: true });
      writeFileSync(join(dir, 'supervisor', 'index.js'), '// stub\n');

      const entry = resolveSupervisorEntry(join(dir, 'cli'));
      expect(entry).toBe(join(dir, 'supervisor', 'index.js'));
      expect(existsSync(entry)).toBe(true);
    });
  });
});
