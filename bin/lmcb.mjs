#!/usr/bin/env node
import('../dist/cli/index.js').catch((err) => {
  console.error('[lmcb] failed to load CLI:', err);
  process.exit(1);
});
