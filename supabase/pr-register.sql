-- Shared PR register. Saved requests are immutable; staff create a new request for revisions.
create schema if not exists app_private;
create or replace function app_private.pr_staff_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
select auth.uid() is not null and exists (
 select 1 from public.employees e where e.auth_user_id=auth.uid()
 and e.is_active=true and e.deleted_at is null and e.permanent_deleted_at is null
);
$$;
revoke all on function app_private.pr_staff_allowed() from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.pr_staff_allowed() to authenticated;

create table public.pr_branches (
 code text primary key check(code ~ '^[A-Z0-9-]{2,24}$'),
 name text not null unique, active boolean not null default true
);
alter table public.pr_branches enable row level security;
revoke all on public.pr_branches from public,anon,authenticated;
grant select on public.pr_branches to authenticated;
create policy pr_branches_staff_read on public.pr_branches for select to authenticated using ((select app_private.pr_staff_allowed()));
insert into public.pr_branches(code,name) values
('LPU-MAIN','LPU Main — Batangas'),('DORM1','LPU Lima — Dorm 1'),('DORM2','LPU Lima — Dorm 2'),('FIELD','LPU Lima — Field Canteen'),
('LIMA','LPU Lima — Maritime'),('DLSL','De La Salle Lipa — Food Park'),('ATENEO','Ateneo de Manila — 2GONZ'),('PUP','PUP Manila — Varda Main'),
('STJUDE','St. Jude Manila — Varda Fresh'),('BURGER-2G','Varda Burger — 2GONZ'),('LPU-DAVAO','LPU Davao — Main Canteen'),('MAPUA','Mapua Davao — Food Hall'),
('PIRATES-CAFE','Pirates’ Café'),('MATCHA-MODE','Matcha Mode'),('NATIONAL','National / Head Office');

create function public.pr_payload_valid(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; k text; n numeric;
begin
 if p is null or jsonb_typeof(p)<>'object' or jsonb_typeof(p->'fields') is distinct from 'object'
 or jsonb_typeof(p->'rows') is distinct from 'array' or octet_length(p::text)>200000 then return false; end if;
 if jsonb_array_length(p->'rows') not between 1 and 100 then return false; end if;
 if length(trim(coalesce(p#>>'{fields,preparedName}',''))) not between 2 and 150 then return false; end if;
 if coalesce(p#>>'{fields,parPeriod}','') not in ('','day','week') then return false; end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
  if jsonb_typeof(r)<>'object' or length(trim(coalesce(r->>'description',''))) not between 1 and 1000 then return false; end if;
  foreach k in array array['par','onHand','balance','qty','amount'] loop
   if coalesce(r->>k,'')<>'' then
    if (r->>k) !~ '^[0-9]+([.][0-9]+)?$' then return false; end if;
    n:=(r->>k)::numeric;
    if n<0 or n>999999999 or (k='amount' and n<>round(n,2)) then return false; end if;
   elsif k in ('qty','amount') then return false;
   end if;
  end loop;
  if (r->>'qty')::numeric<=0 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function public.pr_payload_valid(jsonb) from public,anon;
grant execute on function public.pr_payload_valid(jsonb) to authenticated;
create function public.pr_payload_total(p jsonb) returns numeric
language sql immutable security invoker set search_path='' as $$
 select coalesce(sum((r->>'amount')::numeric),0) from jsonb_array_elements(p->'rows') r;
$$;
revoke all on function public.pr_payload_total(jsonb) from public,anon;
grant execute on function public.pr_payload_total(jsonb) to authenticated;
create table public.purchase_requests (
 id bigint generated always as identity primary key,
 request_key uuid not null unique,
 branch_code text not null references public.pr_branches(code),
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid(),
 payload jsonb not null check(public.pr_payload_valid(payload)),
 pr_number text generated always as ('PR-' || case when id<1000000 then lpad(id::text,6,'0') else id::text end) stored unique,
 total numeric generated always as (public.pr_payload_total(payload)) stored
);
create index purchase_requests_branch_list on public.purchase_requests(branch_code,id desc);
alter table public.purchase_requests enable row level security;
revoke all on public.purchase_requests from public,anon,authenticated;
grant select on public.purchase_requests to authenticated;
grant insert (request_key,branch_code,payload) on public.purchase_requests to authenticated;
grant usage on sequence public.purchase_requests_id_seq to authenticated;
create policy pr_staff_read on public.purchase_requests for select to authenticated using ((select app_private.pr_staff_allowed()));
create policy pr_staff_create on public.purchase_requests for insert to authenticated with check (
 (select app_private.pr_staff_allowed()) and created_by=(select auth.uid()) and exists (select 1 from public.pr_branches b where b.code=branch_code and b.active)
);
notify pgrst,'reload schema';
