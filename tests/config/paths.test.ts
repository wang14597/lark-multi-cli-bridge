// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { paths } from '../../src/config/paths.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('paths', () => {
  it('exposes the config root under home', () => {
    expect(paths.root).toMatch(/\.lark-multi-cli-bridge$/);
  });

  it('derives all subpaths from root', () => {
    expect(paths.bots).toBe(`${paths.root}/bots`);
    expect(paths.configYaml).toBe(`${paths.root}/config.yaml`);
    expect(paths.state).toBe(`${paths.root}/state`);
    expect(paths.sessionsJson).toBe(`${paths.root}/state/sessions.json`);
    expect(paths.workspacesJson).toBe(`${paths.root}/state/workspaces.json`);
    expect(paths.processesJson).toBe(`${paths.root}/state/processes.json`);
    expect(paths.logs).toBe(`${paths.root}/logs`);
    expect(paths.supervisorLog).toBe(`${paths.root}/logs/supervisor.log`);
    expect(paths.media).toBe(`${paths.root}/media`);
    expect(paths.ipcSock).toBe(`${paths.root}/ipc.sock`);
  });
});

describe('paths.shimsDir', () => {
  it('returns ~/.lark-multi-cli-bridge/shims/<bot>', () => {
    expect(paths.shimsDir('codex-bot')).toBe(
      join(homedir(), '.lark-multi-cli-bridge', 'shims', 'codex-bot'),
    );
  });

  it('rejects bot names containing path separators', () => {
    expect(() => paths.shimsDir('../etc')).toThrow();
    expect(() => paths.shimsDir('a/b')).toThrow();
  });
});
