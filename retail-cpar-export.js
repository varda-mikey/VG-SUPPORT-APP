'use strict';
(()=>{
const clean=v=>String(v??'').replace(/₱/g,'PHP ').replace(/[–—→]/g,' - ').replace(/[’‘]/g,"'").replace(/[“”]/g,'"').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e\n]/g,'');
const label=s=>({action:'Needs action',noncompliant:'Non-compliant',compliant:'Compliant',na:'N/A',update:'Progress update',submitted:'CPAR submission',acknowledged:'Acknowledged',returned:'Needs additional action',verified:'Approved action / evidence',risk_assessed:'FSQA risk assessed'})[s]||clean(s);
const when=d=>d?new Date(d).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'Not recorded';
async function build(a,loadProof,auditOnly=false){
 const closure=a.final_approval;
 if(!auditOnly&&!closure?.snapshot)throw Error('The auditor must stamp final approval before saving or printing the closed CPAR.');
 if(!window.jspdf?.jsPDF||!window.PDFLib)throw Error('The PDF tools are still loading. Please refresh and try again.');
 const original=auditOnly?a:closure.snapshot.original_audit,items=auditOnly?[]:closure.snapshot.cpar||[],p=original.payload;
 const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});let y=22;const margin=16,width=178,bottom=277,pdfProofs=[],assets=new Map();
 const heading=()=>{doc.setFillColor(116,20,38);doc.rect(0,0,210,12,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(auditOnly?'VARDA GROUP | RETAIL AUDIT REPORT':'VARDA GROUP | RETAIL AUDIT & CLOSED CPAR',margin,8);doc.setTextColor(38,49,62)};
 heading();
 function page(){const font=doc.getFont(),size=doc.getFontSize(),color=doc.getTextColor();doc.addPage();heading();doc.setFont(font.fontName,font.fontStyle);doc.setFontSize(size);doc.setTextColor(color);y=22}
 function room(height){if(y+height>bottom)page()}
 function text(value,{size=9,bold=false,color=[38,49,62],space=3,indent=0}={}){doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(clean(value)||'-',width-indent);for(const line of lines){room(size*.4+1);doc.text(line,margin+indent,y);y+=size*.4+1}y+=space;doc.setTextColor(38,49,62)}
 function section(title){room(23);y+=4;text(title,{size:12,bold:true,color:[116,20,38],space:3});doc.setDrawColor(222,226,232);doc.line(margin,y-1,194,y-1);y+=4}
 function entry(title,value){text(title+': '+(value||'-'),{size:9,space:1})}
 text(auditOnly?'SUBMITTED AUDIT REPORT':'FINAL AUDIT & CPAR REPORT',{size:19,bold:true});text(original.branch,{size:13,bold:true});entry('Audit date',original.audit_date);entry('Original auditor',original.auditor);entry('Audit reference',p.fields.auditRef||original.id);entry('Original audit score',original.score==null?'No percentage grade':original.score+'%');
 if(auditOnly){entry('Report status',a.coverage?.complete===false?'PROVISIONAL - incomplete expanded audit':'Submitted audit');if(a.payload.revision_of)entry('Revision of',a.payload.revision_of);if(a.payload.edited_by)entry('Revised by',a.payload.edited_by+' | '+when(a.payload.edited_at));text('This is the submitted inspection report. CPAR approval is recorded separately.',{size:9});}
 if(!auditOnly){
 room(35);doc.setFillColor(236,247,240);doc.setDrawColor(62,127,85);doc.roundedRect(margin,y,width,29,2,2,'FD');y+=8;text('APPROVED & CLOSED',{size:15,bold:true,color:[36,103,65],indent:5,space:1});text('Approved by '+closure.auditor_name+' | '+when(closure.approved_at),{size:9,indent:5});y+=4;
 entry('Final auditor comments',closure.comments);
 const submitted=items.flatMap(c=>c.updates||[]).filter(u=>u.kind==='submitted');
 section('SUMMARY');entry('Corrective actions',items.length+' identified | '+items.filter(c=>c.status==='verified').length+' approved');entry('CPAR submissions',submitted.length);text('This report preserves the original audit, all recorded corrective action updates, supporting proof and final auditor approval. The original score is not changed by CPAR closure.',{size:9});
 }
 section(auditOnly?'AUDIT DETAILS':'1. ORIGINAL AUDIT');
 const infoLabels={branchHead:'Branch leader',reportMonth:'Sales reporting month',monthSales:'Monthly sales (PHP)',operatingDays:'Operating days',dailyTarget:'Daily sales target (PHP)',productionValue:'Food / product available value (PHP)',leftoverValue:'Leftover value (PHP)',foodCostPercent:'Food cost %',inventoryVariance:'Inventory variance (PHP)',strengths:'Good practices',priorityActions:'Priority corrective actions',executiveSummary:'Auditor summary',branchResponse:'Branch leader response',followUpDate:'Follow-up audit date',finalRecommendation:'Recommendation'};
 for(const [key,title] of Object.entries(infoLabels))if(p.fields[key])entry(title,p.fields[key]);
 if(auditOnly){const counts={};for(const check of p.items)counts[check.result]=(counts[check.result]||0)+1;entry('Check results',(counts.compliant||0)+' compliant | '+(counts.action||0)+' needs action | '+(counts.noncompliant||0)+' non-compliant | '+(counts.na||0)+' N/A');const f=p.fields;if(Number(f.operatingDays)>0)entry('Daily sales average (PHP)',(Number(f.monthSales||0)/Number(f.operatingDays)).toFixed(2));if(Number(f.productionValue)>0)entry('Leftover %',(Number(f.leftoverValue||0)/Number(f.productionValue)*100).toFixed(1)+'%');}

 section('ORIGINAL AUDIT CHECKLIST');
 let auditSection='';
 for(let i=0;i<p.items.length;i++){const check=p.items[i];if(check.section&&check.section!==auditSection){auditSection=check.section;section(auditSection)}room(20);text((i+1)+'. '+check.label+' ['+label(check.result)+']',{bold:true,space:1});if(check.source_clauses?.length)entry('Source clauses',check.source_clauses.join(', '));if(check.risk_level)entry('FSQA risk level',check.risk_level.toUpperCase());if(check.remark)text('Finding / remarks: '+check.remark,{size:8,space:1,indent:4});if(check.owner||check.due)text('Responsible: '+(check.owner||'-')+' | Target: '+(check.due||'-'),{size:8,space:3,indent:4});for(let j=0;j<(check.evidence||[]).length;j++){const f=check.evidence[j],ref='Original audit checkpoint '+(i+1)+' / Proof '+(j+1);text('Original auditor proof: '+f.name,{size:8,space:1,indent:3});if(!assets.has(f.path)){const asset=await loadProof(original.id,{...f,original:true});if(!asset?.bytes?.byteLength)throw Error('Unable to load original audit proof: '+f.name);assets.set(f.path,{...asset,file:f,ref,actor:original.auditor,coverage:original.audit_date});}}}
 if(!auditOnly){
 section('2. CPAR SUBMISSIONS & AUDITOR DECISIONS');
 for(let i=0;i<items.length;i++){const c=items[i];room(25);text((i+1)+'. '+c.finding.label,{size:11,bold:true});entry('Original finding',c.finding.remark||label(c.finding.result));entry('Final action status',label(c.status));if(c.finding.fsqa||/FOOD SAFETY|FSQA/i.test(c.finding.section||''))entry('FSQA risk level',(c.risk_level||c.finding.risk_level||'Not assessed').toUpperCase());
  for(const u of c.updates||[]){room(19);text(label(u.kind)+' | '+u.actor+' | '+when(u.created_at),{size:9,bold:true,space:1});if(u.solution)entry('Solution',u.solution);if(u.coverage_start)entry('Date coverage',u.coverage_start+' to '+u.coverage_end+' | Target: '+(u.due_date||'-'));if(u.remarks)entry('Comments / remarks',u.remarks);
   for(let j=0;j<(u.evidence||[]).length;j++){const f=u.evidence[j],ref='Action '+(i+1)+' / '+label(u.kind)+' / Proof '+(j+1);text('Proof: '+f.name+' ['+ref+']',{size:8,space:1,indent:3});if(!assets.has(f.path)){const asset=await loadProof(c.id,f);if(!asset?.bytes?.byteLength)throw Error('Unable to load proof: '+f.name);assets.set(f.path,{...asset,file:f,ref,actor:u.actor,coverage:u.coverage_start+' to '+u.coverage_end});}}
   y+=3;
  }
 }
 section('3. FINAL AUDITOR APPROVAL');entry('Final status','APPROVED & CLOSED');entry('Approved by',closure.auditor_name);entry('Approval date / time',when(closure.approved_at));entry('Final comments',closure.comments);text('All corrective actions in this closure record were approved before the final CPAR stamp was issued.',{size:9});
 }
 if(assets.size)section('SUPPORTING PROOF INDEX');let proofNo=0;
 for(const [path,asset] of assets){proofNo++;entry('Evidence '+proofNo,asset.file.name+' | '+asset.ref);asset.number=proofNo;if(asset.mime==='application/pdf'||/\.pdf$/i.test(path))pdfProofs.push(asset);}
 for(const asset of assets.values()){
  if(pdfProofs.includes(asset))continue;
  page();text('SUPPORTING PROOF '+asset.number,{size:13,bold:true});entry('File',asset.file.name);entry('Reference',asset.ref);entry('Submitted by',asset.actor);entry('Coverage',asset.coverage);
  let bytes=asset.bytes,format=asset.mime==='image/png'?'PNG':'JPEG';
  if(asset.mime==='image/webp'){bytes=await webpToPng(bytes);format='PNG';}
  try{const props=doc.getImageProperties(bytes),maxW=178,maxH=bottom-y-8,ratio=Math.min(maxW/props.width,maxH/props.height),w=props.width*ratio,h=props.height*ratio;doc.addImage(bytes,format,margin+(maxW-w)/2,y,w,h,undefined,'FAST');y+=h+5;}catch(e){throw Error('This proof could not be added to the PDF: '+asset.file.name);}
 }
 const reportPages=doc.getNumberOfPages();
 for(let i=1;i<=reportPages;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(110);doc.text(clean(original.branch)+(auditOnly?' | Audit report | Report page ':' | Closed CPAR | Report page ')+i+' of '+reportPages,margin,289);}
 let bytes=new Uint8Array(doc.output('arraybuffer'));
 if(pdfProofs.length){const {PDFDocument,StandardFonts,rgb}=window.PDFLib,merged=await PDFDocument.load(bytes),font=await merged.embedFont(StandardFonts.Helvetica);for(const asset of pdfProofs){let proof;try{proof=await PDFDocument.load(asset.bytes)}catch(e){throw Error('Unable to include PDF proof '+asset.file.name+'. Check whether the original PDF is password-protected or damaged.');}const cover=merged.addPage([595.28,841.89]);cover.drawText('SUPPORTING PDF PROOF '+asset.number,{x:45,y:780,size:15,font,color:rgb(.45,.08,.15)});const lines=[asset.file.name,asset.ref,'Submitted by: '+asset.actor,'Coverage: '+asset.coverage,'The following '+proof.getPageCount()+' page(s) are the submitted PDF proof.'];let ty=740;for(const line of lines){const wrapped=clean(line).match(/.{1,82}/g)||['-'];for(const text of wrapped){cover.drawText(text,{x:45,y:ty,size:10,font});ty-=17}ty-=8}for(const copied of await merged.copyPages(proof,proof.getPageIndices()))merged.addPage(copied);}bytes=await merged.save();}
 const filename=(auditOnly?'VARDA-Audit-Report-':'VARDA-Closed-CPAR-')+clean(original.branch).replace(/[^A-Za-z0-9]+/g,'-')+'-'+original.audit_date+'.pdf';return {bytes,filename};
}
async function webpToPng(bytes){const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png')}finally{URL.revokeObjectURL(url)}}
async function save(a,loader,auditOnly=false){const out=await build(a,loader,auditOnly),url=URL.createObjectURL(new Blob([out.bytes],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=out.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function print(a,loader){const target=window.open('','_blank');if(!target)throw Error('Please allow the report window to open, then click Print again.');target.document.title='Preparing closed CPAR';target.document.body.textContent='Preparing the full closed CPAR report and proof…';try{const out=await build(a,loader),url=URL.createObjectURL(new Blob([out.bytes],{type:'application/pdf'}));target.addEventListener('load',()=>{try{target.focus();target.print()}catch(e){}},{once:true});target.location.href=url;setTimeout(()=>URL.revokeObjectURL(url),600000)}catch(e){target.close();throw e}}
window.VardaCparExport={build,save,print,buildAudit:(a,loader)=>build(a,loader,true),saveAudit:(a,loader)=>save(a,loader,true)};
})();
