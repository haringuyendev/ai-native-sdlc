import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';

const readme = readFileSync(join(PLUGIN_ROOT, 'README.md'), 'utf8');

test('README has every required section', () => {
  for (const h of ['Cài đặt', 'Bắt đầu', 'Vòng làm việc', 'Skill', 'Guardrail', 'Cấu hình', 'Eval và lesson', 'Phát triển plugin', 'Ghi công']) {
    assert.match(readme, new RegExp(`^## ${h}$`, 'm'), `thiếu mục ## ${h}`);
  }
});

test('README mentions every skill as ai-native-sdlc:<name>', () => {
  const skills = readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const s of skills) assert.ok(readme.includes(`ai-native-sdlc:${s}`), `thiếu ai-native-sdlc:${s}`);
});

test('README does not present skills as vendored and has no third-party license pointer', () => {
  assert.ok(!/vendor/i.test(readme));
  assert.ok(!readme.includes('LICENSE-THIRD-PARTY'));
});

// Text of one "### <title>" subsection (up to the next heading of level 2 or 3).
const subsection = (title) => {
  const start = readme.indexOf(`\n### ${title}\n`);
  assert.ok(start >= 0, `thiếu mục ### ${title}`);
  const rest = readme.slice(start + 1);
  const end = rest.slice(1).search(/\n##{1,2} /);
  return end < 0 ? rest : rest.slice(0, end + 1);
};

test('README has an install subsection per agent with its exact install commands', () => {
  assert.match(subsection('Claude Code'), /claude plugin marketplace add .*\n\s*claude plugin install ai-native-sdlc@ai-native-sdlc/);
  assert.match(subsection('Codex CLI'), /codex plugin marketplace add .*\n\s*codex plugin add ai-native-sdlc@ai-native-sdlc/);
  const agy = subsection('Antigravity (`agy`)');
  assert.match(agy, /agy plugin install <đường-dẫn-tới-repo-này>/);
  assert.match(agy, /agy plugin install https:\/\/github\.com\//);
});

test('README tells Codex users to trust the hooks in /hooks', () => {
  const codex = subsection('Codex CLI');
  assert.match(codex, /`\/hooks`/);
  assert.match(codex, /duyệt lại/);
});
