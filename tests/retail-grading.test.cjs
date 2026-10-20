const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('retail-audit-v1.html','utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function scoreData'));
const values=new Map(),ctx={Intl,crypto:require('node:crypto').webcrypto,window:{},document:{querySelector(q){const key=[...q.matchAll(/data-[si]="(\d+)"/g)].map(x=>x[1]).join(':');return values.get(key)}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('retail-audit-fsqa.js','utf8'),ctx);vm.runInContext(script.replace(/init\(\);\s*$/,'')+';globalThis.grading={scoreData,flatItems,setType(t){auditType=t}};',ctx);
for(const type of ['main','kiosk']){
 ctx.grading.setType(type);values.clear();const rows=ctx.grading.flatItems();for(const r of rows)values.set(r.s+':'+r.i,{value:''});
 let score=ctx.grading.scoreData();assert.equal(score.complete,false);assert.equal(score.score,null);
 values.get('0:0').value='compliant';score=ctx.grading.scoreData();assert.equal(score.score,100);assert.equal(score.complete,false);assert.equal(score.answered,1);
 for(const r of rows)values.get(r.s+':'+r.i).value='compliant';
 values.get('0:0').value='action';values.get('0:1').value='noncompliant';values.get('0:2').value='na';
 score=ctx.grading.scoreData();assert.equal(score.complete,true);assert.equal(score.max,(rows.length-1)*2);assert.equal(score.points,(rows.length-3)*2+1);assert.equal(score.score,Math.round(score.points/score.max*100));
 // A failure in an appended FSQA section must affect the overall grade.
 const last=rows.at(-1);values.get(last.s+':'+last.i).value='noncompliant';assert.ok(ctx.grading.scoreData().score<score.score);
 for(const r of rows)values.get(r.s+':'+r.i).value='na';score=ctx.grading.scoreData();assert.equal(score.complete,true);assert.equal(score.score,null);
}
assert.doesNotMatch(html,/dueInput|<th class="due">/);assert.match(html,/Inspection date — applies to every check/);assert.match(html,/PROVISIONAL/);
console.log('PASS: full-checkpoint grading for both templates, provisional blanks, N/A exclusion, appended FSQA influence, all-N/A handling and one inspection date.');

// Loading an older draft must ignore former per-row due dates and keep its shared inspection date.
const fields=new Map();const get=id=>{if(!fields.has(id))fields.set(id,{value:'',readOnly:false,classList:{toggle(){}}});return fields.get(id)};
const rowFields=new Map();const draft={revision_of:'prior-audit',draft_id:'draft-id',fields:{auditDate:'2026-10-20',branch:'Ateneo'},items:[{s:0,i:0,result:'action',remark:'Original finding',owner:'Leader',due:'2026-10-21'}]};
const loadctx={Date,crypto:require('node:crypto').webcrypto,JSON,localStorage:{getItem(){return JSON.stringify(draft)}},auditKey(){return 'draft'},$:get,selector(cls,s,i){if(cls==='riskInput')return null;const key=cls+s+':'+i;if(!rowFields.has(key))rowFields.set(key,{value:''});return rowFields.get(key)},refresh(){},updateAuditPhotoCounts(){}};vm.createContext(loadctx);vm.runInContext(script.slice(script.indexOf('function loadDraft()'),script.indexOf('function updateAuditPhotoCounts()'))+';loadDraft();',loadctx);
assert.equal(get('auditDate').value,'2026-10-20');assert.equal(get('auditDate').readOnly,true);assert.equal(rowFields.get('result0:0').value,'action');assert.equal(rowFields.get('remark0:0').value,'Original finding');
console.log('PASS: legacy audit draft restoration preserves the inspection date and answers after row-date removal.');
