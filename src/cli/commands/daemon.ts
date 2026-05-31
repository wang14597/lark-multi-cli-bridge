// SPDX-License-Identifier: MIT
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDaemon, uninstallDaemon, statusDaemon } from '../../daemon/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function daemonInstall(): Promise<void> {
  const cliPath = resolve(HERE, '../index.js');  // points to dist/cli/index.js when running from dist
  const path = await installDaemon({ nodeBin: process.execPath, cliPath });
  console.log(`installed plist: ${path}`);
}

export async function daemonUninstall(): Promise<void> {
  await uninstallDaemon();
  console.log('daemon uninstalled');
}

export async function daemonStatus(): Promise<void> {
  console.log(await statusDaemon());
}
