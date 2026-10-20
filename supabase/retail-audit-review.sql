-- Auditor review sessions and final CPAR closure; existing branch submissions are preserved.
create table if not exists app_private.retail_audit_config(key text primary key,value text not null);
create table if not exists app_private.retail_audit_sessions(token_hash text primary key,auditor_name text not null,expires_at timestamptz not null);
create table if not exists app_private.retail_audit_login_limits(ip_key text primary key,window_start timestamptz not null,attempts integer not null);
alter table app_private.retail_audit_config enable row level security;
alter table app_private.retail_audit_sessions enable row level security;
alter table app_private.retail_audit_login_limits enable row level security;
revoke all on app_private.retail_audit_config,app_private.retail_audit_sessions,app_private.retail_audit_login_limits from public,anon,authenticated;
grant all on app_private.retail_audit_config,app_private.retail_audit_sessions,app_private.retail_audit_login_limits to service_role;
create table if not exists public.retail_cpar_closures(audit_id uuid primary key references public.retail_audits(id),auditor_name text not null,comments text not null,approved_at timestamptz not null default clock_timestamp(),snapshot jsonb not null);
alter table public.retail_cpar_closures enable row level security;
revoke all on public.retail_cpar_closures from public,anon,authenticated;
grant all on public.retail_cpar_closures to service_role;
alter table public.retail_cpar_items drop constraint if exists retail_cpar_items_status_check;
alter table public.retail_cpar_items add constraint retail_cpar_items_status_check check(status in ('open','in_progress','submitted','acknowledged','returned','verified'));
alter table public.retail_cpar_updates drop constraint if exists retail_cpar_updates_kind_check;
alter table public.retail_cpar_updates add constraint retail_cpar_updates_kind_check check(kind in ('update','submitted','acknowledged','returned','verified'));
create or replace function public.retail_audit_gateway(p_action text,p_data jsonb default '{}',p_token text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.retail_audits; c public.retail_cpar_items; u public.retail_cpar_updates; x jsonb; v jsonb; n integer; pts integer; mx integer; aid uuid; v_reviewer text; v_token text; v_attempt integer; v_closure public.retail_cpar_closures;
begin
 -- Branch updates remain passwordless. Auditor decisions require a server-validated session.
 if p_action='auditor_login' then
  if length(trim(coalesce(p_data->>'name','')))<2 or length(p_data->>'name')>100 then raise exception 'Please enter the auditor name';end if;
  insert into app_private.retail_audit_login_limits values(coalesce(p_data->>'ip','unknown'),now(),1) on conflict(ip_key) do update set
   attempts=case when retail_audit_login_limits.window_start<now()-interval '5 minutes' then 1 else retail_audit_login_limits.attempts+1 end,
   window_start=case when retail_audit_login_limits.window_start<now()-interval '5 minutes' then now() else retail_audit_login_limits.window_start end returning attempts into v_attempt;
  if v_attempt>10 then return jsonb_build_object('error','Too many attempts. Please wait five minutes.');end if;
  if not exists(select 1 from app_private.retail_audit_config where key='password_hash' and value=encode(extensions.digest(convert_to(coalesce(p_data->>'password',''),'UTF8'),'sha256'),'hex')) then return jsonb_build_object('error','Incorrect auditor password.');end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into app_private.retail_audit_sessions values(encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),trim(p_data->>'name'),now()+interval '4 hours');
  delete from app_private.retail_audit_sessions where expires_at<now();
  delete from app_private.retail_audit_login_limits where window_start<now()-interval '1 day';
  return jsonb_build_object('token',v_token,'name',trim(p_data->>'name'),'expires_at',extract(epoch from now()+interval '4 hours'));
 end if;
 if p_action in ('review_access','auditor_logout','acknowledged','returned','verified','finalize_audit') then
  select auditor_name into v_reviewer from app_private.retail_audit_sessions where token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex') and expires_at>now();
  if v_reviewer is null then raise exception 'Please enter your auditor name and password' using errcode='28000';end if;
  if p_action='review_access' then return jsonb_build_object('name',v_reviewer);end if;
  if p_action='auditor_logout' then delete from app_private.retail_audit_sessions where token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex');return '{"success":true}';end if;
 end if;
 if p_action='branches' then
  select jsonb_agg(name order by name) into v from (select name from public.pr_branches where active union select branch from public.retail_audits) q;return coalesce(v,'[]');
 end if;
 if p_action='list' then
  select jsonb_agg(to_jsonb(q) order by q.audit_date desc,q.created_at desc) into v from (
   select audit_row.id,audit_row.branch,audit_row.audit_date,audit_row.auditor,audit_row.audit_type,audit_row.score,audit_row.created_at,
    (select count(*) from jsonb_array_elements(audit_row.payload->'items') it where it->>'result' in ('action','noncompliant')) as actions,
    (select count(*) from public.retail_cpar_items i where i.audit_id=audit_row.id) as cpar_created,
    (select count(*) from public.retail_cpar_items i where i.audit_id=audit_row.id and i.status='verified') as verified,
    (select count(*) from public.retail_cpar_items i where i.audit_id=audit_row.id and i.status in ('submitted','acknowledged')) as submitted,
    (select count(*) from jsonb_array_elements(audit_row.payload->'items') it where it->>'result'='na') as na,
    (select jsonb_build_object('auditor_name',f.auditor_name,'approved_at',f.approved_at) from public.retail_cpar_closures f where f.audit_id=audit_row.id) as final_approval
   from public.retail_audits audit_row where coalesce(p_data->>'branch','')='' or audit_row.branch=p_data->>'branch'
  ) q;return coalesce(v,'[]');
 end if;
 if p_action='submit_audit' then
  select * into a from public.retail_audits where submission_key=(p_data->>'submission_key')::uuid;
  if found then return to_jsonb(a);end if;
  v:=p_data->'payload'; n:=case when p_data->>'audit_type'='main' then 45 when p_data->>'audit_type'='kiosk' then 30 else 0 end;
  if n=0 or jsonb_typeof(v->'items') is distinct from 'array' or jsonb_array_length(v->'items')<>n then raise exception 'Complete all audit checks first';end if;
  if length(trim(p_data->>'branch'))=0 or length(trim(v#>>'{fields,auditorName}'))=0 or coalesce(v#>>'{fields,auditorRole}','')='' then raise exception 'Branch and auditor details are required';end if;
  if (select count(distinct (it->>'s')||':'||(it->>'i')) from jsonb_array_elements(v->'items') it)<>n then raise exception 'Duplicate checkpoints';end if;
  pts:=0;mx:=0;
  for x in select value from jsonb_array_elements(v->'items') loop
   if coalesce(x->>'result','') not in ('compliant','action','noncompliant','na') or length(coalesce(x->>'label',''))<5 then raise exception 'Every checkpoint needs a result';end if;
   if x->>'result'<>'na' then mx:=mx+2;pts:=pts+case x->>'result' when 'compliant' then 2 when 'action' then 1 else 0 end;end if;
  end loop;
  insert into public.retail_audits(submission_key,branch,audit_date,auditor,audit_type,score,payload) values ((p_data->>'submission_key')::uuid,trim(p_data->>'branch'),(v#>>'{fields,auditDate}')::date,trim(v#>>'{fields,auditorName}'),p_data->>'audit_type',case when mx>0 then round(pts::numeric/mx*100) else null end,v) returning * into a;
  return to_jsonb(a);
 end if;
 aid:=(p_data->>'audit_id')::uuid;
 if p_action in ('get','create_cpar') then
  select * into a from public.retail_audits where id=aid;
  if not found then raise exception 'Audit not found';end if;
  if p_action='create_cpar' then
   for x in select value from jsonb_array_elements(a.payload->'items') where value->>'result' in ('action','noncompliant') loop
    insert into public.retail_cpar_items(audit_id,item_key,finding) values(a.id,(x->>'s')||':'||(x->>'i'),x) on conflict(audit_id,item_key) do nothing;
   end loop;
  end if;
  select jsonb_agg(to_jsonb(i)||jsonb_build_object('updates',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.retail_cpar_updates h where h.item_id=i.id),'[]')) order by (split_part(i.item_key,':',1))::integer,(split_part(i.item_key,':',2))::integer) into v from public.retail_cpar_items i where i.audit_id=a.id;
  return to_jsonb(a)||jsonb_build_object('cpar',coalesce(v,'[]'),'final_approval',(select to_jsonb(f) from public.retail_cpar_closures f where f.audit_id=a.id));
 end if;
 if p_action='finalize_audit' then
  select * into a from public.retail_audits where id=aid for update;
  if not found then raise exception 'Audit not found';end if;
  select * into v_closure from public.retail_cpar_closures where audit_id=aid;
  if found then return to_jsonb(v_closure);end if;
  select count(*) into n from jsonb_array_elements(a.payload->'items') it where it->>'result' in ('action','noncompliant');
  if (select count(*) from public.retail_cpar_items where audit_id=aid and status='verified')<>n or exists(select 1 from public.retail_cpar_items where audit_id=aid and status<>'verified') then raise exception 'Approve every corrective action before final approval';end if;
  if length(trim(coalesce(p_data->>'comments','')))=0 then raise exception 'Please enter final audit comments';end if;
  select jsonb_agg(jsonb_build_object('id',i.id,'finding',i.finding,'status',i.status,'updates',(select jsonb_agg(to_jsonb(h) order by h.created_at) from public.retail_cpar_updates h where h.item_id=i.id)) order by (split_part(i.item_key,':',1))::integer,(split_part(i.item_key,':',2))::integer) into v from public.retail_cpar_items i where i.audit_id=aid;
  insert into public.retail_cpar_closures(audit_id,auditor_name,comments,snapshot) values(aid,v_reviewer,left(p_data->>'comments',6000),jsonb_build_object('original_audit',to_jsonb(a),'cpar',coalesce(v,'[]'))) returning * into v_closure;
  return to_jsonb(v_closure);
 end if;
 select * into c from public.retail_cpar_items where id=(p_data->>'item_id')::uuid for update;
 if not found then raise exception 'CPAR item not found';end if;
 if p_action='access_item' then return to_jsonb(c);end if;
 if p_action='evidence_access' then
  if not exists(select 1 from public.retail_cpar_updates h cross join lateral jsonb_array_elements(h.evidence) e where h.item_id=c.id and e->>'path'=p_data->>'path') then raise exception 'Evidence not found';end if;
  return to_jsonb(c);
 end if;
 if p_action in ('update','submitted','acknowledged','returned','verified') then
  select * into u from public.retail_cpar_updates where request_key=(p_data->>'request_key')::uuid;
  if found then return to_jsonb(u);end if;
  if v_reviewer is not null then p_data:=p_data||jsonb_build_object('actor',v_reviewer);end if;
  if length(trim(coalesce(p_data->>'actor','')))=0 then raise exception 'Enter your name';end if;
  if p_action in ('acknowledged','returned','verified') then
   if c.status not in ('submitted','acknowledged') then raise exception 'Only submitted solutions can be reviewed';end if;
   if coalesce(p_data->>'expected_update_id','') is distinct from (select id::text from public.retail_cpar_updates where item_id=c.id order by created_at desc,id desc limit 1) then raise exception 'This submission changed. Refresh and review the latest evidence.';end if;
   if length(trim(coalesce(p_data->>'remarks','')))=0 then raise exception 'Enter verification remarks';end if;
  else
   if c.status='acknowledged' then raise exception 'This submission is acknowledged and awaiting final auditor decision';end if;
   if c.status='verified' then raise exception 'This finding has already been verified and closed';end if;
   if length(trim(coalesce(p_data->>'solution','')))=0 then raise exception 'Enter the corrective action / solution';end if;
   if nullif(p_data->>'coverage_start','') is null or nullif(p_data->>'coverage_end','') is null or nullif(p_data->>'due_date','') is null then raise exception 'Enter date coverage and target date';end if;
   if p_action='submitted' and jsonb_array_length(coalesce(p_data->'evidence','[]'))=0 then raise exception 'Attach proof before submitting for verification';end if;
   if jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'evidence','[]'))>10 then raise exception 'Maximum 10 evidence files per update';end if;
   for x in select value from jsonb_array_elements(coalesce(p_data->'evidence','[]')) loop
    if x->>'path' not like c.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='retail-audit-evidence' and name=x->>'path') then raise exception 'Evidence must be uploaded to this finding';end if;
   end loop;
  end if;
  insert into public.retail_cpar_updates(item_id,request_key,kind,actor,solution,remarks,coverage_start,coverage_end,due_date,evidence) values(c.id,(p_data->>'request_key')::uuid,p_action,trim(p_data->>'actor'),left(coalesce(p_data->>'solution',''),6000),left(coalesce(p_data->>'remarks',''),6000),nullif(p_data->>'coverage_start','')::date,nullif(p_data->>'coverage_end','')::date,nullif(p_data->>'due_date','')::date,case when p_action in ('acknowledged','returned','verified') then '[]'::jsonb else coalesce(p_data->'evidence','[]') end) returning * into u;
  update public.retail_cpar_items set status=case p_action when 'update' then 'in_progress' else p_action end where id=c.id;
  return to_jsonb(u);
 end if;
 raise exception 'Unknown operation';
end $$;
revoke all on function public.retail_audit_gateway(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.retail_audit_gateway(text,jsonb,text) to service_role;
