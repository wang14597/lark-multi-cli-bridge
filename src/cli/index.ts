// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { runWorker } from '../worker/index.js';

const program = new Command();
program.name('lmcb').description('lark-multi-cli-bridge').version('0.0.1');

program
  .command('run-worker <bot>')
  .description('[M1] run a single worker in the foreground (no supervisor yet)')
  .action(async (bot: string) => {
    try {
      await runWorker(bot);
    } catch (err) {
      console.error('worker failed:', err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
