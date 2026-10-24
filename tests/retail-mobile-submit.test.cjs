const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','retail-audit-shared.js'),'utf8');
async function main(){
 let overlay,active,confirmCalls=0;
 const buttons={};for(const key of ['[data-cancel]','[data-confirm]'])buttons[key]={focus(){active=this}};
 const document={get activeElement(){return active},createElement(){return {style:{},querySelector:key=>buttons[key],remove(){overlay=null}}},addEventListener(){},removeEventListener(){},body:{appendChild(el){overlay=el}}};
 const ctx={document,confirm(){confirmCalls++;return false},Promise,esc:v=>v};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function confirmAuditSubmission'),source.indexOf('\nfunction message')),ctx);
 let pending=ctx.confirmAuditSubmission();assert.ok(overlay);buttons['[data-cancel]'].onclick();assert.equal(await pending,false);assert.equal(overlay,null);
 pending=ctx.confirmAuditSubmission();buttons['[data-confirm]'].onclick();assert.equal(await pending,true);assert.equal(confirmCalls,0);
 let requests=[],saved=0,allow=true,fail=false;
 const fields={submitSharedAudit:{},auditDate:{value:'2026-10-24'},auditorName:{value:'Test auditor'},auditorRole:{value:'Auditor'}};
 const payload={draft_id:'draft',items:[{s:0,i:0,result:'compliant'}]};
 const state={byId:id=>fields[id],guarded:async fn=>fn(),scoreData:()=>({answered:1,total:1}),branchName:()=> 'Test branch',flatItems:()=>[{s:0,i:0,label:'Test checkpoint',section:'Operations'}],selector:()=>({value:'compliant'}),saveDraft:()=>saved++,confirmAuditSubmission:async()=>allow,collect:()=>structuredClone(payload),submissionKeys:new Map(),auditType:'main',revisionOf:null,aliases:{},crypto:require('node:crypto').webcrypto,location:{},call:async(action,data)=>{requests.push({action,data});if(fail)throw Error('Connection lost');return {id:'saved-audit'}}};
 vm.createContext(state);const start=source.indexOf(" byId('submitSharedAudit').onclick=");vm.runInContext(source.slice(start,source.indexOf('\n return;',start)),state);
 const submit=()=>fields.submitSharedAudit.onclick({currentTarget:fields.submitSharedAudit});
 allow=false;await submit();assert.equal(requests.length,0);assert.equal(saved,1);
 allow=true;fail=true;await assert.rejects(submit(),/Connection lost/);assert.equal(state.location.href,undefined);
 fail=false;await submit();assert.equal(requests[0].data.submission_key,requests[1].data.submission_key);assert.match(state.location.href,/audit=saved-audit/);assert.equal(requests[1].action,'submit_audit');
 // Timeout must be visible and release the timer, without losing form state.
 let cleared=false;const net={AbortController,setTimeout:fn=>{queueMicrotask(fn);return 1},clearTimeout:()=>cleared=true,endpoint:'mock',auditorSession:null,fetch:async(url,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{const e=new Error();e.name='AbortError';reject(e)}))};vm.createContext(net);vm.runInContext(source.slice(source.indexOf('async function call('),source.indexOf('// Use page controls')),net);await assert.rejects(net.call('submit_audit'),/entries are still here/);assert.ok(cleared);
 console.log('PASS: in-page confirmation works when native confirm is blocked; cancellation preserves draft; failed submission retains retry key; successful retry redirects; timeout explains recovery.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
