const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'appraisal-v1.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((script, i) => new vm.Script(script, { filename: `appraisal-script-${i}` }));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(scripts[0] + '\nthis.model = {CRITERIA,POSITION_TEMPLATES,JOB_SUMMARIES,BANDS,calculate,bandFor,balanceWeights,moneyResult,routeFor,sixMonths,assessDecision};', ctx);
const { CRITERIA, POSITION_TEMPLATES, JOB_SUMMARIES, calculate, bandFor, balanceWeights, moneyResult, sixMonths, assessDecision, routeFor } = ctx.model;
assert.equal(CRITERIA.reduce((s, [, w]) => s + w, 0), 100);
assert.equal(Object.keys(POSITION_TEMPLATES).length,19);
for (const [position, weights] of Object.entries(POSITION_TEMPLATES)) {
  assert.equal(weights.length,10,position);
  assert.equal(weights.reduce((sum, weight) => sum + weight,0),100,position);
}
assert.deepEqual(Object.keys(JOB_SUMMARIES),Object.keys(POSITION_TEMPLATES));
for (const [position, summary] of Object.entries(JOB_SUMMARIES)) {
  assert.equal(summary.length,3,position);
  assert.ok(summary.every(item=>typeof item==='string'&&item.length>20),position);
}
assert.equal(POSITION_TEMPLATES['NATIONAL RETAIL HEAD'][0],5);
assert.equal(POSITION_TEMPLATES['FRONT LEADER'][0],10);
const sample = calculate([5,4,4,5,5,4,4,4,5,4]);
assert.equal(sample.total, 87.2);
assert.equal(sample.band.rate, 6);
assert.equal(sample.band.rating, 'Very Good');
assert.equal(sample.rows[9], 4.8);
assert.equal(sample.rows[1], 12.8);
assert.equal(sample.total / 2, 43.6);
for (const [rating, score, name, rate] of [[1,20,'Unsatisfactory',0],[2,40,'Unsatisfactory',0],[3,60,'Unsatisfactory',0],[4,80,'Satisfactory',2],[5,100,'Outstanding',10]]) {
  const result = calculate(Array(10).fill(rating));
  assert.equal(result.total, score);
  assert.equal(result.band.rating, name);
  assert.equal(result.band.rate, rate);
}
for (const ratings of [[], Array(10).fill(null), [5,4,4,5,5,4,4,4,5,null], Array(10).fill(0), Array(10).fill(6), Array(10).fill(4.5), Array(10).fill('4'), Array(10).fill(NaN)]) {
  assert.equal(calculate(ratings).total, null);
  assert.equal(calculate(ratings).band, null);
}
for (const [score, name, rate] of [[0,'Unsatisfactory',0],[69.9,'Unsatisfactory',0],[70,'Needs Improvement',0],[74.9,'Needs Improvement',0],[75,'Satisfactory',2],[80.9,'Satisfactory',2],[81,'Good',4],[85.9,'Good',4],[86,'Very Good',6],[90.9,'Very Good',6],[91,'Excellent',8],[95.9,'Excellent',8],[96,'Outstanding',10],[100,'Outstanding',10]]) {
  assert.equal(bandFor(score).rating,name);
  assert.equal(bandFor(score).rate,rate);
}
for (const n of [-1,100.1,Infinity,NaN]) assert.equal(bandFor(n), null);
for (let fixedIndex=0;fixedIndex<10;fixedIndex++) {
  for (const value of [0,5,37,100]) {
    const balanced=balanceWeights(CRITERIA.map(([,weight])=>weight),fixedIndex,value);
    assert.equal(balanced.reduce((sum,weight)=>sum+weight,0),100);
    assert.equal(balanced[fixedIndex],value);
    assert.ok(balanced.every(Number.isInteger));
  }
}
for (let i=0;i<10;i++) {
  const ratings=Array(10).fill(3); ratings[i]=4;
  assert.ok(Math.abs(calculate(ratings).total-60-CRITERIA[i][1]/5)<1e-9);
}
assert.equal(moneyResult(20000,6).increase,1200);
assert.equal(moneyResult(20000,6).newSalary,21200);
assert.equal(moneyResult(20000,13).newSalary,22600);
for (const amount of [null,0,-1,NaN,100000001]) assert.equal(moneyResult(amount,6),null);
assert.equal(sixMonths('2025-01-05','2026-09-02'),true);
assert.equal(sixMonths('2026-03-02','2026-09-01'),false);
assert.equal(sixMonths('2026-03-02','2026-09-02'),true);
assert.equal(sixMonths('2024-08-31','2025-02-28'),true);
assert.equal(sixMonths('','2026-09-02'),null);
assert.equal(sixMonths('2026-09-03','2026-09-02'),null);
const data={decision:'approved',reason:'',merit:6,extra:0,eligible:true,approver:'Authorized sample',effective:'2026-10-01',ceoApprover:'',ceoReason:'',salary:20000};
assert.equal(assessDecision(data,sample).ready,true);
assert.equal(assessDecision(data,sample).newSalary,21200);
assert.equal(assessDecision({...data,extra:3,ceoApprover:'CEO sample',ceoReason:'Documented improvement'},sample).newSalary,21800);
for(const edit of [{decision:'pending'},{eligible:false},{merit:null},{merit:-1},{merit:11},{extra:4},{extra:1},{approver:''},{effective:''},{merit:8},{salary:null}]) assert.equal(assessDecision({...data,...edit},sample).ready,false);
assert.equal(assessDecision({...data,merit:8,reason:'Documented authorized adjustment'},sample).ready,true);
assert.equal(routeFor(6),'Business Unit Head + COO');
assert.equal(routeFor(8),'COO + President');
assert.equal(routeFor(10),'President & Founder');
// Static integration checks: three print pages, evidence fields, and shared Supabase profiles.
assert.equal((html.match(/<section class="sheet"/g)||[]).length,3);
assert.match(html,/@page\{size:A4 portrait;margin:0\}/);
assert.match(html,/break-after:page/);
assert.match(html,/function onEdit[\s\S]*clearApproval\(\)/);
assert.match(html,/https:\/\/lwjeroszacnqibggxair\.supabase\.co/);
assert.match(html,/sb_publishable_/);
assert.doesNotMatch(html,/service_role|sb_secret_/);
assert.match(html,/save_appraisal_weight_profile/);
assert.match(html,/loadSharedProfiles/);
assert.match(html,/Executive final grade/);
assert.match(html,/Save as shared live default/);
assert.match(html,/SYNCED LIVE — SAVED/);
assert.match(html,/EDITED — NOT YET SAVED LIVE/);
assert.match(html,/LIVE PROFILES READY/);
assert.match(html,/id="positiveImpact"/);
assert.match(html,/id="negativeImpact"/);
assert.match(html,/criteriaRowsA/);
assert.match(html,/criteriaRowsB/);
assert.match(html,/Array\.from\(\{length:10\}/);
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.equal((index.match(/<h2>Employee Appraisal<\/h2>/g)||[]).length,1);
assert.match(index,/else if\(key==='appraisal'\) frame.src='appraisal-v1.html\?v=4'/);
const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260906143000_appraisal_shared_weight_profiles.sql'),'utf8');
assert.match(migration,/enable row level security/i);
assert.match(migration,/grant select[\s\S]*to anon, authenticated/i);
assert.match(migration,/revoke all[\s\S]*save_appraisal_weight_profile/i);
assert.match(migration,/extensions\.digest/);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length);
console.log('PASS: syntax, shared Supabase position profiles, RLS safeguards, job summaries, 100% auto-balance, weighted scoring, evidence remarks, salary safeguards, and three-page integration.');
