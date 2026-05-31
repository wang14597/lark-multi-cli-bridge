// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { runWorker } from '../worker/index.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { psCommand } from './commands/ps.js';
import { restartCommand } from './commands/restart.js';
import { reloadCommand } from './commands/reload.js';

const program = new Command();
program.name('lmcb').description('lark-multi-cli-bridge').version('0.0.1');

program
  .command('run-worker <bot>')
  .description('run a single worker in the foreground (debug aid)')
  .action(async (bot: string) => {
    try {
      await runWorker(bot);
    } catch (err) {
      console.error('worker failed:', err);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('start the supervisor (and all enabled bots)')
  .option('--foreground', 'run supervisor in foreground for debugging')
  .action(startCommand);

program.command('stop').description('stop the supervisor').action(stopCommand);
program.command('ps').description('list workers and their state').action(psCommand);
program.command('restart <bot>').description('restart a worker').action(restartCommand);
program.command('reload <bot>').description('reload a worker (alias for restart in M3)').action(reloadCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
