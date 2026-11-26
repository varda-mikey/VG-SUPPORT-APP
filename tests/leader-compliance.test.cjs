const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('leader-daily-checklist.html','utf8');
const ui=fs.readFileSync('leader-compliance-v1.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261126090000_leader_compliance_workflow.sql','utf8');
const gateway=fs.readFileSync('supabase/functions/leader-compliance-gateway/index.ts','utf8');
test('checklist loads compliance inbox without changing personal-link route',()=>{assert.match(html,/leader-compliance-v1\.js/);assert.match(ui,/URLSearchParams\(location\.hash/);assert.match(ui,/Head.*Compliance Inbox/)});
test('workflow supports NTE, non-NTE, attendance, PDF and signatures',()=>{for(const word of ['nte','non_nte','day_off','absent','on_leave','application/pdf','leader_signature','head_signature'])assert.ok((sql+gateway).includes(word),word);assert.match(gateway,/NTE requires a signed leader response/)});
test('new data is additive, private and service-gateway controlled',()=>{assert.doesNotMatch(sql,/drop table|truncate|delete from/i);assert.match(sql,/enable row level security/);assert.match(sql,/revoke all.*anon, authenticated/);assert.match(sql,/public=false/)});

