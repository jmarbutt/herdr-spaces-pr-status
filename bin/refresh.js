import { runSync, summarize } from '../lib/run.js';

// Manual refresh ignores every cache: if you asked, you want the truth now.
const result = runSync({ bypassCache: true });
process.stdout.write(`${summarize(result)}\n`);
process.exit(result.ok ? 0 : 1);
