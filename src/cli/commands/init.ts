// SPDX-License-Identifier: MIT
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { paths } from '../../config/paths.js';
import { botAdd } from './bot.js';

const APP_ID_RE = /^cli_[A-Za-z0-9]+$/;
const BOT_NAME_RE = /^[a-z][a-z0-9-]*$/;
const BACKENDS = ['claude', 'codex', 'gemini'] as const;
type Backend = (typeof BACKENDS)[number];

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

  const tenantAns = (await rl.question('Tenant (lark/feishu) [lark]: ')).trim().toLowerCase() || 'lark';
  const tenant = tenantAns === 'feishu' ? 'feishu' : 'lark';
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

  try {
    await botAdd({ name: botName, appId, appSecret, backend });
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
  console.log('\nDone. Next steps:');
  console.log('  node ./bin/lmcb.mjs start --foreground   # for first-time debugging');
  console.log('  node ./bin/lmcb.mjs ps                   # see worker state');
  console.log('  In Lark, message the bot to see streaming reply.');
}
