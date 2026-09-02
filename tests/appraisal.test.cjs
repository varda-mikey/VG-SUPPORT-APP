const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'appraisal-v1.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((script, i) => new vm.Script(script, { filename: `appraisal-script-${i}` }));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(scripts[0] + '\nthis.model = {CRITERIA,BANDS,calculate,bandFor,moneyResult,routeFor,sixMonths,assessDecision};', ctx);
const { CRITERIA, calculate, bandFor, moneyResult, sixMonths, assessDecision, routeFor } = ctx.model;
assert.equal(CRITERIA.reduce((s, [, w]) => s + w, 0), 100);
const sample = calculate([5,4,4,5,5,4,4,4,5,4]);
assert.equal(sample.total, 87.2);
assert.equal(sample.band.rate, 6);
assert.equal(sample.band.rating, 'Outstanding');
assert.equal(sample.rows[9], 4.8);
assert.equal(sample.rows[1], 12.8);
assert.equal(sample.total / 2, 43.6);
for (const [rating, score, name, rate] of [[1,20,'Unsatisfactory',0],[2,40,'Needs Improvement',0],[3,60,'Meets Expectations',0],[4,80,'Exceeds Expectations',2],[5,100,'Outstanding',10]]) {
  const result = calculate(Array(10).fill(rating));
  assert.equal(result.total, score);
  assert.equal(result.band.rating, name);
  assert.equal(result.band.rate, rate);
}
for (const ratings of [[], Array(10).fill(null), [5,4,4,5,5,4,4,4,5,null], Array(10).fill(0), Array(10).fill(6), Array(10).fill(4.5), Array(10).fill('4'), Array(10).fill(NaN)]) {
  assert.equal(calculate(ratings).total, null);
  assert.equal(calculate(ratings).band, null);
}
for (const [score, rate] of [[20,0],[40,0],[40.2,0],[60,0],[60.2,2],[80,2],[80.2,4],[85,4],[85.2,6],[90,6],[90.2,8],[95,8],[95.2,10],[100,10]]) assert.equal(bandFor(score).rate, rate);
for (const n of [-1,0,19.9,100.1,Infinity,NaN]) assert.equal(bandFor(n), null);
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
// Static integration checks: two print pages, no left-side editor, no remote data persistence.
assert.equal((html.match(/<section class="sheet"/g)||[]).length,2);
assert.match(html,/@page\{size:A4 portrait;margin:0\}/);
assert.match(html,/break-after:page/);
assert.match(html,/function onEdit[\s\S]*clearApproval\(\)/);
assert.doesNotMatch(html,/localStorage|fetch\(|XMLHttpRequest|sendBeacon/);
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.equal((index.match(/<h2>Employee Appraisal<\/h2>/g)||[]).length,1);
assert.match(index,/else if\(key==='appraisal'\) frame.src='appraisal-v1.html\?v=1'/);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length);
console.log('PASS: syntax, weighted scoring, all rating boundaries, incomplete/invalid ratings, salary, eligibility, approval safeguards, and two-page integration.');
