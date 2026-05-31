// SPDX-License-Identifier: MIT
// Test fixture: a fake worker that immediately exits with the code given by env LMCB_FAKE_EXIT.
const code = parseInt(process.env.LMCB_FAKE_EXIT || '0', 10);
if (process.env.LMCB_FAKE_READY === '1' && process.send) {
  process.send({ kind: 'ready', workerId: process.env.LMCB_WORKER_BOT || 'test' });
}
setTimeout(() => process.exit(code), 50);
