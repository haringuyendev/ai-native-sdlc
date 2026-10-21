import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { shortSkill } from '../adapters/eval-util.mjs';

const SOURCES = ['task', 'incident', 'trigger'];
const CHECK_TYPES = ['skill_first', 'skill_never', 'output_includes', 'output_excludes', 'command'];
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isPosInt = (v) => Number.isInteger(v) && v > 0;

function validateCheck(c, i) {
  const at = `checks[${i}]`;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return [`${at} phải là object`];
  if (!CHECK_TYPES.includes(c.type)) return [`${at}.type không hợp lệ: ${c.type} (chọn: ${CHECK_TYPES.join(', ')})`];
  const errors = [];
  if (c.type === 'skill_first' || c.type === 'skill_never') {
    if (!isStr(c.skill)) errors.push(`${at}.skill bắt buộc (chuỗi)`);
  } else if (c.type === 'output_includes' || c.type === 'output_excludes') {
    if (!isStr(c.text)) errors.push(`${at}.text bắt buộc (chuỗi)`);
  } else {
    if (!isStr(c.run)) errors.push(`${at}.run bắt buộc (chuỗi)`);
    if (c.expect_exit !== undefined && !Number.isInteger(c.expect_exit)) errors.push(`${at}.expect_exit phải là số nguyên`);
  }
  return errors;
}

export function validateEval(obj, file) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['eval phải là một object JSON'];
  const errors = [];
  if (!isStr(obj.name) || !/^[a-z0-9-]+$/.test(obj.name)) errors.push('name bắt buộc, chỉ gồm a-z, 0-9 và dấu gạch ngang');
  else if (file && basename(file, '.json') !== obj.name) errors.push(`name "${obj.name}" phải trùng tên file "${basename(file)}"`);
  if (!isStr(obj.description)) errors.push('description bắt buộc');
  if (!SOURCES.includes(obj.source)) errors.push(`source phải là một trong: ${SOURCES.join(', ')}`);
  if (obj.source === 'incident' && !isStr(obj.lesson)) errors.push('eval source "incident" phải có lesson');
  if (!isStr(obj.prompt)) errors.push('prompt bắt buộc');
  if (obj.max_turns !== undefined && !isPosInt(obj.max_turns)) errors.push('max_turns phải là số nguyên dương');
  if (obj.timeout_sec !== undefined && !isPosInt(obj.timeout_sec)) errors.push('timeout_sec phải là số nguyên dương');
  if (obj.allowed_tools !== undefined && typeof obj.allowed_tools !== 'string') errors.push('allowed_tools phải là chuỗi');
  if (obj.args !== undefined && !(Array.isArray(obj.args) && obj.args.every((a) => typeof a === 'string'))) errors.push('args phải là mảng chuỗi');
  if (!Array.isArray(obj.checks) || obj.checks.length === 0) errors.push('checks phải là mảng có ít nhất một check');
  else obj.checks.forEach((c, i) => errors.push(...validateCheck(c, i)));
  return errors;
}

export function loadEvals(root) {
  const dir = join(root, 'sdlc', 'evals');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      let evalObj = null;
      try {
        evalObj = JSON.parse(readFileSync(file, 'utf8'));
      } catch (e) {
        return { file, eval: null, errors: [`JSON không hợp lệ: ${e.message}`] };
      }
      return { file, eval: evalObj, errors: validateEval(evalObj, file) };
    });
}

// Claude stream parsing lives in the claude-code adapter; re-exported for existing callers.
export { parseStream, toolNames } from '../adapters/claude-code.mjs';

export function outputChecks(evalObj, parsed) {
  const out = [];
  for (const check of evalObj.checks) {
    if (check.type === 'command') continue;
    let pass;
    let reason = '';
    if (check.type === 'skill_first') {
      pass = parsed.skills[0] !== undefined && shortSkill(parsed.skills[0]) === shortSkill(check.skill);
      if (!pass) reason = parsed.skills.length ? `skill đầu tiên là ${parsed.skills[0]}, cần ${check.skill}` : 'không skill nào được gọi';
    } else if (check.type === 'skill_never') {
      pass = !parsed.skills.some((s) => shortSkill(s) === shortSkill(check.skill));
      if (!pass) reason = `skill ${check.skill} đã bị gọi`;
    } else if (check.type === 'output_includes') {
      pass = parsed.result.includes(check.text);
      if (!pass) reason = `đầu ra không chứa "${check.text}"`;
    } else {
      pass = !parsed.result.includes(check.text);
      if (!pass) reason = `đầu ra chứa "${check.text}"`;
    }
    out.push({ check, pass, reason });
  }
  return out;
}

// A run killed at its timeout (agents without a turn cap): grade the partial stream's skill checks only.
// No skill invoked at all → plain timeout; checks that need a finished run (output_*, command) fail.
export function timeoutChecks(evalObj, parsed, timeoutSec) {
  const prefix = `quá thời gian ${timeoutSec}s`;
  if (parsed.skills.length === 0) return [prefix];
  const failures = [];
  for (const check of evalObj.checks) {
    if (check.type === 'skill_first' || check.type === 'skill_never') {
      const [o] = outputChecks({ checks: [check] }, parsed);
      if (!o.pass) failures.push(`${prefix}; ${o.reason}`);
    } else {
      failures.push(`${prefix}; không chấm được check ${check.type} khi bị dừng giữa chừng`);
    }
  }
  return failures;
}

export function summarize(results) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  return { passed, total, rate: total === 0 ? 0 : passed / total };
}
