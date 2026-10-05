-- API operations are mediated by the gateway's scoped, expiring sessions.
revoke all on public.purchase_requests,public.pr_branches from authenticated,anon;
revoke usage on sequence public.purchase_requests_id_seq from authenticated;
grant all on public.purchase_requests,public.pr_branches to service_role;
grant usage on sequence public.purchase_requests_id_seq to service_role;
alter table public.purchase_requests alter column created_by drop not null;
alter table public.purchase_requests add column status text not null default 'pending' check(status in ('pending','approved','declined')),
 add column original_payload jsonb, add column decided_at timestamptz, add column approver_name text,
 add column signature_data text, add column decision_note text;
create index pr_status_branch_list on public.purchase_requests(status,branch_code,id desc);
create table app_private.pr_config(key text primary key,value text not null);
create table app_private.pr_sessions(token_hash text primary key,role text not null check(role in ('creator','purchaser')),expires_at timestamptz not null);
create table app_private.pr_login_limits(ip_key text primary key,window_start timestamptz not null,attempts integer not null);
alter table app_private.pr_config enable row level security;
alter table app_private.pr_sessions enable row level security;
alter table app_private.pr_login_limits enable row level security;
revoke all on app_private.pr_config,app_private.pr_sessions,app_private.pr_login_limits from public,anon,authenticated;
grant usage on schema app_private to service_role;
grant all on app_private.pr_config,app_private.pr_sessions,app_private.pr_login_limits to service_role;
create or replace function public.pr_gateway(p_action text,p_data jsonb default '{}',p_token text default null,p_password text default null,p_ip text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_role text; v_token text; v_rec public.purchase_requests; v_payload jsonb; v_id bigint; v_rows jsonb; v_status text; v_branch text; v_attempt integer; v_count integer;
begin
 if p_action='login' then
  v_role:=p_data->>'role';
  if v_role not in ('creator','purchaser') then raise exception 'Invalid access type';end if;
  insert into app_private.pr_login_limits values (p_ip||v_role,now(),1) on conflict(ip_key) do update set
   attempts=case when pr_login_limits.window_start<now()-interval '5 minutes' then 1 else pr_login_limits.attempts+1 end,
   window_start=case when pr_login_limits.window_start<now()-interval '5 minutes' then now() else pr_login_limits.window_start end returning attempts into v_attempt;
  if v_attempt>20 then return jsonb_build_object('error','Too many attempts. Please wait five minutes.');end if;
  if not exists(select 1 from app_private.pr_config where key=v_role||'_password_hash' and value=encode(extensions.digest(convert_to(coalesce(p_password,''),'UTF8'),'sha256'),'hex')) then
   return jsonb_build_object('error','Incorrect password.');end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into app_private.pr_sessions values(encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_role,now()+interval '8 hours');
  delete from app_private.pr_sessions where expires_at<now();
  delete from app_private.pr_login_limits where window_start<now()-interval '1 day';
  return jsonb_build_object('token',v_token,'role',v_role,'expires_at',extract(epoch from now()+interval '8 hours'));
 end if;
 select role into v_role from app_private.pr_sessions where token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex') and expires_at>now();
 if v_role is null then raise exception 'Session expired. Please reconnect.' using errcode='28000';end if;
 if p_action='logout' then delete from app_private.pr_sessions where token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex');return '{"success":true}';end if;
 if p_action='branches' then
  select jsonb_agg(to_jsonb(b)||jsonb_build_object('count',(select count(*) from public.purchase_requests r where r.branch_code=b.code and (coalesce(p_data->>'status','')='' or r.status=p_data->>'status'))) order by b.name) into v_rows from public.pr_branches b where active;
  return coalesce(v_rows,'[]');
 end if;
 if p_action='list' then
  v_branch:=coalesce(p_data->>'branch','');v_status:=coalesce(p_data->>'status','');
  select jsonb_agg(to_jsonb(q)) into v_rows from (select id,pr_number,branch_code,status,created_at,total,payload#>>'{fields,supplier}' as supplier,payload#>>'{fields,preparedName}' as prepared_name
   from public.purchase_requests where (v_branch='' or branch_code=v_branch) and (v_status='' or status=v_status)
   and (coalesce(p_data->>'search','')='' or pr_number ilike '%'||left(p_data->>'search',40)||'%')
   order by id desc limit 26 offset greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000))) q;
  return coalesce(v_rows,'[]');
 end if;
 if p_action='get' then select * into v_rec from public.purchase_requests where id=(p_data->>'id')::bigint;if not found then raise exception 'Request not found';end if;return to_jsonb(v_rec);end if;
 if p_action='save' then
  v_payload:=p_data->'payload';
  v_payload:=jsonb_set(v_payload,'{fields}',(v_payload->'fields')||'{"pr":"","approvedName":"","approvedPosition":"","approvedSignature":"","approvedDate":""}'::jsonb);
  if not public.pr_payload_valid(v_payload) then raise exception 'Complete the branch, preparer, item descriptions, positive quantities and valid amounts.';end if;
  if not exists(select 1 from public.pr_branches where code=p_data->>'branch' and active) then raise exception 'Choose a valid branch';end if;
  insert into public.purchase_requests(request_key,branch_code,payload,original_payload) values((p_data->>'request_key')::uuid,p_data->>'branch',v_payload,v_payload)
   on conflict(request_key) do nothing returning * into v_rec;
  if not found then select * into v_rec from public.purchase_requests where request_key=(p_data->>'request_key')::uuid;end if;
  return to_jsonb(v_rec);
 end if;
 if p_action='decide' then
  if v_role<>'purchaser' then raise exception 'Purchaser access required' using errcode='42501';end if;
  select * into v_rec from public.purchase_requests where id=(p_data->>'id')::bigint for update;
  if not found then raise exception 'Request not found';end if;
  if v_rec.status<>'pending' then raise exception 'This request has already been decided. Refresh the record.';end if;
  v_status:=p_data->>'status';if v_status not in ('approved','declined') then raise exception 'Choose Approve or Decline';end if;
  if char_length(trim(coalesce(p_data->>'approver',''))) not between 2 and 120 then raise exception 'Enter the approver name';end if;
  if v_status='declined' and length(trim(coalesce(p_data->>'note','')))<2 then raise exception 'Enter the reason for declining';end if;
  v_payload:=coalesce(p_data->'payload',v_rec.payload);
  if not public.pr_payload_valid(v_payload) then raise exception 'Invalid edited request. Check quantities and amounts.';end if;
  if v_status='approved' and (coalesce(p_data->>'signature','') !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' or length(coalesce(p_data->>'signature',''))>700000) then raise exception 'Upload a PNG or JPEG signature before approving';end if;
  v_payload:=jsonb_set(v_payload,'{fields}',(v_payload->'fields')||case when v_status='approved' then jsonb_build_object('approvedName',p_data->>'approver','approvedPosition',left(coalesce(p_data->>'position','Purchaser / Approver'),120),'approvedDate',to_char(now() at time zone 'Asia/Manila','YYYY-MM-DD'),'approvedSignature','') else '{"approvedName":"","approvedPosition":"","approvedDate":"","approvedSignature":""}'::jsonb end);
  update public.purchase_requests set status=v_status,payload=v_payload,original_payload=coalesce(original_payload,payload),decided_at=now(),approver_name=trim(p_data->>'approver'),signature_data=case when v_status='approved' then p_data->>'signature' end,decision_note=left(p_data->>'note',2000) where id=v_rec.id returning * into v_rec;
  return to_jsonb(v_rec);
 end if;
 raise exception 'Unknown operation';
end;$$;
revoke all on function public.pr_gateway(text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.pr_gateway(text,jsonb,text,text,text) to service_role;
notify pgrst,'reload schema';
