const cors={'Access-Control-Allow-Origin':'https://varda-mikey.github.io','Access-Control-Allow-Headers':'content-type, apikey, authorization','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const base=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function server(path:string,body:unknown,custom?:HeadersInit){const r=await fetch(base+path,{method:'POST',headers:custom||headers,body:body instanceof Blob?body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d?.error)throw new Error(d?.message||d?.error||'Request failed');return d;}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({error:'Use POST'},405);
 try{
  if(Number(req.headers.get('content-length'))>15*1024*1024)return reply({error:'Request too large'},413);
  if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
   const form=await req.formData(), item_id=String(form.get('item_id')||''),file=form.get('file');
   const original=form.get('scope')==='original-audit',draft=String(form.get('draft_id')||''),check=String(form.get('check')||'');
   if(original){if(!/^[0-9a-f-]{36}$/.test(draft)||!/^\d{1,2}:\d{1,2}$/.test(check))return reply({error:'Invalid audit checkpoint'},400);}else await server('/rest/v1/rpc/retail_audit_gateway',{p_action:'access_item',p_data:{item_id}});
   if(!(file instanceof File)||file.size===0||file.size>10485760||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))return reply({error:'Use JPG, PNG, WebP or PDF, up to 10 MB.'},400);
   const path=(original?'audit/'+draft+'/'+check.replace(':','/')+'/':item_id+'/')+crypto.randomUUID()+({ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'}[file.type]||'');
   await server('/storage/v1/object/retail-audit-evidence/'+path,file,{apikey:key,Authorization:'Bearer '+key,'Content-Type':file.type,'x-upsert':'false'});
   return reply({path,name:file.name,size:file.size,mime:file.type});
  }
  const raw=await req.text();if(raw.length>250000)return reply({error:'Request too large'},413);
  const body=JSON.parse(raw),action=body.action,data=body.data||{};
  if(!['branches','list','submit_audit','get','create_cpar','update','submitted','assess_risk','acknowledged','returned','verified','finalize_audit','auditor_login','auditor_logout','review_access','audit_evidence','evidence'].includes(action))return reply({error:'Unknown operation'},400);
  if(action==='auditor_login'){
   if(typeof data.password!=='string'||data.password.length>200)return reply({error:'Enter the auditor password'},400);
   const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
   data.ip=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  if(action==='evidence'||action==='audit_evidence'){
   await server('/rest/v1/rpc/retail_audit_gateway',{p_action:action==='audit_evidence'?'audit_evidence_access':'evidence_access',p_data:data});
   const r=await server('/storage/v1/object/sign/retail-audit-evidence/'+data.path,{expiresIn:300});
   return reply({url:base+'/storage/v1'+r.signedURL});
  }
  return reply(await server('/rest/v1/rpc/retail_audit_gateway',{p_action:action,p_data:data,p_token:body.token||null}));
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to complete request'},400)}
});
