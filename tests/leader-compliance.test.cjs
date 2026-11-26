const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('leader-daily-checklist.html','utf8');
const ui=fs.readFileSync('leader-compliance-v1.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261126090000_leader_compliance_workflow.sql','utf8');
const gateway=fs.readFileSync('supabase/functions/leader-compliance-gateway/index.ts','utf8');
test('checklist loads the simple letter panel without changing personal-link route',()=>{assert.match(html,/leader-compliance-v1\.js/);assert.match(ui,/URLSearchParams\(location\.hash/);assert.match(ui,/Issue Letter by Leader/)});
test('workflow supports NTE, non-NTE, PDF and digital signatures',()=>{for(const word of ['nte','non_nte','application/pdf','leader_signature','head_signature'])assert.ok((sql+gateway).includes(word),word);assert.match(gateway,/leader must submit the NTE first/)});
test('new data is additive, private and service-gateway controlled',()=>{assert.doesNotMatch(sql,/drop table|truncate|delete from/i);assert.match(sql,/enable row level security/);assert.match(sql,/revoke all.*anon, authenticated/);assert.match(sql,/public=false/)});
test('simple NTE flow uses inline controls, date ranges and violet day labels',()=>{assert.match(ui,/YES — ISSUE LETTER FOR SELECTED DATES/);assert.match(ui,/NTE SUBMITTED/);assert.match(ui,/NTE PENDING/);assert.match(ui,/ntePendingDay/);assert.match(ui,/type="date"/);assert.doesNotMatch(ui,/pendingBackdrop|confirm\('OK = Require NTE/)});

