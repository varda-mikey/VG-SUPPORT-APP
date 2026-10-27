-- Shared Generals & Missions. Only the service gateway can access records.
create table if not exists app_private.mission_leaders(
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 position text not null default '', area text not null default '', photo text not null default '',
 pin_hash text not null, active boolean not null default true, created_at timestamptz not null default now());
create table if not exists app_private.mission_sessions(
 token_hash text primary key, leader_id uuid references app_private.mission_leaders(id), is_head boolean not null default false,
 expires_at timestamptz not null);
create table if not exists app_private.mission_limits(ip_key text primary key,window_start timestamptz not null,attempts int not null);
create table if not exists app_private.missions(
 id uuid primary key default gen_random_uuid(),leader_id uuid not null references app_private.mission_leaders(id),
 title text not null check(length(title) between 1 and 200),instructions text not null default '',
 cancelled boolean not null default false,kind text not null check(kind in ('daily','special')),priority text not null default 'normal' check(priority in ('normal','high','urgent')),
 start_date date not null, end_date date, due_time time not null default '17:00',weekdays int[] not null default '{1,2,3,4,5,6}',
 created_at timestamptz not null default now(),check(end_date is null or end_date>=start_date));
alter table app_private.missions add column if not exists cancelled boolean not null default false;
create table if not exists app_private.mission_checks(
 id uuid primary key default gen_random_uuid(),mission_id uuid not null references app_private.missions(id),
 work_date date not null, due_at timestamptz not null, status text not null default 'pending' check(status in ('pending','working','stuck','submitted','approved','returned')),
 remarks text not null default '',evidence text not null default '',review_note text not null default '',
 submitted_at timestamptz,approved_at timestamptz,version int not null default 0,updated_at timestamptz not null default now(),unique(mission_id,work_date));
create table if not exists app_private.mission_history(
 id bigint generated always as identity primary key,check_id uuid not null references app_private.mission_checks(id),
 actor text not null,status text not null,remarks text not null default '',evidence text not null default '',created_at timestamptz not null default now());
create index if not exists mission_leader_idx on app_private.missions(leader_id);
create index if not exists mission_due_idx on app_private.mission_checks(due_at);
alter table app_private.mission_leaders enable row level security;
alter table app_private.mission_sessions enable row level security;
alter table app_private.mission_limits enable row level security;
alter table app_private.missions enable row level security;
alter table app_private.mission_checks enable row level security;
alter table app_private.mission_history enable row level security;
revoke all on app_private.mission_leaders,app_private.mission_sessions,app_private.mission_limits,app_private.missions,app_private.mission_checks,app_private.mission_history from public,anon,authenticated;
grant all on app_private.mission_leaders,app_private.mission_sessions,app_private.mission_limits,app_private.missions,app_private.mission_checks,app_private.mission_history to service_role;
grant usage,select on sequence app_private.mission_history_id_seq to service_role;
create or replace function public.mission_gateway(p_action text,p_data jsonb default '{}',p_token text default null,p_ip text default '') returns jsonb
language plpgsql security invoker set search_path=pg_catalog,app_private,extensions as $$
declare s app_private.mission_sessions; l app_private.mission_leaders; m app_private.missions; c app_private.mission_checks;
 tok text; hash text; n int; ids uuid[]; titles text[]; title text; lid uuid; ds date; de date; tm time; days int[]; k text; st text; ans jsonb;
 today date:=(now() at time zone 'Asia/Manila')::date;
begin
 if p_action='login' then
  insert into app_private.mission_limits values(p_ip,now(),1) on conflict(ip_key) do update set
   attempts=case when mission_limits.window_start<now()-interval '15 minutes' then 1 else mission_limits.attempts+1 end,
   window_start=case when mission_limits.window_start<now()-interval '15 minutes' then now() else mission_limits.window_start end returning attempts into n;
  if n>15 then return '{"error":"Too many attempts. Try again in 15 minutes."}';end if;
  if p_data->>'role'='head' then
   if not exists(select 1 from app_private.retail_audit_config where key='password_hash' and value=encode(extensions.digest(convert_to(coalesce(p_data->>'password',''),'UTF8'),'sha256'),'hex')) then return '{"error":"Incorrect Head password. Use your existing Auditor password."}';end if;
  else
   select * into l from app_private.mission_leaders where id=(p_data->>'leader_id')::uuid and active;
   if l.id is null or l.pin_hash<>encode(extensions.digest(convert_to(coalesce(p_data->>'password',''),'UTF8'),'sha256'),'hex') then return '{"error":"Incorrect profile or access code."}';end if;
  end if;
  tok:=encode(extensions.gen_random_bytes(32),'hex');hash:=encode(extensions.digest(convert_to(tok,'UTF8'),'sha256'),'hex');
  insert into app_private.mission_sessions values(hash,l.id,p_data->>'role'='head',now()+interval '8 hours');
  delete from app_private.mission_sessions where expires_at<now();
  return jsonb_build_object('token',tok,'head',p_data->>'role'='head','leader_id',l.id,'name',coalesce(l.name,'National Retail Head'));
 end if;
 select * into s from app_private.mission_sessions where token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex') and expires_at>now();
 if s.token_hash is null then raise exception 'Session expired. Please sign in again.' using errcode='28000';end if;
 if not s.is_head and not exists(select 1 from app_private.mission_leaders where id=s.leader_id and active) then raise exception 'This profile is inactive.' using errcode='28000';end if;
 if p_action='logout' then delete from app_private.mission_sessions where token_hash=s.token_hash;return '{"ok":true}';end if;
 if p_action='save_leader' then
  if not s.is_head then raise exception 'Head access required';end if;
  if length(trim(coalesce(p_data->>'name','')))=0 or length(p_data->>'name')>100 or length(coalesce(p_data->>'photo',''))>220000 or length(coalesce(p_data->>'area',''))>100 or length(coalesce(p_data->>'position',''))>100 then raise exception 'Check profile fields';end if;
  if coalesce(p_data->>'photo','')<>'' and p_data->>'photo' !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'Use a photo upload';end if;
  if p_data->>'id' is not null then
   select * into l from app_private.mission_leaders where id=(p_data->>'id')::uuid for update;
   if l.id is null then raise exception 'Profile not found';end if;
  end if;
  if l.id is null or coalesce(p_data->>'pin','')<>'' then
   if length(coalesce(p_data->>'pin','')) not between 6 and 100 then raise exception 'Use an access code of 6 to 100 characters';end if;
   hash:=encode(extensions.digest(convert_to(p_data->>'pin','UTF8'),'sha256'),'hex');
  else hash:=l.pin_hash;end if;
  insert into app_private.mission_leaders(id,name,position,area,photo,pin_hash,active)
  values(coalesce(l.id,gen_random_uuid()),trim(p_data->>'name'),coalesce(p_data->>'position',''),coalesce(p_data->>'area',''),coalesce(p_data->>'photo',''),hash,coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,position=excluded.position,area=excluded.area,photo=excluded.photo,pin_hash=excluded.pin_hash,active=excluded.active returning * into l;
  if not l.active then
   update app_private.missions set end_date=greatest(start_date,today),cancelled=start_date>today where leader_id=l.id and kind='daily' and (end_date is null or end_date>today);
  end if;
  return jsonb_build_object('id',l.id);
 elsif p_action='add_missions' then
  if not s.is_head then raise exception 'Head access required';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_data->'leader_ids');
  select array_agg(trim(value)) into titles from jsonb_array_elements_text(p_data->'titles');
  if coalesce(array_length(ids,1),0) not between 1 and 100 or coalesce(array_length(titles,1),0) not between 1 and 50 then raise exception 'Choose people and add up to 50 tasks';end if;
  ds:=(p_data->>'start_date')::date;de:=nullif(p_data->>'end_date','')::date;tm:=(p_data->>'due_time')::time;k:=p_data->>'kind';
  select array_agg(value::int) into days from jsonb_array_elements_text(p_data->'weekdays');
  if ds<today or ds>today+366 or (de is not null and de<ds) or (de is not null and de>ds+3660) or k not in ('daily','special') or k is null or tm is null or ds is null or (k='daily' and (days is null or not days<@array[0,1,2,3,4,5,6])) then raise exception 'Check start date, end date, days and deadline';end if;
  if k='special' then de:=ds; if (ds+tm) at time zone 'Asia/Manila'<=now() then raise exception 'Set a future deadline';end if;end if;
  if length(coalesce(p_data->>'instructions',''))>4000 then raise exception 'Instructions are too long';end if;
  foreach lid in array ids loop
   if not exists(select 1 from app_private.mission_leaders where id=lid and active) then raise exception 'Select active profiles';end if;
   foreach title in array titles loop
    if length(title) not between 1 and 200 then raise exception 'Task names must have 1 to 200 characters';end if;
    insert into app_private.missions(leader_id,title,instructions,kind,priority,start_date,end_date,due_time,weekdays)
    values(lid,title,coalesce(p_data->>'instructions',''),k,coalesce(p_data->>'priority','normal'),ds,de,tm,coalesce(days,array[1,2,3,4,5,6]));
   end loop;
  end loop;
  return '{"ok":true}';
 elsif p_action='stop_mission' then
  if not s.is_head then raise exception 'Head access required';end if;
  select * into m from app_private.missions where id=(p_data->>'id')::uuid for update;
  if m.id is null or m.kind<>'daily' then raise exception 'Choose a daily mission';end if;
  update app_private.missions set end_date=greatest(start_date,today),cancelled=start_date>today where id=m.id;
  return '{"ok":true}';
 elsif p_action='update_check' then
  select x.* into c from app_private.mission_checks x join app_private.missions t on t.id=x.mission_id where x.id=(p_data->>'id')::uuid and (s.is_head or t.leader_id=s.leader_id) for update of x;
  if c.id is null then raise exception 'Task not found';end if;
  if c.version<>coalesce((p_data->>'version')::int,-1) then raise exception 'This task changed on another device. Refresh and try again.';end if;
  st:=p_data->>'status';
  if s.is_head then
   if st not in ('approved','returned') or c.status<>'submitted' then raise exception 'Review a submitted task';end if;
   if st='returned' and length(trim(coalesce(p_data->>'review_note','')))=0 then raise exception 'Add the action still needed';end if;
  else
   if c.status in ('approved','submitted') or st not in ('pending','working','stuck','submitted') then raise exception 'This task cannot be changed until reviewed';end if;
   if c.work_date>today and exists(select 1 from app_private.missions where id=c.mission_id and kind='daily') then raise exception 'Future daily tasks cannot be checked yet';end if;
  end if;
  if length(coalesce(p_data->>'remarks',''))>4000 or length(coalesce(p_data->>'review_note',''))>4000 or length(coalesce(p_data->>'evidence',''))>2000 then raise exception 'Remarks or link too long';end if;
  if coalesce(p_data->>'evidence','')<>'' and p_data->>'evidence' !~ '^https://' then raise exception 'Use an https evidence link';end if;
  update app_private.mission_checks set status=st,
   remarks=case when s.is_head then remarks else coalesce(p_data->>'remarks','') end,
   evidence=case when s.is_head then evidence else coalesce(p_data->>'evidence','') end,
   review_note=case when s.is_head then coalesce(p_data->>'review_note','') else review_note end,
   submitted_at=case when st='submitted' then now() when st='returned' then null else submitted_at end,
   approved_at=case when st='approved' then now() else null end,version=version+1,updated_at=now() where id=c.id;
  insert into app_private.mission_history(check_id,actor,status,remarks,evidence) values(c.id,case when s.is_head then 'National Retail Head' else (select name from app_private.mission_leaders where id=s.leader_id) end,st,coalesce(p_data->>case when s.is_head then 'review_note' else 'remarks' end,''),coalesce(p_data->>'evidence',''));
  return '{"ok":true}';
 elsif p_action='load' then
  -- Materialize scheduled days on demand, including days nobody signed in.
  insert into app_private.mission_checks(mission_id,work_date,due_at)
  select t.id,d::date,(d::date+t.due_time) at time zone 'Asia/Manila'
  from app_private.missions t cross join lateral generate_series(t.start_date::timestamp,
   (case when t.kind='special' then t.start_date else least(coalesce(t.end_date,today),today) end)::timestamp,interval '1 day') d
  where not t.cancelled and (s.is_head or t.leader_id=s.leader_id) and (t.kind='special' or extract(dow from d)::int=any(t.weekdays))
  on conflict(mission_id,work_date) do nothing;
  return jsonb_build_object('now',now(),'head',s.is_head,'leader_id',s.leader_id,
   'leaders',(select coalesce(jsonb_agg(to_jsonb(x)-'pin_hash' order by x.name),'[]') from app_private.mission_leaders x where s.is_head or x.id=s.leader_id),
   'missions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from app_private.missions x where s.is_head or x.leader_id=s.leader_id),
   'checks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at),'[]') from app_private.mission_checks x join app_private.missions t on t.id=x.mission_id where s.is_head or t.leader_id=s.leader_id),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at),'[]') from app_private.mission_history h join app_private.mission_checks x on x.id=h.check_id join app_private.missions t on t.id=x.mission_id where s.is_head or t.leader_id=s.leader_id));
 end if;
 raise exception 'Unknown operation';
end $$;
revoke all on function public.mission_gateway(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.mission_gateway(text,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
