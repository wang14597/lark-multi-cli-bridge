// SPDX-License-Identifier: MIT
import { join, delimiter, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';

export interface ProvisionedProfile {
  name: string;
  realLarkCliPath: string;
}

export interface ProvisionDeps {
  runLarkCli: (
    args: string[],
    opts?: { stdin?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFile: (path: string, content: string, mode: number) => Promise<void>;
  mkdirp: (path: string) => Promise<void>;
}

export interface Bot {
  name: string;
  lark: { app_id: string; app_secret: string; tenant: 'lark' | 'feishu' };
}

interface LarkCliProfile {
  name: string;
  appId: string;
  brand: string;
  active: boolean;
}

export async function ensureLarkProfile(bot: Bot, deps: ProvisionDeps): Promise<void> {
  const listed = await deps.runLarkCli(['profile', 'list', '--format', 'json']);
  if (listed.exitCode !== 0) {
    throw new Error(`lark-cli profile list failed (exit ${listed.exitCode}): ${listed.stderr}`);
  }
  let profiles: LarkCliProfile[];
  try {
    profiles = JSON.parse(listed.stdout) as LarkCliProfile[];
  } catch (err) {
    throw new Error(`lark-cli profile list returned non-JSON stdout: ${(err as Error).message}`);
  }
  const match = profiles.find((p) => p.appId === bot.lark.app_id);
  if (match) return;

  const added = await deps.runLarkCli(
    [
      'profile',
      'add',
      '--name',
      bot.lark.app_id,
      '--app-id',
      bot.lark.app_id,
      '--brand',
      bot.lark.tenant,
      '--app-secret-stdin',
    ],
    { stdin: bot.lark.app_secret },
  );
  if (added.exitCode !== 0) {
    throw new Error(`lark-cli profile add failed (exit ${added.exitCode}): ${added.stderr}`);
  }
}

export async function provisionLarkShim(
  bot: Bot,
  shimDir: string,
  realLarkCliPath: string,
  deps: Pick<ProvisionDeps, 'writeFile' | 'mkdirp'>,
): Promise<string> {
  if (realLarkCliPath.includes("'") || realLarkCliPath.includes('\n')) {
    throw new Error(
      `unsafe lark-cli path (contains single-quote or newline): ${realLarkCliPath}`,
    );
  }
  // app_id is constrained to [a-z0-9_] by Lark's open platform, but be paranoid.
  if (!/^[A-Za-z0-9_-]+$/.test(bot.lark.app_id)) {
    throw new Error(`unsafe app_id: ${bot.lark.app_id}`);
  }
  await deps.mkdirp(shimDir);
  const shimPath = join(shimDir, 'lark-cli');
  const content =
    `#!/usr/bin/env bash\n` +
    `# lmcb-managed shim for bot ${bot.name} — DO NOT EDIT.\n` +
    `# Hard-pins --profile so the LLM never falls through to the default profile.\n` +
    `exec '${realLarkCliPath}' --profile '${bot.lark.app_id}' "$@"\n`;
  await deps.writeFile(shimPath, content, 0o755);
  return shimPath;
}

export function resolveRealLarkCli(candidatePath: string, shimsRoot: string): string {
  const normalizedCandidate = resolve(candidatePath);
  const normalizedRoot = resolve(shimsRoot);
  if (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + '/')
  ) {
    throw new Error(`refusing to use shim as real lark-cli: ${candidatePath}`);
  }
  return candidatePath;
}

/**
 * Build a runLarkCli that always invokes the real binary (NOT a shim).
 *
 * Threat model: shim safety is enforced by the absolute `realLarkCliPath`
 * argument — callers MUST resolve their input via `resolveRealLarkCli` before
 * passing it in. PATH is intentionally inherited from `process.env` so the
 * real lark-cli's own subprocess discovery still works; this function does
 * NOT scrub PATH, so do not rely on PATH manipulation for shim protection.
 */
export function makeRunLarkCli(
  realLarkCliPath: string,
): ProvisionDeps['runLarkCli'] {
  return (args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(realLarkCliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
      if (opts?.stdin !== undefined) {
        child.stdin.end(opts.stdin);
      } else {
        child.stdin.end();
      }
    });
}

/**
 * Minimal `which` shim — walks PATH looking for an executable named `name`.
 * Returns the first match. Throws if not found.
 */
export async function which(name: string): Promise<string> {
  const path = process.env.PATH ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable here, keep searching
    }
  }
  throw new Error(`executable not found on PATH: ${name}`);
}
