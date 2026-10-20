const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('retail-audit-v1.html','utf8'),script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('const AUDITS='));
const c={window:{},Intl,crypto:require('node:crypto').webcrypto};vm.createContext(c);vm.runInContext(fs.readFileSync('retail-audit-fsqa.js','utf8'),c);vm.runInContext(script.replace(/init\(\);\s*$/,'')+';globalThis.models=AUDITS;',c);
const coverage=JSON.parse(fs.readFileSync('retail-audit-coverage.json','utf8'));
assert.equal(coverage.coverage.filter(x=>x.code!=='SUMMARY-FLOW').length,41);
for(const [type,originalSectionCount,originalTotal,expected] of [['main',6,45,68],['kiosk',5,30,54]]){
 const model=c.models[type],all=model.sections.flatMap((s,si)=>s.items.map((i,ii)=>({s:si,i:ii,label:i[0],section:s.name,meta:i[2]})));
 assert.equal(model.sections.slice(0,originalSectionCount).flatMap(s=>s.items).length,originalTotal);
 assert.equal(all.length,expected);assert.equal(new Set(all.map(x=>x.label)).size,expected,'Duplicate checkpoint label');
 for(const clause of coverage.coverage){assert.ok(clause.source_refs.length>0);for(const key of clause[type]){let [s,i]=key.split(':');s=/^[A-D]$/.test(s)?originalSectionCount+s.charCodeAt(0)-65:Number(s);const item=model.sections[s]?.items[Number(i)];assert.ok(item,'Missing coverage '+clause.code);assert.ok(item[2].clauses.includes(clause.code));for(const check of clause.checks)assert.ok(item[2].guidance.includes(check));}}
}
const payloads={};for(const type of ['main','kiosk'])payloads[type]={template_version:coverage.version,fields:{auditorName:'QA Auditor',auditorRole:'FSQA Officer',auditDate:'2026-10-20'},items:c.models[type].sections.flatMap((s,si)=>s.items.map((i,ii)=>({s:si,i:ii,label:i[0],section:s.name,fsqa:!!i[2]?.fsqa,result:'compliant',risk_level:null,evidence:[]})))};
fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/expanded-test-payloads.json',JSON.stringify(payloads));
assert.match(html,/riskInput/);assert.match(html,/Photo evidence/);assert.match(html,/Inspection guide/);
console.log('PASS: 41 source clauses plus summary flow concern mapped for both audit types; original 45/30 retained; 68/54 unique checkpoints, risk fields and photo evidence.');
