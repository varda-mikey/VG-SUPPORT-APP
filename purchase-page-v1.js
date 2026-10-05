'use strict';
// One canvas is the source of the on-screen preview, JPEG, PDF and printed page.
let pagePreviewSequence=0;
const pageImage=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Unable to load the form image'));img.src=src});
function safeSignature(value){return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value||'')?value:''}
async function renderPRCanvas(){
 totals();const data=serialize(),f=data.fields,record=prSelected;const automatic=f.poMode==='automatic';
 const W=automatic?1414:1000,H=automatic?1000:1414,ratio=2480/1000;
 const canvas=document.createElement('canvas');canvas.width=Math.round(W*ratio);canvas.height=Math.round(H*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
 const wine='#7b182b',red='#b71320';
 const source=await pageImage('purchase-form-reference.jpg');
 const requestSign=safeSignature(f.preparedSignatureImage)?await pageImage(f.preparedSignatureImage):null;
 const approvalSign=record?.status==='approved'&&safeSignature(record.signature_data)?await pageImage(record.signature_data):null;
 const cols=automatic?autoColumns:manualColumns;
 const weights=automatic?[5,20,6,8,7,10,9,8,8,11,10,16,10,12]:[5,26,8,10,12,12,21,13,15];
 const widths=weights.map(w=>w/weights.reduce((a,b)=>a+b,0)*(W-56));
 const rows=data.rows.length?data.rows:[{}];
 function layout(scale,paint=false){let y=22;const font=(size,bold=false)=>{ctx.font=(bold?'700 ':'400 ')+(size*scale)+'px Arial';};
 const lines=(value,width,size,bold=false)=>{font(size,bold);const all=[];for(const paragraph of String(value??'').replace(/₱/g,'PHP').split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(ctx.measureText(line+(line?' ':'')+word).width<=width){line+=(line?' ':'')+word;continue}if(line){all.push(line);line=''}let piece='';for(const ch of word){if(piece&&ctx.measureText(piece+ch).width>width){all.push(piece);piece=''}piece+=ch}line=piece;}all.push(line)}return all};
 const text=(value,x,top,width,size=13,bold=false,color='#21171a',align='left')=>{const arr=lines(value,width,size,bold);if(paint){font(size,bold);ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='top';arr.forEach((s,i)=>ctx.fillText(s,align==='center'?x+width/2:align==='right'?x+width:x,top+i*size*1.25*scale));ctx.textAlign='left'}return arr.length*size*1.25*scale};
 const rect=(x,top,w,h,fill,stroke)=>{if(!paint)return;if(fill){ctx.fillStyle=fill;ctx.fillRect(x,top,w,h)}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.strokeRect(x,top,w,h)}};
 const bar=title=>{const h=25*scale;rect(28,y,W-56,h,wine);text(title,38,y+5*scale,W-76,13,true,'white');y+=h+6*scale};
 const imageFit=(img,x,top,width,height)=>{if(!paint||!img)return;const k=Math.min(width/img.width,height/img.height);ctx.drawImage(img,x+(width-img.width*k)/2,top+(height-img.height*k)/2,img.width*k,img.height*k)};
 if(paint){ctx.fillStyle='white';ctx.fillRect(0,0,W,H)}
 const logoH=(automatic?70:92)*scale;if(paint)ctx.drawImage(source,350,6,400,122,W/2-logoH*1.64,y,logoH*3.28,logoH);y+=logoH+8*scale;
 y+=text('PURCHASE REQUEST FORM',28,y,W-56,automatic?25:29,true,wine,'center')+3*scale;
 y+=text((automatic?'PO AUTOMATIC':'MANUAL PO')+'  •  '+(record?.status?record.status.toUpperCase():'DRAFT'),28,y,W-56,11,true,wine,'center')+12*scale;
 const branch=prOptions.find(b=>b[0]===f.campus)?.[1]||f.campus||'________________';const cw=(W-76)/2;
 for(const pair of [[['PR No.',f.pr||'Assigned on submission'],['Requested Purchase Date',f.purchaseDate]],[['Date',f.date],['Preferred Supplier',f.supplier]],[['Business Unit / Campus',branch],['Department / Area',f.department]]]){const hs=pair.map(([label,v],i)=>text(label+': '+(v||'________________'),28+i*(cw+20),y,cw,12));y+=Math.max(...hs)+7*scale}
 if(automatic)y+=text('Daily PAR × Days Covered − Stock on Hand (minimum 0), plus buffer on the shortage. Final Order Qty is editable.',28,y,W-56,10,false,'#65535a')+8*scale;
 else y+=text('PAR Period: '+({day:'Per Day',week:'Per Week'}[f.parPeriod]||'Not specified'),28,y,W-56,11)+7*scale;
 bar('INVENTORY-BASED PURCHASE REQUEST');
 const headers=['#',...cols.map(k=>columnLabels[k])];const cellFont=automatic?10:12;
 const headerH=Math.max(...headers.map((s,i)=>lines(s,widths[i]-10,cellFont,true).length))*cellFont*1.25*scale+14*scale;
 let x=28;headers.forEach((h,i)=>{rect(x,y,widths[i],headerH,'#eeeaec','#9b8f93');text(h,x+5,y+6*scale,widths[i]-10,cellFont,true);x+=widths[i]});y+=headerH;
 rows.forEach((row,n)=>{const vals=[String(n+1),...cols.map(k=>['unitPrice','amount'].includes(k)&&row[k]!==''&&row[k]!=null?Number(row[k]).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):row[k]??'')];const rh=Math.max((automatic?25:33)*scale,Math.max(...vals.map((v,i)=>lines(v,widths[i]-10,cellFont).length))*cellFont*1.25*scale+12*scale);let xx=28;vals.forEach((v,i)=>{rect(xx,y,widths[i],rh,n%2?'#fcfafb':'#fff','#b8adb1');text(v,xx+5,y+5*scale,widths[i]-10,cellFont,false,'#21171a',i>=vals.length-2?'right':'left');xx+=widths[i]});y+=rh});
 y+=8*scale;y+=text('TOTAL AMOUNT: '+$('total').value,28,y,W-56,17,true,wine,'right')+10*scale;
 bar('JUSTIFICATION / REMARKS');y+=text(f.justification||'________________________________________________________________________________',38,y,W-76,12)+10*scale;
 const blocks=[...document.querySelectorAll('#request > .section')];const basis=blocks.find(s=>s.querySelector('h2')?.textContent.includes('PURCHASE BASIS'));const workflow=blocks.find(s=>s.querySelector('h2')?.textContent.includes('WORKFLOW'));
 const half=(W-70)/2;const footTop=y;
 for(const [i,title,node]of [[0,'PURCHASE BASIS',basis],[1,'WORKFLOW / CONTROL STEPS',workflow]]){const bx=28+i*(half+14);rect(bx,footTop,half,22*scale,wine);text(title,bx+7,footTop+4*scale,half-14,11,true,'white');let fy=footTop+27*scale;[...node.querySelectorAll('li')].forEach((li,j)=>{fy+=text((j+1)+'. '+li.textContent,bx+7,fy,half-14,9.5)+3*scale});y=Math.max(y,fy+8*scale)}
 const sigTop=y;let sigEnd=y;
 for(const [i,role]of ['prepared','approved'].entries()){const bx=28+i*(half+14);rect(bx,sigTop,half,22*scale,wine);text(role==='prepared'?'PREPARED BY / REQUESTOR':'APPROVED BY',bx+7,sigTop+4*scale,half-14,11,true,'white');let sy=sigTop+28*scale;for(const field of ['Name','Position','Date'])sy+=text(field+': '+(f[role+field]||'________________________'),bx+7,sy,half-14,11)+3*scale;const sig=role==='prepared'?requestSign:approvalSign;const sh=42*scale;if(sig)imageFit(sig,bx+half*.18,sy,half*.64,sh);else text('Signature: '+(f[role+'Signature']||'________________________'),bx+7,sy,half-14,11);sy+=sh+4*scale;sigEnd=Math.max(sigEnd,sy);}
 y=sigEnd+6*scale;
 if(record){const status=record.status;const caption=status==='pending'?'PENDING APPROVAL':status.toUpperCase();const detail=status==='pending'?'Awaiting purchaser review.':'Approver: '+record.approver_name+'  •  '+approvalDate(record);const dh=lines(detail,W-88,11).length*13.75*scale;const nh=record.decision_note?lines(record.decision_note,W-88,10).length*12.5*scale:0;const h=(42*scale)+dh+nh+10*scale;rect(28,y,W-56,h,'#fff9f9',red);if(paint){ctx.strokeStyle=red;ctx.lineWidth=3;ctx.strokeRect(28,y,W-56,h)}text(caption,40,y+6*scale,W-80,25,true,red,'center');text(detail,44,y+37*scale,W-88,11,true,red,'center');if(nh)text(record.decision_note,44,y+37*scale+dh,W-88,10,false,red,'center');y+=h+10*scale;}
 y+=text('NO APPROVED REQUEST = NO PURCHASE',28,y,W-56,12,true,wine,'center')+8*scale;
 return y;
 }
 let low=.005,high=1.6;for(let pass=0;pass<14;pass++){const mid=(low+high)/2;if(layout(mid)<=H-22)low=mid;else high=mid;}const scale=low;
 layout(scale,true);canvas.dataset.fitScale=String(scale);return canvas;
}
async function refreshPagePreview(scroll=false){const sequence=++pagePreviewSequence;$('wholePage').hidden=false;$('pageStatus').textContent='Preparing one-page A4 preview…';try{const canvas=await renderPRCanvas();if(sequence!==pagePreviewSequence)return;const jpeg=canvas.toDataURL('image/jpeg',.94);$('pageImage').src=jpeg;$('pageFullSize').href=jpeg;$('pageStatus').textContent='One A4 page • Same layout for PDF and JPEG'+(Number(canvas.dataset.fitScale)<.6?' • Many items: open full size to inspect.':'');if(scroll)$('wholePage').scrollIntoView({behavior:'smooth',block:'start'})}catch(err){$('pageStatus').textContent='Preview unavailable: '+err.message}}
async function downloadJPEG(){try{const canvas=await renderPRCanvas();const a=document.createElement('a');a.href=canvas.toDataURL('image/jpeg',.95);a.download=($('pr').value||'Purchase-Request-Draft')+'.jpg';a.click();$('status').textContent='One-page JPEG downloaded.'}catch(err){$('status').textContent='JPEG download failed: '+err.message}}
async function onePagePDF(){const canvas=await renderPRCanvas();const doc=new window.jspdf.jsPDF({format:'a4',unit:'mm',orientation:canvas.width>canvas.height?'landscape':'portrait'});doc.addImage(canvas.toDataURL('image/jpeg',.95),'JPEG',0,0,doc.internal.pageSize.getWidth(),doc.internal.pageSize.getHeight());return doc;}
const originalFillRecord=fillRecord;fillRecord=function(r){$('preparedSignatureImage').value='';originalFillRecord(r);showRequestorSignature();$('request').hidden=true;refreshPagePreview(true)};
const originalNewRequest=newRequest;newRequest=function(){originalNewRequest();$('preparedSignatureImage').value='';$('request').hidden=false;$('wholePage').hidden=true;pagePreviewSequence++;showRequestorSignature()};
$('closePreview').onclick=()=>newRequest();
const originalEditRequest=$('editRequest').onclick;$('editRequest').onclick=()=>{$('request').hidden=false;$('wholePage').hidden=true;originalEditRequest()};
function showRequestorSignature(){const value=safeSignature($('preparedSignatureImage').value);$('requestorSignaturePreview').hidden=!value;if(value)$('requestorSignaturePreview').src=value;else $('requestorSignaturePreview').removeAttribute('src');$('requestorSignFile').disabled=!!prSelected;$('clearRequestorSign').disabled=!!prSelected;}
$('requestorSignFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(!['image/png','image/jpeg'].includes(file.type)||file.size>5000000)throw Error('Choose a PNG or JPEG signature under 5 MB.');const url=URL.createObjectURL(file);let img;try{img=await pageImage(url)}finally{URL.revokeObjectURL(url)}const c=document.createElement('canvas');const k=Math.min(1,500/img.width,150/img.height);c.width=Math.max(1,Math.round(img.width*k));c.height=Math.max(1,Math.round(img.height*k));c.getContext('2d').drawImage(img,0,0,c.width,c.height);let result=c.toDataURL('image/png');if(result.length>85000){const ctx=c.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);result=c.toDataURL('image/jpeg',.65)}if(result.length>100000)throw Error('Use a smaller signature image.');$('preparedSignatureImage').value=result;showRequestorSignature();$('status').textContent='Unsaved changes — requestor signature attached. Submit for Approval to save online.';}catch(err){$('status').textContent=err.message}};
$('clearRequestorSign').onclick=()=>{$('preparedSignatureImage').value='';$('requestorSignFile').value='';showRequestorSignature();$('status').textContent='Unsaved changes — signature removed. Save your changes.'};
$('previewPage').onclick=()=>refreshPagePreview(true);$('pageRefresh').onclick=()=>refreshPagePreview();$('downloadJPEG').onclick=downloadJPEG;$('previewJPEG').onclick=downloadJPEG;$('pageJPEG').onclick=downloadJPEG;$('pagePDF').onclick=downloadPR;
$('print').onclick=async()=>{try{const c=await renderPRCanvas();const landscape=c.width>c.height;const frame=$('printPage');frame.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print()};frame.srcdoc='<!doctype html><html><head><title>Print Purchase Request</title><style>@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:0}html,body{margin:0;padding:0}img{display:block;width:'+(landscape?'297':'210')+'mm;height:'+(landscape?'210':'297')+'mm;object-fit:contain}</style></head><body><img src="'+c.toDataURL('image/jpeg',.95)+'"></body></html>';}catch(err){$('status').textContent='Please use Download PDF to print: '+err.message}};

showRequestorSignature();
