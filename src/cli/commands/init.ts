// SPDX-License-Identifier: MIT
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { paths } from '../../config/paths.js';
import { botAdd } from './bot.js';
import { scanRegisterApp } from '../../auth/register-app.js';

const OVERLAY_SKILL_NAME = 'lark-bridge-overlay';
const SKILL_AGENT_DIRS = [
  '.claude/skills',
  '.agents/skills',
  '.codex/skills',
  '.gemini/skills',
] as const;

const APP_ID_RE = /^cli_[A-Za-z0-9]+$/;
const BOT_NAME_RE = /^[a-z][a-z0-9-]*$/;
const BACKENDS = ['claude', 'codex', 'gemini'] as const;
type Backend = (typeof BACKENDS)[number];
const PROVISION_CHOICES = ['scan', 'manual'] as const;
type ProvisionChoice = (typeof PROVISION_CHOICES)[number];

/**
 * Default-yes Y/n parser used by the post-init skill-install prompt.
 * Empty input, y, Y, yes, YES → true (install).
 * n, N, no, NO → false (skip).
 * Anything else → true (treat as default).
 */
export function parseInstallSkillsAnswer(input: string): boolean {
  const t = input.trim().toLowerCase();
  if (t === 'n' || t === 'no') return false;
  return true;
}

export function isOverlaySkillInstalled(home: string = homedir()): boolean {
  for (const d of SKILL_AGENT_DIRS) {
    if (existsSync(join(home, d, OVERLAY_SKILL_NAME))) return true;
  }
  return false;
}

/**
 * Locate scripts/install-skills.sh relative to this module.
 * - Built (dist/cli/index.js): repo root is two levels up.
 * - tsx/dev (src/cli/commands/init.ts): repo root is three levels up.
 * Returns undefined if neither path resolves to an existing file (e.g.
 * the bridge was installed without its scripts/ tree).
 */
export function resolveInstallSkillsScript(moduleUrl: string = import.meta.url): string | undefined {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(here, '..', '..', 'scripts', 'install-skills.sh'),
    resolve(here, '..', '..', '..', 'scripts', 'install-skills.sh'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function parseProvisionChoice(input: string): ProvisionChoice | undefined {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '1' || trimmed === 'scan') return 'scan';
  if (trimmed === '2' || trimmed === 'manual') return 'manual';
  return undefined;
}

export function validateAppId(s: string): string | undefined {
  if (!APP_ID_RE.test(s)) return 'must look like cli_<alphanumeric>';
  return undefined;
}

export function validateBotName(s: string): string | undefined {
  if (!BOT_NAME_RE.test(s)) return 'must be lowercase-kebab-case (start with a letter)';
  return undefined;
}

export function parseBackendChoice(input: string): Backend | undefined {
  const trimmed = input.trim().toLowerCase();
  if (BACKENDS.includes(trimmed as Backend)) return trimmed as Backend;
  const n = parseInt(trimmed, 10);
  if (Number.isFinite(n) && n >= 1 && n <= BACKENDS.length) {
    return BACKENDS[n - 1];
  }
  return undefined;
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'linux' ? 'xdg-open' : '';
  if (!cmd) {
    console.log(`Open this URL in your browser: ${url}`);
    return;
  }
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}

async function promptHidden(promptText: string): Promise<string> {
  // Read stdin chars one at a time, echoing '*' for each. Falls back to plain echo if raw mode unsupported.
  return new Promise((resolve) => {
    stdout.write(promptText);
    const tty = stdin.isTTY;
    if (!tty) {
      // non-tty: just read a line
      const rl = createInterface({ input: stdin, output: stdout });
      void rl.question('').then((v) => {
        rl.close();
        resolve(v);
      });
      return;
    }
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '') {
          // Ctrl-C
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(130);
        }
        if (ch === '' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        buf += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function existingBotCount(): Promise<number> {
  if (!existsSync(paths.bots)) return 0;
  try {
    const entries = await readdir(paths.bots);
    return entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml')).length;
  } catch {
    return 0;
  }
}

const DEV_CONSOLE_URL_LARK = 'https://open.larksuite.com/app';
const DEV_CONSOLE_URL_FEISHU = 'https://open.feishu.cn/app';

interface AppCreds {
  appId: string;
  appSecret: string;
  tenant: 'lark' | 'feishu';
}

async function promptManualAppCreds(rl: ReturnType<typeof createInterface>): Promise<AppCreds> {
  const tenantAns = (await rl.question('Tenant (lark/feishu) [lark]: ')).trim().toLowerCase() || 'lark';
  const tenant: 'lark' | 'feishu' = tenantAns === 'feishu' ? 'feishu' : 'lark';
  const consoleUrl = tenant === 'feishu' ? DEV_CONSOLE_URL_FEISHU : DEV_CONSOLE_URL_LARK;

  console.log('');
  console.log('To get an app_id / app_secret:');
  console.log(`  1. Visit ${consoleUrl}`);
  console.log('  2. Create a "Custom App for Internal Use"');
  console.log('  3. Open the app, go to "Credentials & Basic Info" to see App ID + App Secret');
  console.log('  4. Under "Events & Callbacks" enable WebSocket and subscribe `im.message.receive_v1`');
  console.log('  5. Under "Permissions" grant `im:message`, `im:message:send_as_bot`, `im:resource`');
  console.log('  6. Publish a version of the app');
  console.log('');
  const openAns = (await rl.question('Open the developer console in your browser now? [y/N]: '))
    .trim()
    .toLowerCase();
  if (openAns === 'y' || openAns === 'yes') openBrowser(consoleUrl);

  let appId: string = '';
  while (!appId) {
    const ans = (await rl.question('App ID (cli_...): ')).trim();
    const err = validateAppId(ans);
    if (err) {
      console.log(`  ${err}`);
      continue;
    }
    appId = ans;
  }

  rl.close();
  let appSecret = '';
  while (!appSecret) {
    appSecret = (await promptHidden('App Secret (hidden input): ')).trim();
    if (!appSecret) console.log('  cannot be empty');
  }

  return { appId, appSecret, tenant };
}

async function addOneBot(): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log('\n— Backend —');
  BACKENDS.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  let backend: Backend | undefined;
  while (!backend) {
    const ans = await rl.question('Pick a backend (1/2/3 or name) [1]: ');
    backend = parseBackendChoice(ans.trim() || '1');
    if (!backend) console.log('  invalid choice; try again');
  }

  let botName: string = '';
  while (!botName) {
    const def = `${backend}-bot`;
    const ans = (await rl.question(`Bot name [${def}]: `)).trim() || def;
    const err = validateBotName(ans);
    if (err) {
      console.log(`  ${err}`);
      continue;
    }
    if (existsSync(paths.botYaml(ans))) {
      console.log(`  bots/${ans}.yaml already exists; pick another name`);
      continue;
    }
    botName = ans;
  }

  // Provisioning method
  console.log('\n— Provisioning method —');
  console.log('  1. Scan a QR code with Lark mobile app to auto-create a new app under your tenant (recommended)');
  console.log('  2. Paste an existing App ID + App Secret manually');
  let provisionChoice: ProvisionChoice | undefined;
  while (!provisionChoice) {
    const ans = await rl.question('Pick [1]: ');
    provisionChoice = parseProvisionChoice(ans.trim() || '1');
    if (!provisionChoice) console.log('  invalid choice; enter 1 or 2');
  }

  let creds: AppCreds;

  if (provisionChoice === 'scan') {
    rl.close();
    let scanDone = false;
    while (!scanDone) {
      try {
        const registered = await scanRegisterApp();
        const maskedSecret = registered.appSecret.slice(0, 4) + '****';
        console.log(`\n✓ App registered successfully.`);
        console.log(`  App ID:  ${registered.appId}`);
        console.log(`  Secret:  ${maskedSecret}`);
        console.log(`  Tenant:  ${registered.tenant}`);
        creds = { appId: registered.appId, appSecret: registered.appSecret, tenant: registered.tenant };
        scanDone = true;
      } catch (scanErr) {
        console.error(`\nScan-to-create failed: ${(scanErr as Error).message}`);
        const rl3 = createInterface({ input: stdin, output: stdout });
        const retryAns = (await rl3.question('Retry scan (r) or switch to manual entry (m)? [r]: ')).trim().toLowerCase();
        rl3.close();
        if (retryAns === 'm' || retryAns === 'manual') {
          const rlManual = createInterface({ input: stdin, output: stdout });
          creds = await promptManualAppCreds(rlManual);
          scanDone = true;
        }
        // else loop and retry scan
      }
    }
    // creds is guaranteed set when scanDone = true
    creds = creds!;
  } else {
    creds = await promptManualAppCreds(rl);
  }

  try {
    await botAdd({ name: botName, appId: creds.appId, appSecret: creds.appSecret, backend, tenant: creds.tenant });
  } catch (err) {
    console.error(`failed to write bot YAML: ${(err as Error).message}`);
    return false;
  }
  console.log(`\nBot "${botName}" added.`);

  // Ask whether to add another.
  const rl2 = createInterface({ input: stdin, output: stdout });
  const more = (await rl2.question('Add another bot? [y/N]: ')).trim().toLowerCase();
  rl2.close();
  return more === 'y' || more === 'yes';
}

async function runInstallSkillsScript(scriptPath: string): Promise<void> {
  await new Promise<void>((res, rej) => {
    const child = spawn('bash', [scriptPath, '-g', '-y'], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`install-skills.sh exited with code ${code}`));
    });
    child.on('error', rej);
  });
}

async function maybeInstallSkills(): Promise<void> {
  if (isOverlaySkillInstalled()) {
    console.log('\nAgent skills already installed (lark-bridge-overlay detected). Skipping.');
    return;
  }
  console.log('');
  console.log('— Agent skills —');
  console.log('Install agent skills globally? (recommended)');
  console.log('  - lark-bridge-overlay: bridge-only conventions (injected blocks, card callbacks, OAuth)');
  console.log('  - lark-im, lark-shared: upstream lark-cli usage guides');
  console.log('Without these, your bot may echo bridge XML metadata to users or mishandle cards.');
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question('Install now? [Y/n]: ');
  rl.close();
  if (!parseInstallSkillsAnswer(ans)) {
    console.log('Skipped. You can install later with: pnpm skills:install -g -y');
    return;
  }
  const script = resolveInstallSkillsScript();
  if (!script) {
    console.log('\nCould not locate scripts/install-skills.sh from this install.');
    console.log('Run manually from the repo: pnpm skills:install -g -y');
    return;
  }
  console.log(`\nRunning: bash ${script} -g -y\n`);
  try {
    await runInstallSkillsScript(script);
  } catch (err) {
    console.error(`\nSkill install failed: ${(err as Error).message}`);
    console.error('You can retry later with: pnpm skills:install -g -y');
  }
}

export async function initCommand(): Promise<void> {
  console.log('lmcb init — interactive bot setup');
  const count = await existingBotCount();
  if (count > 0) {
    console.log(`Found ${count} existing bot(s) under ${paths.bots}.`);
    const rl = createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question('Add another bot? [Y/n]: ')).trim().toLowerCase();
    rl.close();
    if (ans === 'n' || ans === 'no') {
      console.log('Nothing to do.');
      return;
    }
  }

  let more = true;
  while (more) {
    more = await addOneBot();
  }

  await maybeInstallSkills();

  console.log('\nDone. Next steps:');
  console.log('  node ./bin/lmcb.mjs start --foreground   # for first-time debugging');
  console.log('  node ./bin/lmcb.mjs ps                   # see worker state');
  console.log('  In Lark, message the bot to see streaming reply.');
}
