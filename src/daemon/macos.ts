// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface MacOsDaemonOpts {
  label: string;
  nodeBin: string;
  cliPath: string;
}

function plistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function plistContent(opts: MacOsDaemonOpts): string {
  const logDir = join(homedir(), '.lark-multi-cli-bridge', 'logs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.nodeBin}</string>
    <string>${opts.cliPath}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'launchd.err.log')}</string>
</dict>
</plist>
`;
}

export async function installMacOs(opts: MacOsDaemonOpts): Promise<string> {
  const path = plistPath(opts.label);
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(path, plistContent(opts), { mode: 0o644 });
  await exec('launchctl', ['unload', path]).catch(() => {});
  await exec('launchctl', ['load', path]);
  return path;
}

export async function uninstallMacOs(label: string): Promise<void> {
  const path = plistPath(label);
  if (!existsSync(path)) return;
  await exec('launchctl', ['unload', path]).catch(() => {});
  await unlink(path);
}

export async function statusMacOs(label: string): Promise<string> {
  try {
    const { stdout } = await exec('launchctl', ['list']);
    const line = stdout.split('\n').find((l) => l.includes(label));
    return line ?? 'not loaded';
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
