const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('retail-audit-shared.js','utf8');
(async()=>{
 let calls=0,dialogs=0,removed=0;
 const ctx={selected:{id:'audit-id'},auditorSession:{token:'valid'},location:{},call:async action=>{calls++;assert.equal(action,'review_access')},sessionStorage:{removeItem(){removed++}},byId:id=>id==='loginError'?{}:{showModal(){dialogs++}}};vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('async function startAuditEdit()'),s.indexOf("root.addEventListener('click'")),ctx);
 await ctx.startAuditEdit();assert.match(ctx.location.href,/v=11&revise=audit-id/);assert.equal(dialogs,0);
 ctx.location={};ctx.call=async()=>{throw Error('Login required')};await ctx.startAuditEdit();assert.equal(dialogs,1);assert.equal(ctx.editAfterLogin,'audit-id');assert.equal(ctx.auditorSession,null);assert.equal(removed,1);assert.equal(ctx.location.href,undefined);
 ctx.selected.final_approval={};await assert.rejects(ctx.startAuditEdit(),/locked/);delete ctx.selected.final_approval;ctx.selected.coverage={revised_by:'newer'};await assert.rejects(ctx.startAuditEdit(),/latest revised/);
 assert.match(s,/data-go="saveAuditPdf"/);assert.match(s,/saveReview\(selected,loadReportProof\)/);assert.match(s,/if\(revisionOf\)await call\('review_access'\)/);assert.match(s,/byId\('branch'\)\.disabled=true/);
 console.log('PASS: audit PDF button independent of CPAR approval, valid auditor edit route, login gate, locked and superseded edit rejection, and revision submission reauthorization.');
})().catch(e=>{console.error(e);process.exitCode=1});
