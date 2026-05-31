// SPDX-License-Identifier: MIT
import { platform } from 'node:os';
import { installMacOs, uninstallMacOs, statusMacOs } from './macos.js';

export const DAEMON_LABEL = 'ai.lark-multi-cli-bridge';

export async function installDaemon(opts: { nodeBin: string; cliPath: string }): Promise<string> {
  if (platform() === 'darwin') {
    return installMacOs({ label: DAEMON_LABEL, ...opts });
  }
  throw new Error(`daemon install not supported on ${platform()} yet`);
}

export async function uninstallDaemon(): Promise<void> {
  if (platform() === 'darwin') return uninstallMacOs(DAEMON_LABEL);
  throw new Error(`daemon uninstall not supported on ${platform()} yet`);
}

export async function statusDaemon(): Promise<string> {
  if (platform() === 'darwin') return statusMacOs(DAEMON_LABEL);
  return `unsupported platform: ${platform()}`;
}
