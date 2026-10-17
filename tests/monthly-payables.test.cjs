(async()=>{
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('monthly-payables-v1.js','utf8');new vm.Script(code);
const pre=code.split('let state=')[0]+';this.api={paid,balance,status,cents,dueNext,esc}';const ctx={Intl,Date,crypto:{},sessionStorage:{getItem:()=> 'YES'}};vm.createContext(ctx);vm.runInContext(pre,ctx);const a=ctx.api;
const bill={amount:100000,due:'2026-10-16',payments:[]};assert.equal(a.balance(bill),100000);assert.equal(a.status(bill,'2026-10-15'),'Pending');assert.equal(a.status(bill,'2026-10-17'),'Overdue');bill.payments.push({amount:25000});assert.equal(a.balance(bill),75000);assert.equal(a.status(bill,'2026-10-15'),'Partial');assert.equal(a.status(bill,'2026-10-17'),'Overdue');bill.payments.push({amount:75000});assert.equal(a.status(bill,'2026-10-17'),'Paid');assert.equal(a.balance(bill),0);assert.equal(a.cents('10118.14'),1011814);assert.equal(a.dueNext('2026-12'),'2027-01');assert.equal(a.esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
console.log('PASS: partial/full payments, overdue precedence, cent arithmetic, December rollover, safe text rendering');
const elements=new Map(),listeners={};function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,addEventListener(){},querySelector(){return el('submit')},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)}
let stored;const ui={Intl,Date,crypto:require('node:crypto').webcrypto,sessionStorage:{getItem:()=> 'YES'},localStorage:{getItem:()=>null,setItem:(k,v)=>stored=JSON.parse(v)},document:{getElementById:el,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn},FormData:class{constructor(form){return Object.entries(form.values)}},alert:s=>{throw Error(s)},confirm:()=>true,window:{print(){}},setTimeout};vm.createContext(ui);vm.runInContext(code,ui);
async function submit(values){return el('editForm').onsubmit({preventDefault(){},target:{values}})}
el('addSupplier').onclick();await submit({name:'Test Supplier',contact:'',method:'Bank',account:'Test'});assert.equal(stored.suppliers.length,1);const sid=stored.suppliers[0].id;
el('addBill').onclick();await submit({title:'Monthly invoice',supplier:sid,branch:'Main',type:'Supplier',amount:'1000',due:'2026-10-16',statement:'',recurring:'yes',notes:''});const bid=stored.bills[0].id;
function click(action,id,payment){listeners.click({target:{closest:()=>({dataset:{action,id,payment}})}})}
click('payment',bid);await submit({amount:'250',date:'2026-10-15',ref:'Receipt 1'});assert.equal(stored.bills[0].payments[0].amount,25000);click('payment',bid);await submit({amount:'750',date:'2026-10-16',ref:'Receipt 2'});assert.equal(a.balance(stored.bills[0]),0);
click('undo',bid,stored.bills[0].payments[1].id);assert.equal(a.balance(stored.bills[0]),75000);
el('month').value='2026-10';el('nextMonth').onclick();assert.equal(stored.bills.length,2);assert.equal(stored.bills[1].due,'2026-11-16');assert.equal(stored.bills[1].payments.length,0);el('month').value='2026-10';el('nextMonth').onclick();assert.equal(stored.bills.length,2);
click('delete',bid);assert.equal(stored.bills.length,1);click('delete',stored.bills[0].id);click('deleteSupplier',sid);assert.equal(stored.suppliers.length,0);
console.log('PASS: full UI handlers for supplier/bill CRUD, payment history, reversal, persistence, recurring copy and duplicate prevention');


const extras=vm.runInContext('({validState,validProof,estimatedCredit,cardOutstanding,paymentCapacity,annualGroups,exportOnePage})',ui);
const card={id:'card',supplier:'s',title:'Test credit card',branch:'Test',type:'Credit card',amount:1011814,statement:4591814,creditLimit:4000000,due:'2026-10-05',notes:'',payments:[{id:'p',amount:750000,date:'2026-10-17',ref:'PAY-1',proof:{name:'receipt.pdf',type:'application/pdf',data:'data:application/pdf;base64,JVBERi0='}}],bankAvailable:250000,bankAvailableDate:'2026-10-17'};
assert.equal(extras.estimatedCredit(card),158186);assert.equal(extras.cardOutstanding(card),3841814);assert.equal(a.balance(card),261814);assert(extras.validProof(card.payments[0].proof));assert(!extras.validProof({name:'x',type:'text/html',data:'data:text/html;base64,AAAA'}));
const fixture={version:1,suppliers:[{id:'s',name:'Test lender',account:'TEST ONLY'}],bills:[card,{...card,id:'v',title:'Vehicle',type:'Vehicle',due:'2026-11-16',amount:2460600,statement:0,payments:[]}]};assert(extras.validState(fixture));fixture.bills[0].payments[0].proofLink='javascript:alert(1)';assert(!extras.validState(fixture));delete fixture.bills[0].payments[0].proofLink;
vm.runInContext('state='+JSON.stringify(fixture),ui);el('loanYear').value='2026';assert.equal(extras.annualGroups('2026')[0].months[10].length,1);assert.equal(extras.annualGroups('2026')[0].months[9].length,0);
const realPDF=require('../vendor/jspdf-3.0.4.min.js').jsPDF;ui.window.jspdf={jsPDF:class extends realPDF{constructor(options){super(options);this.save=()=>{}}}};el('scope').value='all';el('search').value='';el('filter').value='';const pdf=extras.exportOnePage();assert.equal(pdf.getNumberOfPages(),1);fs.writeFileSync('/tmp/vg-payables-qa.pdf',Buffer.from(pdf.output('arraybuffer')));
console.log('PASS: payment proof validation/backup compatibility, credit balance/available distinction, annual month placement and single-page PDF');

})().catch(e=>{console.error(e);process.exitCode=1});
