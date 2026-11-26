const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'leader-daily-checklist.html'),'utf8');
const gateway=fs.readFileSync(path.join(root,'supabase','functions','leader-checklist-gateway','index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20261126083000_attendance_stamps.sql'),'utf8');

test('calendar supports Head context menu and mobile long press',()=>{
 assert.match(html,/oncontextmenu=/);
 assert.match(html,/pointerType!=='touch'/);
 assert.match(html,/setTimeout\(\(\)=>.*openAttendanceMenu/s);
 assert.match(html,/\['absent','🔴 Absent'\]/);
 assert.match(html,/\['rest_day','🔵 Rest Day'\]/);
 assert.match(html,/\['awol','🟥 AWOL'\]/);
 assert.match(html,/\['on_leave','🟣 On Leave'\]/);
 assert.match(html,/\['removed','✕ Remove stamp'\]/);
});

test('attendance writes are Head-only and report reads include stamps',()=>{
 assert.match(gateway,/if\(action==='attendance_stamp'\)/);
 assert.match(gateway,/if\(!head\)return reply\(\{error:'Head only'\},403\)/);
 assert.match(gateway,/attendance_stamps/);
 assert.match(gateway,/\['rest_day','on_leave'\]\.includes\(stamp\.status\).*expected_task_counts/s);
});

test('database retains current removal state and append-only audit history',()=>{
 assert.match(migration,/status in \('absent','rest_day','awol','on_leave','removed'\)/);
 assert.match(migration,/after insert or update/);
 assert.match(migration,/vg_checklist_attendance_stamp_audit/);
 assert.match(migration,/enable row level security/);
 assert.match(migration,/revoke all .* from anon, authenticated/);
});

test('reports and evidence are never deleted by stamping',()=>{
 const block=gateway.match(/if\(action==='attendance_stamp'\)[\s\S]*?\n  \}/)?.[0]||'';
 assert.doesNotMatch(block,/vg_checklist_entries.*delete|vg_checklist_files.*delete|storage.*remove/);
 assert.match(html,/Reports and evidence were preserved/);
});

