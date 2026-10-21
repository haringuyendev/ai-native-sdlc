// Legacy entry point (hooks.json 1.0.x): routes through the claude-code adapter.
import { runAgentHook } from './run.mjs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const r = await runAgentHook('claude-code', 'pre-bash', raw);
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.code);
