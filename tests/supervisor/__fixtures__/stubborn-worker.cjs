// SPDX-License-Identifier: MIT
// Test fixture: a worker that reports ready, then ignores SIGTERM (like a
// worker whose shutdown hangs) and only dies on SIGKILL. Writes its pid to
// LMCB_FAKE_PIDS so the test can see every worker ever spawned.
const { appendFileSync } = require('node:fs');
if (process.env.LMCB_FAKE_PIDS) appendFileSync(process.env.LMCB_FAKE_PIDS, `${process.pid}\n`);
process.on('SIGTERM', () => {});
if (process.send) process.send({ kind: 'ready', workerId: process.env.LMCB_WORKER_BOT || 'test' });
setInterval(() => {}, 1000);
