const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

global.window = {};
require('../policy-data.js');

const policies = global.window.VARDA_POLICIES;
assert.equal(policies.length, 85, 'must include ACT-001 through ACT-085');
assert.equal(policies[0].code, 'VARDA ACT-001');
assert.equal(policies.at(-1).code, 'VARDA ACT-085');

const codes = new Set(policies.map((policy) => policy.code));
assert.equal(codes.size, 85, 'ACT codes must be unique');
for (const policy of policies) {
  for (const field of ['code', 'department', 'title', 'rule', 'severity', 'points', 'approval', 'evidence', 'dueProcess', 'action', 'keywords', 'basis']) {
    assert.notEqual(policy[field], null, `${policy.code} is missing ${field}`);
    assert.notEqual(policy[field], '', `${policy.code} has a blank ${field}`);
  }
  assert.ok(['Minor', 'Major', 'Critical'].includes(policy.severity), `${policy.code} has invalid severity`);
  assert.ok(Number.isInteger(policy.points) && policy.points >= 1 && policy.points <= 25, `${policy.code} has invalid points`);
}

const act001 = policies.find((policy) => policy.code === 'VARDA ACT-001');
assert.equal(act001.title, 'Sleeping or Loafing While On Duty');
assert.equal(act001.severity, 'Major');
assert.equal(act001.points, 8);
assert.match(`${act001.title} ${act001.rule} ${act001.keywords}`.toLowerCase(), /sleeping/);

const html = fs.readFileSync(require.resolve('../policy-v1.html'), 'utf8');
for (const requiredText of ['SHOW ALL POLICY', 'FILE IR', 'SUBMIT NTE', 'INCIDENT REPORT', 'NOTICE TO EXPLAIN', 'Print / Save PDF']) {
  assert.ok(html.includes(requiredText), `policy tile must include ${requiredText}`);
}
for (const requiredId of ['irPolicy', 'ntePolicy', 'irPreview', 'ntePreview', 'printIrBtn', 'printNteBtn']) {
  assert.ok(html.includes(`id="${requiredId}"`), `policy tile must include ${requiredId}`);
}
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());
const appScript = inlineScripts.at(-1).replace(/\binit\(\);\s*$/, '');
const context = vm.createContext({ window: { VARDA_POLICIES: policies }, innerWidth: 1200, console });
vm.runInContext(appScript, context);

assert.equal(vm.runInContext("findMatches('my staff is sleeping')[0].p.code", context), 'VARDA ACT-001');
assert.equal(vm.runInContext("findMatches('natutulog ang staff habang duty')[0].p.code", context), 'VARDA ACT-001');
assert.equal(vm.runInContext("findMatches('employee is late again')[0].p.code", context), 'VARDA ACT-007');
assert.equal(vm.runInContext("findMatches('walang hairnet habang naghahanda ng food')[0].p.code", context), 'VARDA ACT-011');

console.log('Policy checks passed: 85 complete policies and English/Tagalog incident matching verified.');
