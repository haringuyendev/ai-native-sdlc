import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-test-'));
  for (const [p, content] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete env[k];
  return env;
}

export function gitInit(root) {
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, env: cleanEnv() });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'init', '--allow-empty');
}

export function runHook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'hooks', name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

export function runAgent(agent, event, input, env = {}) {
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'hooks', 'run.mjs'), '--agent', agent, '--event', event], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

export const progress = (frontmatter, body = '## Log\n') => `---\n${frontmatter.trim()}\n---\n${body}`;
