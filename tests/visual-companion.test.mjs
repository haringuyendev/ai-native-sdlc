import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync, utimesSync } from 'node:fs';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { makeRepo, gitInit, PLUGIN_ROOT } from './helpers.mjs';

// Protocol of the spec skill's visual companion (spec R5): pinned on the old
// scripts so the rewrite must keep it.
const BRAIN = join(PLUGIN_ROOT, 'skills', 'spec', 'scripts');

const bash = (cwd, script, ...args) => {
  const r = spawnSync('bash', [join(BRAIN, script), ...args], { cwd, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function repo() {
  const root = realpathSync(makeRepo({ 'README.md': 'x\n' }));
  gitInit(root);
  return root;
}
function start(root) {
  const r = bash(root, 'start-server.sh', '--project-dir', root);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}
const stop = (root, info) => bash(root, 'stop-server.sh', dirname(info.screen_dir));
const origin = (info) => new URL(info.url).origin;
const keyOf = (info) => new URL(info.url).searchParams.get('key');

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

// Sends one text frame the way the page's helper.js does: a WebSocket to
// /?key=<key> on the same host, carrying the click event as JSON.
function sendWsText(info, text) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(info.url);
    const socket = connect(Number(port), hostname);
    socket.on('error', reject);
    socket.once('connect', () => {
      socket.write(
        `GET /?key=${encodeURIComponent(keyOf(info))} HTTP/1.1\r\n` +
        `Host: ${hostname}:${port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n');
    });
    socket.once('data', (chunk) => {
      if (!chunk.toString().startsWith('HTTP/1.1 101')) { socket.destroy(); reject(new Error(chunk.toString())); return; }
      const payload = Buffer.from(text);
      const mask = randomBytes(4);
      const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
      setTimeout(() => { socket.destroy(); resolve(); }, 100);
    });
  });
}

test('start prints server-started JSON with a keyed url', () => {
  const root = repo();
  const info = start(root);
  try {
    assert.equal(info.type, 'server-started');
    assert.equal(typeof info.port, 'number');
    assert.match(info.url, /\?key=[^&\s]+/);
    assert.ok(existsSync(info.screen_dir), info.screen_dir);
    assert.ok(existsSync(info.state_dir), info.state_dir);
    assert.ok(existsSync(join(info.state_dir, 'server-info')));
  } finally {
    stop(root, info);
  }
});

// Old behavior, stated exactly: the keyed URL answers with a bootstrap page that
// stores the key and sets a session cookie; the screen itself is served on `/`
// to a request carrying that cookie. A request with neither key nor cookie gets 403.
test('serves the newest screen file to a request with the key and refuses one without it', async () => {
  const root = repo();
  const info = start(root);
  try {
    writeFileSync(join(info.screen_dir, 'older.html'), '<p>older screen</p>');
    utimesSync(join(info.screen_dir, 'older.html'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));
    writeFileSync(join(info.screen_dir, 'newest.html'), '<p>newest screen marker</p>');
    const keyed = await fetch(info.url);
    assert.equal(keyed.status, 200);
    const cookie = keyed.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie.includes(keyOf(info)), cookie);
    const screen = await fetch(origin(info) + '/', { headers: { cookie } });
    assert.equal(screen.status, 200);
    const html = await screen.text();
    assert.match(html, /newest screen marker/);
    assert.doesNotMatch(html, /older screen/);
    const anonymous = await fetch(origin(info) + '/');
    assert.equal(anonymous.status, 403);
    assert.doesNotMatch(await anonymous.text(), /newest screen marker/);
  } finally {
    stop(root, info);
  }
});

test('a click event posted by the page is appended to state_dir/events as a JSON line', async () => {
  const root = repo();
  const info = start(root);
  try {
    const event = { type: 'click', text: 'Option A', choice: 'a', id: null };
    await sendWsText(info, JSON.stringify(event));
    const events = join(info.state_dir, 'events');
    assert.ok(await waitFor(() => existsSync(events)), 'events file not written');
    const lines = readFileSync(events, 'utf8').trim().split('\n');
    assert.deepEqual(JSON.parse(lines.at(-1)), event);
  } finally {
    stop(root, info);
  }
});

test('stop writes server-stopped and frees the port', async () => {
  const root = repo();
  const info = start(root);
  const r = stop(root, info);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(JSON.parse(r.out).status, 'stopped');
  assert.ok(existsSync(join(info.state_dir, 'server-stopped')));
  assert.ok(!existsSync(join(info.state_dir, 'server-info')));
  await assert.rejects(fetch(info.url));
});

test('starting twice and stopping twice does not hang and leaves git status clean', () => {
  const root = repo();
  const first = start(root);
  const second = start(root);
  assert.notEqual(first.port, second.port);
  for (const info of [first, second]) {
    const a = stop(root, info);
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(JSON.parse(a.out).status, 'stopped');
    const b = stop(root, info);
    assert.equal(b.code, 0, b.out + b.err);
    assert.equal(JSON.parse(b.out).status, 'not_running');
  }
  assert.equal(git(root, 'status', '--porcelain'), '');
});

// Added with the Task 7 rewrite: protocol points from visual-companion.md that the
// tests above do not reach. They pass on the old scripts (base 86356b5) and the new ones.
async function screenHtml(info) {
  const keyed = await fetch(info.url);
  const cookie = keyed.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return (await fetch(origin(info) + '/', { headers: { cookie } })).text();
}

test('an unknown flag prints a JSON error and exits 1', () => {
  const root = repo();
  const r = bash(root, 'start-server.sh', '--bogus');
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out), { error: 'Unknown argument: --bogus' });
});

test('--project-dir writes .ai-sdlc/.gitignore containing * and names the session <pid>-<epoch>', () => {
  const root = repo();
  const info = start(root);
  try {
    assert.equal(readFileSync(join(root, '.ai-sdlc', '.gitignore'), 'utf8'), '*\n');
    assert.match(dirname(info.screen_dir), /\/\.ai-sdlc\/brainstorm\/\d+-\d+$/);
    assert.equal(info.screen_dir, join(dirname(info.screen_dir), 'content'));
    assert.equal(info.state_dir, join(dirname(info.screen_dir), 'state'));
    assert.deepEqual(JSON.parse(readFileSync(join(info.state_dir, 'server-info'), 'utf8')), info);
  } finally {
    stop(root, info);
  }
});

test('a fragment is framed with the version badge; a full document is served as written', async () => {
  const root = repo();
  const info = start(root);
  try {
    writeFileSync(join(info.screen_dir, 'frag.html'), '<h2>fragment marker</h2>');
    let html = await screenHtml(info);
    assert.match(html, /fragment marker/);
    assert.match(html, /class="status"/);
    assert.match(html, /ai-native-sdlc v\S+/);
    assert.doesNotMatch(html, /<!-- (CONTENT|BRANDING) -->/);
    assert.match(html, /toggleSelect/);
    writeFileSync(join(info.screen_dir, 'full.html'), '<!DOCTYPE html><html><body><p>whole page marker</p></body></html>');
    utimesSync(join(info.screen_dir, 'full.html'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    html = await screenHtml(info);
    assert.match(html, /whole page marker/);
    assert.doesNotMatch(html, /class="status"/);
    assert.match(html, /toggleSelect/);
  } finally {
    stop(root, info);
  }
});

test('only events with a choice are recorded, and a new screen clears them', async () => {
  const root = repo();
  const info = start(root);
  try {
    const events = join(info.state_dir, 'events');
    await sendWsText(info, JSON.stringify({ type: 'click', text: 'no choice', id: null }));
    await sendWsText(info, JSON.stringify({ type: 'click', text: 'B', choice: 'b', id: null }));
    assert.ok(await waitFor(() => existsSync(events)));
    assert.deepEqual(readFileSync(events, 'utf8').trim().split('\n').map((l) => JSON.parse(l).choice), ['b']);
    writeFileSync(join(info.screen_dir, 'next-screen.html'), '<p>next</p>');
    assert.ok(await waitFor(() => !existsSync(events)), 'events not cleared by a new screen');
  } finally {
    stop(root, info);
  }
});

test('a restart with the same --project-dir reuses port and key', () => {
  const root = repo();
  const first = start(root);
  stop(root, first);
  const second = start(root);
  try {
    assert.equal(second.port, first.port);
    assert.equal(keyOf(second), keyOf(first));
  } finally {
    stop(root, second);
  }
});

test('stop: a missing argument exits 1; a pid that is not this server gives stale_pid', () => {
  const root = repo();
  const none = bash(root, 'stop-server.sh');
  assert.equal(none.code, 1);
  assert.ok(JSON.parse(none.out).error);
  const info = start(root);
  const realPid = readFileSync(join(info.state_dir, 'server.pid'), 'utf8').trim();
  try {
    writeFileSync(join(info.state_dir, 'server.pid'), String(process.pid));
    const r = bash(root, 'stop-server.sh', dirname(info.screen_dir));
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(JSON.parse(r.out).status, 'stale_pid');
    assert.ok(existsSync(join(info.state_dir, 'server-stopped')));
    assert.ok(!existsSync(join(info.state_dir, 'server-info')));
  } finally {
    try { process.kill(Number(realPid)); } catch { /* already gone */ }
  }
});

// Task 7 review round 1: in --foreground mode server.pid must hold the node
// server itself (argv carries the instance id), so stop-server.sh stops it.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('--foreground records the server pid so stop-server.sh stops it', async () => {
  const root = repo();
  const child = spawn('bash', [join(BRAIN, 'start-server.sh'), '--project-dir', root, '--foreground'],
    { cwd: root, stdio: 'ignore' });
  const brainstorm = join(root, '.ai-sdlc', 'brainstorm');
  const stateDir = () => {
    const ids = existsSync(brainstorm) ? readdirSync(brainstorm).filter((n) => /^\d+-\d+$/.test(n)) : [];
    return ids.length ? join(brainstorm, ids[0], 'state') : null;
  };
  let pid = null;
  let id = null;
  try {
    assert.ok(await waitFor(() => stateDir() && existsSync(join(stateDir(), 'server-info')), 10000), 'server never started');
    const state = stateDir();
    pid = Number(readFileSync(join(state, 'server.pid'), 'utf8').trim());
    id = readFileSync(join(state, 'server-instance-id'), 'utf8').trim();
    const argv = execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    assert.ok(argv.includes(`--brainstorm-server-id=${id}`), argv);
    const r = bash(root, 'stop-server.sh', dirname(state));
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(JSON.parse(r.out).status, 'stopped');
    assert.ok(await waitFor(() => !alive(pid)), 'server process still running');
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    // A wrong pid file would leave the real server behind: find it by its id.
    if (id) spawnSync('pkill', ['-f', `--brainstorm-server-id=${id}`]);
    child.kill('SIGKILL');
  }
});

test('a project session under /tmp keeps its screens after stop', () => {
  // Not realpath'd: on macOS /tmp resolves to /private/tmp and would hide the bug.
  const root = execFileSync('mktemp', ['-d', '/tmp/vc-project-XXXXXX'], { encoding: 'utf8' }).trim();
  gitInit(root);
  const info = start(root);
  const r = stop(root, info);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(existsSync(join(info.state_dir, 'server-stopped')));
  assert.ok(existsSync(info.screen_dir));
});
