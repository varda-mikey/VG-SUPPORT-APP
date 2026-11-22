'use strict';
/* Supplemental inventory workbook + live PR quick editor.
   Does not mutate approved records or bypass the purchaser approval gateway. */
(function(){
const $=id=>document.getElementById(id);
const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
const saveBlob=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)};
const downloadCSV=(cols,rows,name)=>saveBlob(new Blob(['\ufeff'+[cols,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),name);
const parseCSV=text=>{const rows=[],current=[];let field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted;}else if(c===','&&!quoted){current.push(field);field=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;current.push(field);if(current.some(x=>x.trim()))rows.push(current.splice(0));field=''}else field+=c}current.push(field);if(current.some(x=>x.trim()))rows.push(current);return rows};
const columns=['Item','UOM','PAR','OnHand','Qty','UnitPrice','Remarks','Supplier','Branch'];
const panel=document.createElement('section');panel.className='priceCatalog';panel.id='inventoryWorkbook';panel.innerHTML='<h2>📊 Inventory Excel Upload & Full Record Export</h2><p>Download the ready-made inventory format, complete it in Excel, then upload. Values populate the current Manual PO / Automatic PO form for review. Import does not submit or overwrite approved records. Export your whole locally edited form, or (if authorized) all accessible submitted records.</p><div class="catalogControls"><button type="button" id="invTemplate">Download Blank Excel Template</button><button type="button" id="invDownload" class="secondary">Download Current Inventory</button><label style="padding:10px;border:1px solid #c7bdc0;border-radius:8px">Upload Excel / CSV <input id="invUpload" type="file" accept=".xlsx,.xls,.csv" style="max-width:160px"></label><button id="recordExport" class="secondary" type="button">Export All Accessible PR Records</button></div><p id="invStatus" role="status" aria-live="polite"></p>';
document.getElementById('priceCatalog').after(panel);
const quick=document.createElement('section');quick.className='priceCatalog';quick.id='quickPurchaseEditor';quick.innerHTML='<h2>✏️ Live PO Price & Quantity Editor</h2><p>Same ordering-style workflow: update quantity and unit price here, and the official PR form/total below updates immediately. Your draft must still be saved or submitted. Saved requests are read-only unless opened for authorized pending review.</p><div style="overflow:auto"><table style="min-width:620px;table-layout:auto"><thead><tr><th>#</th><th>Item</th><th>UOM</th><th>Qty</th><th>Unit price (₱)</th><th>Amount (₱)</th></tr></thead><tbody id="quickRows"></tbody></table></div><p id="quickTotal" style="text-align:right;font-weight:bold;color:#7b182b"></p>';
document.getElementById('priceCatalog').after(quick);
function spreadsheetRows(){
 return [...$('rows').children].map(row=>{const get=k=>row.querySelector('[data-field="'+k+'"]')?.value||'';
 return [get('description'),get('unit'),get('par')||get('dailyPar'),get('onHand'),get('qty'),get('unitPrice'),get('remarks'),get('remarks').match(/Supplier:\\s*([^|]+)/)?.[1]||'',$('campus').value]})
 .filter(r=>r[0].trim());
}
function createWorkbook(records,name){
 if(typeof XLSX!=='undefined'){
  const sheet=XLSX.utils.aoa_to_sheet([columns,...records]);
  sheet['!cols']=[{wch:32},{wch:17},{wch:12},{wch:12},{wch:12},{wch:17},{wch:38},{wch:22},{wch:20}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Inventory');XLSX.writeFile(wb,name+'.xlsx');$('invStatus').textContent='Excel workbook downloaded.';return;
 }
 downloadCSV(columns,records,name+'.csv');$('invStatus').textContent='Excel CSV downloaded (offline-compatible). Open it in Excel and save as XLSX if needed.';
}
$('invTemplate').onclick=()=>createWorkbook([['Sample: Carrots','kg','10','2','8','100','Example only - delete this row','Mary Wilson','DORM2']], 'VG-Inventory-Template');
$('invDownload').onclick=()=>createWorkbook(spreadsheetRows(),'VG-PR-Inventory-'+new Date().toISOString().slice(0,10));
function dispatch(){totals();resize();$('request').dispatchEvent(new Event('input',{bubbles:true}));updateQuick();}
const baseRows=()=>[...$('rows').children];
function getRowValue(row,key){return row.querySelector('[data-field="'+key+'"]')?.value||''}
function updateQuick(){
 const rows=$('quickRows');rows.replaceChildren();let total=0;
 const locked=!!prSelected&&!prEditing;
 for(const [i,row] of baseRows().entries()){
  const desc=getRowValue(row,'description'),qty=getRowValue(row,'qty'),price=getRowValue(row,'unitPrice');
  if(!desc.trim()&&!qty&&!price)continue;
  const tr=document.createElement('tr');
  for(const content of [String(i+1),desc,getRowValue(row,'unit')]){
   const td=document.createElement('td');td.textContent=content;td.style.textAlign='left';tr.append(td);
  }
  for(const field of ['qty','unitPrice']){
   const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step=field==='qty'?'any':'.01';input.min='0';input.style.width='95px';input.value=getRowValue(row,field);input.disabled=locked;
   input.addEventListener('input',()=>{const original=row.querySelector('[data-field="'+field+'"]');if(!original)return;original.value=input.value;if(field==='qty'&&poMode==='automatic')row.dataset.qtyOverride='true';delete row.dataset.legacy;totals();const amount=row.querySelector('[data-field="amount"]');tr.lastElementChild.textContent=amount?.value?Number(amount.value).toFixed(2):'—';$('quickTotal').textContent='GRAND TOTAL: '+$('total').value;$('status').textContent='Unsaved edits — save draft or submit for approval.';});
   td.append(input);tr.append(td);
  }
  const td=document.createElement('td');td.textContent=getRowValue(row,'amount')?Number(getRowValue(row,'amount')).toFixed(2):'—';tr.append(td);rows.append(tr);
  total+=Number(getRowValue(row,'amount')||0);
 }
 $('quickTotal').textContent='GRAND TOTAL: '+$('total').value+(locked?' • Saved record read-only':'');
}
const observe=new MutationObserver(()=>{requestAnimationFrame(updateQuick)});
observe.observe($('rows'),{childList:true});
$('request').addEventListener('input',e=>{if(e.target.closest('#rows'))requestAnimationFrame(updateQuick)});
const origFill=window.fillRecord; if(typeof origFill==='function')window.fillRecord=function(...a){const result=origFill(...a);updateQuick();return result};
const origLock=window.lockRecord;if(typeof origLock==='function')window.lockRecord=function(...a){const result=origLock(...a);updateQuick();return result};
$('editRequest').addEventListener('click',()=>setTimeout(updateQuick,0));
$('invUpload').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(prSelected&&!prEditing)throw Error('Open New Form or authorized Edit Request before importing. Approved/saved records cannot be overwritten.');
  let matrix;
  if(/\\.csv$/i.test(file.name))matrix=parseCSV((await file.text()).replace(/^\\ufeff/,''));
  else if(typeof XLSX!=='undefined'){const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});matrix=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});}
  else throw Error('XLSX reader not available. Save your spreadsheet as CSV UTF-8 in Excel and upload again.');
  const names=(matrix.shift()||[]).map(x=>String(x).trim().toLowerCase().replace(/[^a-z0-9]/g,''));
  const col=(...aliases)=>names.findIndex(x=>aliases.includes(x));
  const nameCol=col('item','description','product','productname'),qtyCol=col('qty','quantity','requestqty'),unitCol=col('uom','unit'),priceCol=col('unitprice','price','cost');
  if([nameCol,qtyCol,unitCol,priceCol].some(x=>x<0))throw Error('Required columns: Item, UOM, Qty and UnitPrice.');
  const parCol=col('par','dailypar'),onCol=col('onhand','stockonhand'),remarksCol=col('remarks','note'),supplierCol=col('supplier');
  const imported=matrix.map(r=>({description:String(r[nameCol]??'').trim(),unit:String(r[unitCol]??'').trim(),qty:String(r[qtyCol]??'').trim(),unitPrice:String(r[priceCol]??'').replace(/[₱,]/g,'').trim(),par:parCol<0?'':String(r[parCol]??''),onHand:onCol<0?'':String(r[onCol]??''),remarks:(remarksCol<0?'':String(r[remarksCol]??''))+(supplierCol<0||!r[supplierCol]?'':' | Supplier: '+r[supplierCol])})).filter(r=>r.description);
  if(!imported.length)throw Error('No inventory items were found.');
  if(imported.length>100)throw Error('Maximum 100 PO lines per form. Split the spreadsheet into separate requests.');
  if(imported.some(r=>!Number.isFinite(Number(r.qty))||Number(r.qty)<0||!Number.isFinite(Number(r.unitPrice))||Number(r.unitPrice)<0))throw Error('Check invalid quantity or unit price values.');
  if(!confirm('Import '+imported.length+' inventory lines into this PO? The visible item lines will be replaced.'))return;
  setPOMode('manual');$('rows').replaceChildren();imported.forEach(addRow);while($('rows').children.length<8)addRow();totals();updateQuick();
  $('invStatus').textContent='Imported '+imported.length+' lines. Review quantities/prices and save draft or submit for approval.';
 }catch(err){$('invStatus').textContent='Import failed: '+err.message}finally{e.target.value=''}
});
$('recordExport').onclick=async()=>{
 if(!currentSession()){ $('invStatus').textContent='Connect to the shared PR records before exporting.';return;}
 if(!confirm('Download ALL PR records accessible to your current role, including individual item lines? This may contain confidential purchasing information.'))return;
 const btn=$('recordExport');btn.disabled=true;let requests=[],details=[];
 try{
  $('invStatus').textContent='Collecting authorized PR records...';
  for(const status of ['pending','approved','declined']){
   for(let offset=0;offset<10000;offset+=25){
    const batch=await gateway('list',{status,offset});
    requests.push(...batch);
    if(batch.length<25)break;
   }
  }
  const seen=new Set();requests=requests.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true});
  for(let i=0;i<requests.length;i++){
   const r=requests[i];let full;
   try{full=await gateway('get',{id:r.id})}catch(err){full=null}
   details.push({record:r,full});
   if(i%10===0)$('invStatus').textContent='Exporting '+(i+1)+' / '+requests.length+' authorized records...';
  }
  const columns=['PRNumber','Status','Branch','Date','PreparedBy','Supplier','Item','UOM','Qty','UnitPrice','Amount','Remarks'];
  const lines=details.flatMap(({record:r,full})=>{
   const rows=full?.payload?.rows||[{}];
   return rows.map(x=>[r.pr_number,r.status,r.branch_code,r.created_at,r.prepared_name,r.supplier,x.description||'',x.unit||'',x.qty||'',x.unitPrice||'',x.amount||'',x.remarks||'']);
  });
  downloadCSV(columns,lines,'VG-All-PR-Records-'+new Date().toISOString().slice(0,10)+'.csv');
  saveBlob(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records:details},null,2)],{type:'application/json'}),'VG-All-PR-Records-Backup.json');
  $('invStatus').textContent='Downloaded '+requests.length+' accessible records as Excel-compatible CSV and full JSON backup. Any record denied by your role is metadata-only in the backup.';
 }catch(err){$('invStatus').textContent='Record export failed: '+err.message+' (No claim of complete export.)'}
 finally{btn.disabled=false}
};
setTimeout(updateQuick,0);
})();
