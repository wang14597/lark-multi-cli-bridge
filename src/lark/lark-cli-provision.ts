// SPDX-License-Identifier: MIT
import { join } from 'node:path';

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
