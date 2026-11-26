import { createClient } from 'npm:@supabase/supabase-js@2.79.0';
const URL=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,KEY,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'https://varda-mikey.github.io','Access-Control-Allow-Headers':'content-type, authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const error=(x:any)=>{throw Error(x?.message||'Unable to save')};
const valid=(s:unknown,n=200)=>typeof s==='string'&&s.length>0&&s.length<=n;
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
async function identity(req:Request,body:any){
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
 const ipHash=await digest(ip);
 if(body.ceoToken&&/^[a-f0-9]{64}$/.test(body.ceoToken)){
  const hash=await digest(body.ceoToken);
  const {data:viewer}=await db.from('vg_checklist_view_links').select('id').eq('id','ceo').eq('token_hash',hash).maybeSingle();
  if(viewer)return {role:'viewer',id:''};
 }
 if(body.headToken&&/^[a-f0-9]{64}$/.test(body.headToken)){
  const {data,error:e}=await db.rpc('mission_gateway',{p_action:'load',p_data:{},p_token:body.headToken,p_ip:ipHash});
  if(!e&&data?.head===true)return {role:'head',id:''};
 }
 if(body.leader&&valid(body.leader,150)){
  const {data}=await db.from('vg_checklist_leaders').select('id').eq('access_token',body.leader).eq('active',true).maybeSingle();
  if(data)return {role:'leader',id:data.id};
 }
 throw Error('Please sign in with a valid head session or personal leader link.');
}
async function rows(table:string,query:(q:any)=>any){const r=await query(db.from(table).select('*'));if(r.error)error(r.error);return r.data}
function applies(t:any,day:string){
 if(t.start_date&&day<t.start_date)return false;
 if(t.end_date&&day>t.end_date)return false;
 if(t.frequency==='special')return Boolean((t.work_date||t.start_date)&&day>=(t.work_date||t.start_date));
 if(t.work_date&&t.frequency!=='special')return t.work_date===day;
 return true;
}
async function getData(role:string,id:string,day:string){
 const leaders=role!=='leader'?await rows('vg_checklist_leaders',q=>q.order('name')):await rows('vg_checklist_leaders',q=>q.eq('id',id));
 const targetDay=/^\d{4}-\d{2}-\d{2}$/.test(day)?day:new Date().toISOString().slice(0,10);
 const allTasks=await rows('vg_checklist_tasks',q=>{
  q=q.eq('active',true);
  if(role==='leader')q=q.eq('leader_id',id);
  return q.order('category_order').order('task_order')
 });
 const overrides=await rows('vg_checklist_task_day_edits',q=>q.eq('work_date',targetDay));
 const changes=new Map(overrides.map((x:any)=>[x.task_id,x]));
 // A mission stays open until a valid submission with remarks and evidence.
 // Use an earlier completed day to hide it from subsequent daily checklists;
 // its original submission remains visible in the historical day/report.
 const missionIds=allTasks.filter((t:any)=>t.frequency==='special').map((t:any)=>t.id);
 const completedMissions=new Set<string>();
 if(missionIds.length){
  for(let i=0;i<missionIds.length;i+=100){
   const {data:done,error:doneError}=await db.from('vg_checklist_entries')
    .select('id,task_id,leader_note,work_date').in('task_id',missionIds.slice(i,i+100))
    .eq('leader_status','submitted').lt('work_date',targetDay);
   if(doneError)error(doneError);
   const eligible=done||[];
   for(let j=0;j<eligible.length;j+=100){
    const ids=eligible.slice(j,j+100).map((e:any)=>e.id);
    const {data:proof,error:proofError}=await db.from('vg_checklist_files').select('entry_id').like('mime','image/%').eq('added_by','leader').in('entry_id',ids);
    if(proofError)error(proofError);
    const verifiedIds=new Set((proof||[]).map((f:any)=>f.entry_id));
    for(const e of eligible.slice(j,j+100))if(verifiedIds.has(e.id))completedMissions.add(e.task_id);
   }
  }
 }
 const tasks=allTasks.filter((t:any)=>applies(t,targetDay)&&!changes.get(t.id)?.hidden&&!(t.frequency==='special'&&completedMissions.has(t.id))).map((t:any)=>{
  const edit=changes.get(t.id);
  return edit?{...t,title:edit.title,category:edit.category,date_scoped_edit:true}:t;
 });
 let q=db.from('vg_checklist_entries').select('*');
 if(role==='leader')q=q.eq('leader_id',id);
 if(day){const monthly=day.slice(0,7)+'-01';q=day===monthly?q.eq('work_date',day):q.or('work_date.eq.'+day+',work_date.eq.'+monthly)}
 const {data:entries,error:e}=await q.order('updated_at',{ascending:false}).limit(2500);if(e)error(e);
 const ids=(entries||[]).map(x=>x.id);
 let files:any[]=[];
 if(ids.length){const {data,error:fe}=await db.from('vg_checklist_files').select('*').in('entry_id',ids).order('created_at');if(fe)error(fe);files=data||[];}
 if(files.length){
  // Small signed-URL batches prevent a single invalid attachment from hiding all evidence.
  const signedFiles:any[]=[];
  for(let i=0;i<files.length;i+=50){
   const group=files.slice(i,i+50),paths=group.map(x=>x.storage_path);
   const {data:urls,error:ue}=await db.storage.from('vg-leader-evidence').createSignedUrls(paths,3600);
   if(ue||!urls){
    for(const f of group){
     const one=await db.storage.from('vg-leader-evidence').createSignedUrl(f.storage_path,3600);
     signedFiles.push({...f,url:one.error?'':one.data?.signedUrl||'',url_error:one.error?'Preview unavailable':''});
    }
   }else{
    signedFiles.push(...group.map((f,j)=>({...f,url:urls[j]?.signedUrl||'',url_error:urls[j]?.error?'Preview unavailable':''})));
   }
  }
  files=signedFiles;
 }
 const absences=await rows('vg_checklist_absences',q=>{q=q.eq('work_date',targetDay);return role==='leader'?q.eq('leader_id',id):q});
 const attendance_stamps=await rows('vg_checklist_attendance_stamps',q=>{q=q.eq('work_date',targetDay).neq('status','removed');return role==='leader'?q.eq('leader_id',id):q});
 const acknowledgements=await rows('vg_checklist_pending_ack',q=>{q=q.eq('work_date',targetDay);return role==='leader'?q.eq('leader_id',id):q});
 return {absences,attendance_stamps,acknowledgements,leaders:role==='viewer'?leaders.map(({access_token,...rest}:any)=>rest):leaders,tasks,entries,files,role,server_time:new Date().toISOString()};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 try{
 
 if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
  const form=await req.formData();
  if(form.get('action')!=='upload_file')return reply({error:'Unsupported upload action'},400);
  const body={headToken:String(form.get('headToken')||''),leader:String(form.get('leader')||'')};
  const user=await identity(req,body),head=user.role==='head';
  const leaderId=head?String(form.get('leader_id')||''):user.id;
  const workDate=String(form.get('day')||''),taskId=String(form.get('task_id')||'');
  if(!leaderId||!/^\d{4}-\d{2}-\d{2}$/.test(workDate))throw Error('Invalid leader or work date');
  const rawFile=form.get('file');if(!(rawFile instanceof File))throw Error('Please choose a file');
  const file=rawFile as File;
  const allowed=['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'];
  if(!allowed.includes(file.type)||!file.size||file.size>5000000)throw Error('Please upload a photo or video smaller than 5 MB');
  const {data:task}=await db.from('vg_checklist_tasks').select('id').eq('id',taskId).eq('leader_id',leaderId).eq('active',true).maybeSingle();if(!task)throw Error('Task not available');
  const {data:leader}=await db.from('vg_checklist_leaders').select('id').eq('id',leaderId).maybeSingle();if(!leader)throw Error('Leader unavailable');
  const {data:existing}=await db.from('vg_checklist_entries').select('id').eq('leader_id',leaderId).eq('task_id',taskId).eq('work_date',workDate).maybeSingle();
  let entryId=existing?.id;
  if(!entryId){const created=await db.from('vg_checklist_entries').insert({leader_id:leaderId,task_id:taskId,work_date:workDate}).select('id').single();if(created.error)error(created.error);entryId=created.data.id;}
  const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'} as Record<string,string>)[file.type];
  const path=leaderId+'/'+workDate+'/'+entryId+'/'+crypto.randomUUID()+'.'+extension;
  const result=await db.storage.from('vg-leader-evidence').upload(path,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false,cacheControl:'3600'});
  if(result.error)error(result.error);
  const stored=await db.from('vg_checklist_files').insert({entry_id:entryId,storage_path:path,original_name:file.name.slice(0,160),mime:file.type,bytes:file.size,added_by:head?'head':'leader'}).select().single();
  if(stored.error){await db.storage.from('vg-leader-evidence').remove([path]);error(stored.error);}
  return reply({ok:true,file:stored.data,entry_id:entryId});
 }
 const raw=await req.text();if(raw.length>100000)return reply({error:'Request too large'},413);
  const b=JSON.parse(raw);const action=b.action;
  if(action==='head_login'){
   if(!valid(b.password,150))return reply({error:'Enter head password'},400);
   const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
   const {data,error:e}=await db.rpc('mission_gateway',{p_action:'login',p_data:{role:'head',password:b.password},p_token:null,p_ip:await digest(ip)});
   if(e||data?.error||!data?.token)return reply({error:'Head sign-in failed'},401);
   return reply({token:data.token,name:data.name||'National Retail Head'});
  }
  const user=await identity(req,b);const head=user.role==='head',viewer=user.role==='viewer',leaderId=user.id;
  if(viewer&&!['load','report'].includes(action))return reply({error:'View-only CEO link: editing is not permitted.'},403);
  if(action==='attendance_stamp'){
   if(!head)return reply({error:'Head only'},403);
   const day=String(b.day||''),target=String(b.leader_id||''),status=String(b.status||''),note=String(b.note||'').trim().slice(0,1000);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<'2020-01-01'||day>'2100-12-31')throw Error('Choose a valid attendance date');
   if(!['absent','rest_day','awol','on_leave','removed'].includes(status))throw Error('Choose a valid attendance stamp');
   const owner=await db.from('vg_checklist_leaders').select('id').eq('id',target).maybeSingle();if(owner.error)error(owner.error);if(!owner.data)throw Error('Leader unavailable');
   const saved=await db.from('vg_checklist_attendance_stamps').upsert({leader_id:target,work_date:day,status,note,changed_by:'National Retail Head',changed_at:new Date().toISOString()},{onConflict:'leader_id,work_date'}).select().single();
   if(saved.error)error(saved.error);return reply({attendance_stamp:saved.data});
  }
  if(action==='absence_request'||action==='absence_review'){
   const day=String(b.day||'');
   const stamp=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const parts=Object.fromEntries(stamp.map(x=>[x.type,x.value]));const localDay=parts.year+'-'+parts.month+'-'+parts.day;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>localDay)throw Error('Choose a valid past or current date');
   if(action==='absence_request'){
    if(user.role!=='leader')return reply({error:'Leader only'},403);
    const reason=String(b.reason||'').trim();if(reason.length<5||reason.length>3000)throw Error('Enter an absence reason (5–3000 characters)');
    const r=await db.from('vg_checklist_absences').insert({leader_id:leaderId,work_date:day,reason}).select().single();
    if(r.error){if(r.error.code==='23505')throw Error('An absence request already exists for this date. Contact Head for corrections.');error(r.error)}
    return reply({absence:r.data});
   }
   if(!head)return reply({error:'Head only'},403);
   if(!['confirmed','rejected'].includes(b.status))throw Error('Choose confirm or reject');
   const note=String(b.note||'').trim();if(!note||note.length>3000)throw Error('Enter a review note');
   const r=await db.from('vg_checklist_absences').update({status:b.status,review_note:note,reviewed_at:new Date().toISOString()}).eq('leader_id',b.leader_id).eq('work_date',day).eq('status','pending').select().single();if(r.error)error(r.error);return reply({absence:r.data});
  }
  if(action==='storage_usage'){
   if(!head)return reply({error:'Head only'},403);
   const {data:usage,error:ue}=await db.rpc('vg_checklist_storage_usage');
   if(ue)error(ue);
   return reply({usage});
  }
  if(action==='pending_yesterday'||action==='pending_ack'||action==='pending_ack_report'){
   if(action==='pending_ack_report'){
    if(!head)return reply({error:'Head only'},403);
    const day=String(b.day||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return reply({error:'Invalid date'},400);
    const {data:items,error:ae}=await db.from('vg_checklist_pending_ack').select('leader_id,task_id,work_date,reason,acknowledged_at,status').eq('work_date',day).order('acknowledged_at',{ascending:false});
    if(ae)error(ae);
    return reply({acknowledgements:items||[]});
   }
   if(user.role!=='leader')return reply({error:'Leader only'},403);
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const dpart=Object.fromEntries(parts.map((x:any)=>[x.type,x.value]));const stamp=dpart.year+'-'+dpart.month+'-'+dpart.day;
   const yy=new Date(stamp+'T12:00:00Z');yy.setUTCDate(yy.getUTCDate()-1);
   const yesterday=yy.toISOString().slice(0,10);
    const attendance=await db.from('vg_checklist_attendance_stamps').select('status').eq('leader_id',leaderId).eq('work_date',yesterday).in('status',['rest_day','on_leave']).maybeSingle();if(attendance.error)error(attendance.error);
    if(attendance.data)return reply({day:yesterday,pending:[],unacknowledged:0,attendance_status:attendance.data.status});
    const absence=await db.from('vg_checklist_absences').select('status').eq('leader_id',leaderId).eq('work_date',yesterday).maybeSingle();if(absence.error)error(absence.error);
   if(absence.data&&absence.data.status!=='rejected')return reply({day:yesterday,pending:[],unacknowledged:0,absence_status:absence.data.status});
   const {data:tasks,error:te}=await db.from('vg_checklist_tasks').select('id,title,category,frequency,work_date,start_date,end_date,created_at').eq('leader_id',leaderId).eq('active',true);
   if(te)error(te);
   const {data:edits,error:ee}=await db.from('vg_checklist_task_day_edits').select('task_id,title,hidden').eq('work_date',yesterday);
   if(ee)error(ee);
   const editMap=new Map((edits||[]).map((x:any)=>[x.task_id,x]));
   const relevant=(tasks||[]).filter((t:any)=>!editMap.get(t.id)?.hidden && applies(t,yesterday));
   const {data:entries,error:ne}=await db.from('vg_checklist_entries').select('id,task_id,leader_status').eq('leader_id',leaderId).eq('work_date',yesterday);
   if(ne)error(ne);
   const entryMap=new Map((entries||[]).map((e:any)=>[e.task_id,e]));
   const entryIds=(entries||[]).map((e:any)=>e.id);
   let files:any[]=[];
   if(entryIds.length){const f=await db.from('vg_checklist_files').select('entry_id').like('mime','image/%').eq('added_by','leader').in('entry_id',entryIds);if(f.error)error(f.error);files=f.data||[]}
   const proofIds=new Set(files.map((f:any)=>f.entry_id));
   const {data:acks,error:ae}=await db.from('vg_checklist_pending_ack').select('task_id,reason').eq('leader_id',leaderId).eq('work_date',yesterday);if(ae)error(ae);
   const acknowledged=new Set((acks||[]).map((x:any)=>x.task_id));
   const pending=relevant.filter((t:any)=>{const e=entryMap.get(t.id);return e?.leader_status!=='submitted'||!proofIds.has(e.id)}).map((t:any)=>({id:t.id,title:editMap.get(t.id)?.title||t.title,category:t.category,acknowledged:acknowledged.has(t.id)}));
   if(action==='pending_ack'){
    const reason=String(b.reason||'').trim();
    if(reason.length<5||reason.length>3000)return reply({error:'Please state a reason (5–3000 characters)'},400);
    const outstanding=pending.filter((t:any)=>!t.acknowledged);
    if(!outstanding.length)return reply({ok:true,acknowledged:0});
    const values=outstanding.map((t:any)=>({leader_id:leaderId,task_id:t.id,work_date:yesterday,reason,status:'acknowledged_incomplete',acknowledged_at:new Date().toISOString()}));
    const done=await db.from('vg_checklist_pending_ack').upsert(values,{onConflict:'leader_id,task_id,work_date'});if(done.error)error(done.error);
    for(const t of outstanding){
     const existing=entryMap.get(t.id);
     if(existing){
      const previous=await db.from('vg_checklist_entries').select('head_status').eq('id',existing.id).single();
      if(previous.error)error(previous.error);
      if(!previous.data?.head_status||previous.data.head_status==='pending'){
       const update=await db.from('vg_checklist_entries').update({head_status:'incomplete',head_note:'Leader acknowledged unfinished duty; see acknowledgement reason.',updated_at:new Date().toISOString()}).eq('id',existing.id);
       if(update.error)error(update.error);
      }
     }else{
      const created=await db.from('vg_checklist_entries').insert({leader_id:leaderId,task_id:t.id,work_date:yesterday,leader_status:'pending',head_status:'incomplete',head_note:'Leader acknowledged unfinished duty; see acknowledgement reason.'});
      if(created.error)error(created.error);
     }
    }
    return reply({ok:true,acknowledged:values.length,work_date:yesterday});
   }
   return reply({day:yesterday,pending,unacknowledged:pending.filter((t:any)=>!t.acknowledged).length});
  }
  if(action==='download_summary'){
   if(!head)return reply({error:'Head only'},403);
   const tables=['vg_checklist_entries','vg_checklist_files','vg_checklist_pending_ack','vg_checklist_leaders','vg_checklist_tasks'];
   const result:any={generated_at:new Date().toISOString()};
   for(const table of tables){
    const rows:any[]=[];
    for(let start=0;start<20000;start+=1000){
     let query=db.from(table).select(table==='vg_checklist_leaders'?'id,name,position,area':table==='vg_checklist_tasks'?'id,title,category,leader_id,work_date':'*').range(start,start+999);
     const {data,error:e}=await query;
     if(e)error(e);
     rows.push(...(data||[]));
     if(!data||data.length<1000)break;
    }
    result[table]=rows;
   }
   return reply({summary:result});
  }
  if(action==='ceo_link'){
   if(!head)return reply({error:'Head only'},403);
   const existing=await db.from('vg_checklist_view_links').select('id').eq('id','ceo').maybeSingle();
   if(existing.error)error(existing.error);
   if(existing.data&&!b.rotate)return reply({error:'CEO link already exists. Use Reset CEO link to generate a new link.'},409);
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
   const saved=await db.from('vg_checklist_view_links').upsert({id:'ceo',token_hash:await digest(token),rotated_at:new Date().toISOString()},{onConflict:'id'});
   if(saved.error)error(saved.error);
   return reply({token});
  }
  if(action==='load'){
   const day=/^\d{4}-\d{2}-\d{2}$/.test(b.day||'')?b.day:'';
   return reply(await getData(user.role,leaderId,day));
  }
  if(action==='leader_save'){
   if(!head)return reply({error:'Head only'},403);
   const name=String(b.name||'').trim(),position=String(b.position||'').trim(),area=String(b.area||'').trim();
   if(!valid(name,100)||position.length>100||area.length>100)throw Error('Invalid leader details');
   let rec;
   if(b.id){const r=await db.from('vg_checklist_leaders').update({name,position,area,active:b.active!==false}).eq('id',b.id).select().single();if(r.error)error(r.error);rec=r.data}
   else{const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');const r=await db.from('vg_checklist_leaders').insert({name,position,area,access_token:token,active:true}).select().single();if(r.error)error(r.error);rec=r.data}
   return reply({leader:rec});
  }
  if(action==='rotate_link'){
   if(!head)return reply({error:'Head only'},403);
   const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
   const r=await db.from('vg_checklist_leaders').update({access_token:token}).eq('id',b.id).select().single();if(r.error)error(r.error);return reply({leader:r.data});
  }
  if(action==='task_save'){
   if(!head)return reply({error:'Head only'},403);
   const title=String(b.title||'').trim(),category=String(b.category||'').trim();
   const leaderId=String(b.leader_id||''),day=String(b.day||'');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Select the exact date before changing tasks');
   if(!leaderId)throw Error('Select a leader before editing tasks');
   const {data:owner}=await db.from('vg_checklist_leaders').select('id').eq('id',leaderId).maybeSingle();
   if(!owner)throw Error('Unknown leader');
   if(!valid(title,220)||!valid(category,100))throw Error('Category and task name required');
   if(b.id){
    const {data:task,error:te}=await db.from('vg_checklist_tasks').select('id,leader_id,work_date,start_date,end_date,frequency').eq('id',b.id).eq('leader_id',leaderId).maybeSingle();
    if(te)error(te);if(!task||!applies(task,day))throw Error('This task does not belong to the chosen date');
    // Day-specific names/categories must never mutate a different day's task.
    const result=await db.from('vg_checklist_task_day_edits').upsert({task_id:task.id,work_date:day,title,category,hidden:false,updated_at:new Date().toISOString()},{onConflict:'task_id,work_date'}).select().single();
    if(result.error)error(result.error);
    return reply({task:{...task,...result.data,id:task.id},work_date:day});
   }
   // Newly added tasks belong to one date; no automatic appearance on past/future days.
   const type=String(b.task_type||'single');
   if(!['regular','special','single'].includes(type))throw Error('Invalid task type');
   const duration=Number(b.duration_days||1);
   // Special missions remain active until the leader submits valid evidence.
   const end=new Date(day+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+(type==='special'?duration:1)-1);
   const values={title,category,leader_id:leaderId,frequency:type==='special'?'special':'daily',work_date:type==='regular'?null:day,start_date:day,end_date:type==='regular'||type==='special'?null:end.toISOString().slice(0,10),category_order:Math.max(0,Math.min(999,Number(b.category_order)||0)),task_order:Math.max(0,Math.min(999,Number(b.task_order)||0)),active:true};
   const result=await db.from('vg_checklist_tasks').insert(values).select().single();
   if(result.error)error(result.error);
   return reply({task:result.data,work_date:day});
  }
  if(action==='task_schedule'){
   if(!head)return reply({error:'Head only'},403);
   const day=String(b.day||''),type=String(b.task_type||''),duration=Number(b.duration_days||1);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!['regular','special','single'].includes(type))throw Error('Invalid schedule');
   // Special missions do not expire on a timer.
   const {data:t,error:te}=await db.from('vg_checklist_tasks').select('id,leader_id').eq('id',b.id).eq('leader_id',b.leader_id).maybeSingle();
   if(te)error(te);if(!t)throw Error('Task not found');
   const end=new Date(day+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+(type==='special'?duration:1)-1);
   const vals={frequency:type==='special'?'special':'daily',work_date:type==='regular'?null:day,start_date:day,end_date:type==='regular'||type==='special'?null:end.toISOString().slice(0,10)};
   const update=await db.from('vg_checklist_tasks').update(vals).eq('id',t.id).select().single();
   if(update.error)error(update.error);
   return reply({task:update.data});
  }
  if(action==='task_disable'){
   if(!head)return reply({error:'Head only'},403);
   const leaderId=String(b.leader_id||''),day=String(b.day||'');
   if(!leaderId||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Choose leader and date');
   const {data:task,error:te}=await db.from('vg_checklist_tasks').select('id,title,category,frequency,work_date,start_date,end_date').eq('id',b.id).eq('leader_id',leaderId).maybeSingle();
   if(te)error(te);
   if(!task||!applies(task,day))throw Error('Task is not assigned on this date');
   // Preserve historical evidence and remove the assigned task from this day onward.
   const result=await db.from('vg_checklist_task_day_edits').upsert({task_id:task.id,work_date:day,title:task.title,category:task.category,hidden:true,updated_at:new Date().toISOString()},{onConflict:'task_id,work_date'});
   if(result.error)error(result.error);
   const previous=new Date(day+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
   const cutoff=previous.toISOString().slice(0,10);
   if(!task.end_date||task.end_date>cutoff){
    const closed=await db.from('vg_checklist_tasks').update({end_date:cutoff}).eq('id',task.id).eq('leader_id',leaderId);
    if(closed.error)error(closed.error);
   }
   return reply({ok:true,work_date:day,removed_from_future:true});
  }
  if(action==='entry_save'){
   const date=String(b.day||'');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Choose a valid date');
   const id=head?b.leader_id:leaderId;
   if(!id)throw Error('Choose a leader');
   const {data:task}=await db.from('vg_checklist_tasks').select('id').eq('id',b.task_id).eq('leader_id',id).eq('active',true).maybeSingle();if(!task)throw Error('Task is no longer active');
   let update:any={leader_id:id,task_id:b.task_id,work_date:date,updated_at:new Date().toISOString()};
   if(head){
    if(!['pending','complete','incomplete','no-output','na'].includes(b.status))throw Error('Invalid rating');
    update.head_status=b.status;update.head_note=String(b.note||'').slice(0,3000);update.reviewed_at=new Date().toISOString();
   }else{
    if(!['pending','working','submitted'].includes(b.status))throw Error('Invalid completion status');
    update.leader_status=b.status;update.leader_note=String(b.note||'').slice(0,3000);
    if(b.status==='submitted')update.submitted_at=new Date().toISOString();
   }
   const {data:existing}=await db.from('vg_checklist_entries').select('*').eq('leader_id',id).eq('task_id',b.task_id).eq('work_date',date).maybeSingle();
   if((!head&&b.status==='submitted')||(head&&b.status==='complete')){if(!existing?.id)throw Error('Picture proof required.');const photo=await db.from('vg_checklist_files').select('id').eq('entry_id',existing.id).like('mime','image/%').eq('added_by','leader').limit(1);if(photo.error)error(photo.error);if(!photo.data?.length)throw Error('Attach at least one picture before submitting. Remarks are optional.');}
   const r=existing?await db.from('vg_checklist_entries').update(update).eq('id',existing.id).select().single():await db.from('vg_checklist_entries').insert(update).select().single();
   if(r.error)error(r.error);return reply({entry:r.data});
  }
  if(action==='upload_prepare'){
   const id=head?b.leader_id:leaderId;const date=String(b.day||'');
   if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Missing leader or date');
   const mime=String(b.mime||'').toLowerCase(),size=Number(b.bytes||0);
   const allowed=['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'];
   if(!allowed.includes(mime)||!Number.isFinite(size)||size<=0||size>52428800)throw Error('Supported photos/videos only, up to 50 MB.');
   const {data:task}=await db.from('vg_checklist_tasks').select('id').eq('id',b.task_id).eq('leader_id',id).eq('active',true).maybeSingle();if(!task)throw Error('Task unavailable');
   const {data:existing}=await db.from('vg_checklist_entries').select('*').eq('leader_id',id).eq('task_id',b.task_id).eq('work_date',date).maybeSingle();
   let entry=existing;
   if(!entry){const {data,error:e}=await db.from('vg_checklist_entries').insert({leader_id:id,task_id:b.task_id,work_date:date}).select().single();if(e)error(e);entry=data}
   const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'} as any)[mime];
   const path=id+'/'+date+'/'+entry.id+'/'+crypto.randomUUID()+'.'+ext;
   const {data:signed,error:se}=await db.storage.from('vg-leader-evidence').createSignedUploadUrl(path);
   if(se)error(se);
   return reply({entry_id:entry.id,path,token:signed.token,url:signed.signedUrl});
  }
  if(action==='upload_finish'){
   const id=head?b.leader_id:leaderId;
   const path=String(b.path||''),entryId=String(b.entry_id||'');
   const {data:entry}=await db.from('vg_checklist_entries').select('id,leader_id').eq('id',entryId).maybeSingle();
   if(!entry||entry.leader_id!==id||!path.startsWith(id+'/')||!path.includes('/'+entryId+'/'))throw Error('Invalid attachment destination');
   const mime=String(b.mime||''),bytes=Number(b.bytes)||0;
   const {data:found,error:fe}=await db.storage.from('vg-leader-evidence').info(path);
   if(fe||!found)throw Error('Upload not found. Please upload again.');
   const r=await db.from('vg_checklist_files').insert({entry_id:entryId,storage_path:path,original_name:String(b.name||'Attachment').slice(0,160),mime,bytes,added_by:head?'head':'leader'}).select().single();
   if(r.error)error(r.error);return reply({file:r.data});
  }
  if(action==='file_delete'){
   if(!head && user.role!=='leader')return reply({error:'View-only access cannot delete evidence'},403);
   const fileId=String(b.file_id||'');
   if(!/^[a-f0-9-]{36}$/i.test(fileId))throw Error('Invalid photo identifier');
   const {data:file,error:fe}=await db.from('vg_checklist_files').select('id,entry_id,storage_path,original_name,added_by').eq('id',fileId).maybeSingle();
   if(fe)error(fe);
   if(!file)return reply({error:'Photo was already removed. Refresh to view the updated list.'},404);
   const {data:entry,error:ee}=await db.from('vg_checklist_entries').select('id,leader_id').eq('id',file.entry_id).maybeSingle();
   if(ee)error(ee);
   if(!entry || (!head && entry.leader_id!==leaderId))return reply({error:'This photo belongs to a different leader'},403);
   if(!head && file.added_by!=='leader')return reply({error:'Only the Head may remove evidence added by management'},403);
   const id=head?String(b.leader_id||''):leaderId;
   if(head && id!==entry.leader_id)return reply({error:'Select the matching leader before deleting this photo'},403);
   const removed=await db.storage.from('vg-leader-evidence').remove([file.storage_path]);
   if(removed.error)error(removed.error);
   const deleted=await db.from('vg_checklist_files').delete().eq('id',file.id).eq('entry_id',entry.id).select('id').maybeSingle();
   if(deleted.error)error(deleted.error);
   if(!deleted.data)throw Error('Photo storage was removed, but the evidence list could not be updated. Contact the Head for assistance.');
   return reply({ok:true,deleted_file_id:file.id,entry_id:entry.id});
  }
  if(action==='report_delete_day'){
   if(!head)return reply({error:'Head only'},403);
   const id=String(b.leader_id||''),day=String(b.day||'');
   if(!id||!/^\\d{4}-\\d{2}-\\d{2}$/.test(day))throw Error('Invalid leader or report date');
   const {data:owner,error:oe}=await db.from('vg_checklist_leaders').select('id').eq('id',id).maybeSingle();
   if(oe)error(oe);if(!owner)throw Error('Leader not found');
   const {data:entries,error:ee}=await db.from('vg_checklist_entries').select('id').eq('leader_id',id).eq('work_date',day);
   if(ee)error(ee);
   const ids=(entries||[]).map(x=>x.id);
   if(!ids.length)return reply({ok:true,deleted:0});
   const {data:attachments,error:fe}=await db.from('vg_checklist_files').select('storage_path').in('entry_id',ids);
   if(fe)error(fe);
   const paths=(attachments||[]).map(f=>f.storage_path);
   // Delete storage first; retain DB records if storage deletion fails.
   for(let i=0;i<paths.length;i+=100){
    const rr=await db.storage.from('vg-leader-evidence').remove(paths.slice(i,i+100));if(rr.error)error(rr.error);
   }
   const dr=await db.from('vg_checklist_files').delete().in('entry_id',ids);if(dr.error)error(dr.error);
   const er=await db.from('vg_checklist_entries').delete().in('id',ids);if(er.error)error(er.error);
   return reply({ok:true,deleted:ids.length});
  }
  if(action==='report'){
   if(!head&&!viewer&&!leaderId)return reply({error:'Unauthorized'},403);
   const from=String(b.from||''),to=String(b.to||'');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Invalid reporting dates');
   const {data,error:e}=await db.from('vg_checklist_entries').select('*').match(head||viewer?{}:{leader_id:leaderId}).gte('work_date',from).lte('work_date',to).order('work_date',{ascending:false}).limit(5000);if(e)error(e);
   const ids=(data||[]).map((x:any)=>x.id);
   const proof=new Set<string>();
   for(let i=0;i<ids.length;i+=100){
    const {data:files,error:fe}=await db.from('vg_checklist_files').select('entry_id').like('mime','image/%').eq('added_by','leader').in('entry_id',ids.slice(i,i+100));
    if(fe)error(fe);
    for(const f of files||[])proof.add(f.entry_id);
   }
   const {data:definitions,error:de}=await db.from('vg_checklist_tasks').select('id,leader_id,active,frequency,work_date,start_date,end_date,created_at').match(head||viewer?{}:{leader_id:leaderId}).eq('active',true).limit(5000);
   if(de)error(de);
   const {data:edits,error:ee}=await db.from('vg_checklist_task_day_edits').select('task_id,work_date,hidden').gte('work_date',from).lte('work_date',to).limit(10000);
   if(ee)error(ee);
   const hidden=new Set((edits||[]).filter((x:any)=>x.hidden).map((x:any)=>x.task_id+'|'+x.work_date));
   const expected_task_counts:Record<string,number>={};
   const cursor=new Date(from+'T12:00:00Z'),last=new Date(to+'T12:00:00Z');
   for(let i=0;cursor<=last&&i<366;i++,cursor.setUTCDate(cursor.getUTCDate()+1)){
    const d=cursor.toISOString().slice(0,10);
    for(const t of definitions||[]){
     if(applies(t,d)&&!hidden.has(t.id+'|'+d)){
      const k=t.leader_id+'|'+d;expected_task_counts[k]=(expected_task_counts[k]||0)+1;
     }
    }
   }
    const absences=await rows('vg_checklist_absences',q=>q.match(head||viewer?{}:{leader_id:leaderId}).gte('work_date',from).lte('work_date',to));
    const attendance_stamps=await rows('vg_checklist_attendance_stamps',q=>q.match(head||viewer?{}:{leader_id:leaderId}).gte('work_date',from).lte('work_date',to).neq('status','removed'));
    for(const stamp of attendance_stamps)if(['rest_day','on_leave'].includes(stamp.status))expected_task_counts[stamp.leader_id+'|'+stamp.work_date]=0;
   const acknowledgements=await rows('vg_checklist_pending_ack',q=>q.match(head||viewer?{}:{leader_id:leaderId}).gte('work_date',from).lte('work_date',to));
    return reply({entries:data||[],evidence_entry_ids:[...proof],expected_task_counts,absences,attendance_stamps,acknowledgements});
  }
  return reply({error:'Unknown action'},400);
 }catch(e){return reply({error:(e as Error).message||'Server error'},400)}
});

