import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAny } from '../lib/glob.mjs';

const cases = [
  ['src/gen/**', 'src/gen/a/b.ts', true],
  ['src/gen/**', 'src/general.ts', false],
  ['**/*.test.*', 'a.test.js', true],
  ['**/*.test.*', 'pkg/x/a.test.ts', true],
  ['**/*.test.*', 'pkg/x/atest.ts', false],
  ['**/test_*.py', 'svc/tests/test_status.py', true],
  ['**/tests/**', 'tests/a.py', true],
  ['legacy/v1/*', 'legacy/v1/a/b.py', false],
  ['file?.md', 'file1.md', true],
];

for (const [glob, path, expected] of cases) {
  test(`${glob} vs ${path} -> ${expected}`, () => {
    assert.equal(matchesAny(path, [glob]), expected);
  });
}

test('normalizes windows separators and ./ prefix', () => {
  assert.equal(matchesAny('.\\src\\gen\\x.ts', ['src/gen/**']), true);
});

test('empty glob list never matches', () => {
  assert.equal(matchesAny('a.ts', []), false);
});
