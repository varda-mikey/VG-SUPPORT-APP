-- Shared audits are immutable; CPAR submissions are append-only.
create table public.retail_audits (
 id uuid primary key default gen_random_uuid(), submission_key uuid not null unique,
 branch text not null, audit_date date not null, auditor text not null,
 audit_type text not null check(audit_type in ('main','kiosk')), score integer check(score between 0 and 100),
 payload jsonb not null, created_at timestamptz not null default now()
);
create table public.retail_cpar_items (
 id uuid primary key default gen_random_uuid(), audit_id uuid not null references public.retail_audits(id),
 item_key text not null, finding jsonb not null,
 status text not null default 'open' check(status in ('open','in_progress','submitted','returned','verified')),
 unique(audit_id,item_key)
);
create table public.retail_cpar_updates (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.retail_cpar_items(id),
 request_key uuid not null unique, kind text not null check(kind in ('update','submitted','returned','verified')),
 actor text not null, solution text not null default '', remarks text not null default '',
 coverage_start date, coverage_end date, due_date date, evidence jsonb not null default '[]',
 created_at timestamptz not null default clock_timestamp(),
 check(coverage_end>=coverage_start)
);
create index retail_audits_branch_date on public.retail_audits(branch,audit_date desc);
create index retail_cpar_audit on public.retail_cpar_items(audit_id);
create index retail_cpar_history on public.retail_cpar_updates(item_id,created_at);
alter table public.retail_audits enable row level security;
alter table public.retail_cpar_items enable row level security;
alter table public.retail_cpar_updates enable row level security;
revoke all on public.retail_audits,public.retail_cpar_items,public.retail_cpar_updates from public,anon,authenticated;
grant all on public.retail_audits,public.retail_cpar_items,public.retail_cpar_updates to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('retail-audit-evidence','retail-audit-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
create or replace function public.retail_audit_gateway(p_action text,p_data jsonb default '{}',p_token text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_role text; a public.retail_audits; c public.retail_cpar_items; u public.retail_cpar_updates; x jsonb; v jsonb; n integer; pts integer; mx integer; aid uuid;
begin
 select role into v_role from app_private.pr_sessions where token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex') and expires_at>now();
 if v_role is null then raise exception 'Session expired. Connect to shared records.' using errcode='28000';end if;
 if p_action='session' then return jsonb_build_object('role',v_role);end if;
 if p_action='branches' then
  select jsonb_agg(name order by name) into v from (select name from public.pr_branches where active union select branch from public.retail_audits) q;return coalesce(v,'[]');
 end if;
 if p_action='list' then
  select jsonb_agg(to_jsonb(q) order by q.audit_date desc,q.created_at desc) into v from (
   select a.id,a.branch,a.audit_date,a.auditor,a.audit_type,a.score,a.created_at,
    (select count(*) from jsonb_array_elements(a.payload->'items') it where it->>'result' in ('action','noncompliant')) as actions,
    (select count(*) from public.retail_cpar_items i where i.audit_id=a.id) as cpar_created,
    (select count(*) from public.retail_cpar_items i where i.audit_id=a.id and i.status='verified') as verified,
    (select count(*) from public.retail_cpar_items i where i.audit_id=a.id and i.status='submitted') as submitted,
    (select count(*) from jsonb_array_elements(a.payload->'items') it where it->>'result'='na') as na
   from public.retail_audits a where coalesce(p_data->>'branch','')='' or a.branch=p_data->>'branch'
  ) q;return coalesce(v,'[]');
 end if;
 if p_action='submit_audit' then
  if v_role<>'purchaser' then raise exception 'Auditor access required to submit an audit' using errcode='42501';end if;
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
  select jsonb_agg(to_jsonb(i)||jsonb_build_object('updates',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.retail_cpar_updates h where h.item_id=i.id),'[]')) order by i.item_key) into v from public.retail_cpar_items i where i.audit_id=a.id;
  return to_jsonb(a)||jsonb_build_object('cpar',coalesce(v,'[]'));
 end if;
 select * into c from public.retail_cpar_items where id=(p_data->>'item_id')::uuid for update;
 if not found then raise exception 'CPAR item not found';end if;
 if p_action='access_item' then return to_jsonb(c);end if;
 if p_action='evidence_access' then
  if not exists(select 1 from public.retail_cpar_updates h cross join lateral jsonb_array_elements(h.evidence) e where h.item_id=c.id and e->>'path'=p_data->>'path') then raise exception 'Evidence not found';end if;
  return to_jsonb(c);
 end if;
 if p_action in ('update','submitted','returned','verified') then
  select * into u from public.retail_cpar_updates where request_key=(p_data->>'request_key')::uuid;
  if found then return to_jsonb(u);end if;
  if length(trim(coalesce(p_data->>'actor','')))=0 then raise exception 'Enter your name';end if;
  if p_action in ('returned','verified') then
   if v_role<>'purchaser' then raise exception 'Auditor verification access required' using errcode='42501';end if;
   if c.status<>'submitted' then raise exception 'Only submitted solutions can be reviewed';end if;
   if coalesce(p_data->>'expected_update_id','') is distinct from (select id::text from public.retail_cpar_updates where item_id=c.id order by created_at desc,id desc limit 1) then raise exception 'This submission changed. Refresh and review the latest evidence.';end if;
   if length(trim(coalesce(p_data->>'remarks','')))=0 then raise exception 'Enter verification remarks';end if;
  else
   if c.status='verified' then raise exception 'This finding has already been verified and closed';end if;
   if length(trim(coalesce(p_data->>'solution','')))=0 then raise exception 'Enter the corrective action / solution';end if;
   if nullif(p_data->>'coverage_start','') is null or nullif(p_data->>'coverage_end','') is null or nullif(p_data->>'due_date','') is null then raise exception 'Enter date coverage and target date';end if;
   if p_action='submitted' and jsonb_array_length(coalesce(p_data->'evidence','[]'))=0 then raise exception 'Attach proof before submitting for verification';end if;
   if jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'evidence','[]'))>10 then raise exception 'Maximum 10 evidence files per update';end if;
   for x in select value from jsonb_array_elements(coalesce(p_data->'evidence','[]')) loop
    if x->>'path' not like c.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='retail-audit-evidence' and name=x->>'path') then raise exception 'Evidence must be uploaded to this finding';end if;
   end loop;
  end if;
  insert into public.retail_cpar_updates(item_id,request_key,kind,actor,solution,remarks,coverage_start,coverage_end,due_date,evidence) values(c.id,(p_data->>'request_key')::uuid,p_action,trim(p_data->>'actor'),left(coalesce(p_data->>'solution',''),6000),left(coalesce(p_data->>'remarks',''),6000),nullif(p_data->>'coverage_start','')::date,nullif(p_data->>'coverage_end','')::date,nullif(p_data->>'due_date','')::date,case when p_action in ('returned','verified') then '[]'::jsonb else coalesce(p_data->'evidence','[]') end) returning * into u;
  update public.retail_cpar_items set status=case p_action when 'update' then 'in_progress' else p_action end where id=c.id;
  return to_jsonb(u);
 end if;
 raise exception 'Unknown operation';
end $$;
revoke all on function public.retail_audit_gateway(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.retail_audit_gateway(text,jsonb,text) to service_role;
