import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editedText, checkProtected, checkTestLock, checkSecrets, checkGates } from '../lib/guards.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';

const config = {
  ...DEFAULT_CONFIG,
  protected_paths: ['src/gen/**'],
  gates: [{ pattern: '[', reason: 'broken' }, { pattern: 'deploy.*prod', reason: 'Cần release manager duyệt' }],
};

test('editedText gathers text from every edit tool shape', () => {
  assert.equal(editedText({ content: 'a' }), 'a');
  assert.equal(editedText({ old_string: 'x', new_string: 'b' }), 'b');
  assert.equal(editedText({ edits: [{ new_string: 'c' }, { new_string: 'd' }] }), 'c\nd');
  assert.equal(editedText({ new_source: 'e' }), 'e');
});

test('checkProtected blocks protected paths only', () => {
  assert.match(checkProtected('src/gen/a.ts', config), /protected_paths/);
  assert.equal(checkProtected('src/app.ts', config), null);
});

test('checkTestLock blocks test files only while a change is locked', () => {
  assert.match(checkTestLock('src/a.test.ts', config, ['2026-10-20-fix']), /2026-10-20-fix/);
  assert.equal(checkTestLock('src/a.test.ts', config, []), null);
  assert.equal(checkTestLock('src/a.ts', config, ['x']), null);
});

test('checkSecrets flags common secret shapes', () => {
  for (const s of [
    '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'ghp_' + 'a'.repeat(36),
    'xoxb-' + '1234567890-abc',
    'sk-ant-' + 'b'.repeat(30),
    'password = "hunter2' + 'hunter2"',
  ]) {
    assert.notEqual(checkSecrets(s), null, s);
  }
  assert.equal(checkSecrets('const password = process.env.DB_PASSWORD;'), null);
});

test('checkSecrets lets placeholders through', () => {
  for (const s of [
    'password: "<your-password>"',
    'api_key = "${API_KEY}"',
    'secret: "process.env.SECRET"',
    'AKIA' + 'IOSFODNN7EXAMPLE',
  ]) {
    assert.equal(checkSecrets(s), null, s);
  }
});

test('checkSecrets still catches a real key after a placeholder match', () => {
  const text = 'password: "<your-password>"\nconst k = "AKIA' + 'ABCDEFGHIJKLMNOP";';
  assert.match(checkSecrets(text), /AWS/);
  assert.match(checkSecrets(text), /secret_allow/);
});

test('default template gates: force push and prod deploy', () => {
  const { gates } = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'templates', 'config.json'), 'utf8'));
  const cfg = { ...DEFAULT_CONFIG, gates };
  for (const c of ['git push -f origin main', 'git push --force', 'git push origin +main', './deploy.sh production']) {
    assert.notEqual(checkGates(c, cfg), null, c);
  }
  for (const c of ['git push origin feature-fix', 'grep -r deploy src/products']) {
    assert.equal(checkGates(c, cfg), null, c);
  }
});

test('checkGates asks on matching commands and skips bad regexes', () => {
  assert.match(checkGates('./deploy.sh --env production', config), /release manager/);
  assert.equal(checkGates('npm test', config), null);
});
