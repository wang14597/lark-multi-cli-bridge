// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateAppId,
  validateBotName,
  parseBackendChoice,
  parseProvisionChoice,
  parseInstallSkillsAnswer,
  isOverlaySkillInstalled,
  resolveInstallSkillsScript,
} from '../../src/cli/commands/init.js';

describe('init wizard helpers', () => {
  it('validateAppId accepts cli_<alnum>', () => {
    expect(validateAppId('cli_abc123XYZ')).toBeUndefined();
  });
  it('validateAppId rejects garbage', () => {
    expect(validateAppId('not-an-app')).toBeDefined();
    expect(validateAppId('')).toBeDefined();
  });
  it('validateBotName accepts lowercase kebab', () => {
    expect(validateBotName('claude-bot')).toBeUndefined();
  });
  it('validateBotName rejects uppercase', () => {
    expect(validateBotName('ClaudeBot')).toBeDefined();
  });
  it('parseBackendChoice accepts number and name', () => {
    expect(parseBackendChoice('1')).toBe('claude');
    expect(parseBackendChoice('codex')).toBe('codex');
    expect(parseBackendChoice('GEMINI')).toBe('gemini');
    expect(parseBackendChoice('garbage')).toBeUndefined();
  });
  it('parseProvisionChoice accepts 1/scan for scan, 2/manual for manual', () => {
    expect(parseProvisionChoice('1')).toBe('scan');
    expect(parseProvisionChoice('scan')).toBe('scan');
    expect(parseProvisionChoice('2')).toBe('manual');
    expect(parseProvisionChoice('manual')).toBe('manual');
    expect(parseProvisionChoice('')).toBeUndefined();
    expect(parseProvisionChoice('garbage')).toBeUndefined();
  });
});

describe('skill install prompt helpers', () => {
  it('parseInstallSkillsAnswer defaults to yes on empty input', () => {
    expect(parseInstallSkillsAnswer('')).toBe(true);
    expect(parseInstallSkillsAnswer('   ')).toBe(true);
  });
  it('parseInstallSkillsAnswer accepts yes variants', () => {
    expect(parseInstallSkillsAnswer('y')).toBe(true);
    expect(parseInstallSkillsAnswer('Y')).toBe(true);
    expect(parseInstallSkillsAnswer('yes')).toBe(true);
    expect(parseInstallSkillsAnswer('YES')).toBe(true);
  });
  it('parseInstallSkillsAnswer rejects no variants', () => {
    expect(parseInstallSkillsAnswer('n')).toBe(false);
    expect(parseInstallSkillsAnswer('N')).toBe(false);
    expect(parseInstallSkillsAnswer('no')).toBe(false);
    expect(parseInstallSkillsAnswer('NO')).toBe(false);
  });
  it('parseInstallSkillsAnswer falls back to yes for unknown input', () => {
    // Per the default-yes contract: anything that isn't an explicit "no"
    // is treated as a confirmation, so a stray keypress doesn't skip the
    // recommended install.
    expect(parseInstallSkillsAnswer('maybe')).toBe(true);
  });

  it('isOverlaySkillInstalled detects skill dir under fake home', () => {
    const home = mkdtempSync(join(tmpdir(), 'lmcb-home-'));
    try {
      expect(isOverlaySkillInstalled(home)).toBe(false);
      mkdirSync(join(home, '.claude', 'skills', 'lark-bridge-overlay'), { recursive: true });
      expect(isOverlaySkillInstalled(home)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('isOverlaySkillInstalled checks universal ~/.agents/skills dir too', () => {
    const home = mkdtempSync(join(tmpdir(), 'lmcb-home-'));
    try {
      mkdirSync(join(home, '.agents', 'skills', 'lark-bridge-overlay'), { recursive: true });
      expect(isOverlaySkillInstalled(home)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('resolveInstallSkillsScript finds scripts/install-skills.sh from src in dev mode', () => {
    // When tests run under tsx from src/, the resolver should walk up to
    // the repo root and find the real script. This guards against module
    // moves breaking the dev-mode `lmcb init` flow.
    const found = resolveInstallSkillsScript();
    expect(found).toBeDefined();
    expect(found!.endsWith('scripts/install-skills.sh')).toBe(true);
  });
});
