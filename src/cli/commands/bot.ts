// SPDX-License-Identifier: MIT
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import yaml from 'js-yaml';
import { paths } from '../../config/paths.js';

export async function botList(): Promise<void> {
  try {
    const entries = await readdir(paths.bots);
    const yamls = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'));
    if (yamls.length === 0) {
      console.log('(no bots configured)');
      return;
    }
    for (const e of yamls) console.log(`  ${basename(e, extname(e))}`);
  } catch {
    console.log('(no bots directory yet)');
  }
}

export interface BotAddOpts {
  name: string;
  appId: string;
  appSecret: string;
  backend: string;
  tenant?: 'lark' | 'feishu';
}

export async function botAdd(opts: BotAddOpts): Promise<void> {
  if (!['claude', 'codex', 'gemini'].includes(opts.backend)) {
    throw new Error(`backend must be claude|codex|gemini, got ${opts.backend}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(opts.name)) {
    throw new Error(`bot name must be lowercase-kebab-case, got "${opts.name}"`);
  }
  const file = join(paths.bots, `${opts.name}.yaml`);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const backendBlock: Record<string, unknown> =
    opts.backend === 'claude'
      ? { permission_mode: 'bypassPermissions' }
      : {};
  const body: Record<string, unknown> = {
    name: opts.name,
    enabled: true,
    lark: { app_id: opts.appId, app_secret: opts.appSecret, tenant: opts.tenant ?? 'lark' },
    backend: { type: opts.backend, [opts.backend]: backendBlock },
    access: { allowed_users: [], allowed_chats: [], admins: [] },
    behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
  };
  await writeFile(file, yaml.dump(body), { mode: 0o600 });
  console.log(`created ${file}`);
}

export async function botRm(name: string): Promise<void> {
  await rm(join(paths.bots, `${name}.yaml`), { force: true });
  console.log(`removed bots/${name}.yaml`);
}
