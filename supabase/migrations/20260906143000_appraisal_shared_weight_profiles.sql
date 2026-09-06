create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.appraisal_weight_profiles (
  position text primary key,
  weights jsonb not null,
  is_custom boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'System default',
  constraint appraisal_position_format check (
    char_length(position) between 1 and 55 and position = upper(position)
  ),
  constraint appraisal_weights_shape check (
    jsonb_typeof(weights) = 'array' and jsonb_array_length(weights) = 10
  )
);

alter table public.appraisal_weight_profiles enable row level security;
revoke all on table public.appraisal_weight_profiles from anon, authenticated;
grant select on table public.appraisal_weight_profiles to anon, authenticated;

drop policy if exists "Appraisal profiles are publicly readable"
on public.appraisal_weight_profiles;
create policy "Appraisal profiles are publicly readable"
on public.appraisal_weight_profiles for select
to anon, authenticated
using (true);

create table if not exists app_private.appraisal_sync_config (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamptz not null default now()
);
revoke all on table app_private.appraisal_sync_config from public, anon, authenticated;

insert into app_private.appraisal_sync_config(setting_key, setting_value)
values ('sync_key_sha256', '238736a5a7d5725879bf66a4b7adce25874edbfd0e7f6f3b8d09af3a11bc9e37')
on conflict (setting_key) do update
set setting_value=excluded.setting_value, updated_at=now();

with seed as (
  select key as position, value as weights
  from jsonb_each(
    '{"NATIONAL RETAIL HEAD":[5,15,15,10,10,10,10,15,5,5],
      "REGIONAL RETAIL HEAD":[7,14,14,12,10,10,10,13,5,5],
      "ADMIN OFFICER":[10,20,15,5,5,10,15,10,5,5],
      "ADMIN ASSISTANT":[12,20,15,5,5,10,15,8,5,5],
      "FSQA OFFICER":[8,18,12,5,25,8,8,8,4,4],
      "INVENTORY HEAD":[8,20,15,5,10,10,10,12,5,5],
      "INVENTORY ANALYST":[10,22,16,4,10,8,10,10,5,5],
      "KITCHEN LEADER":[8,15,15,5,20,10,8,10,5,4],
      "ASST. KITCHEN LEADER":[10,15,15,5,20,10,8,8,5,4],
      "KITCHEN COOK":[10,20,18,5,22,10,5,4,3,3],
      "KITCHEN HELPER":[15,15,20,5,20,10,5,3,4,3],
      "FRONT LEADER":[10,15,15,20,5,10,10,8,4,3],
      "ASST. FRONT LEADER":[10,15,15,20,5,10,10,8,4,3],
      "CASHIER":[12,18,15,20,5,8,7,5,5,5],
      "SERVER":[12,15,15,25,8,10,5,3,4,3],
      "MAINTENANCE / JANITOR":[12,20,20,10,10,10,5,5,4,4],
      "KIOSK OIC":[10,15,15,20,10,10,8,5,4,3],
      "KIOSK PARTNER":[12,15,18,22,8,10,5,3,4,3],
      "CATERING LIAISON SUPERVISOR":[10,15,15,20,10,10,10,5,3,2]}'::jsonb
  )
)
insert into public.appraisal_weight_profiles(position, weights, is_custom, updated_by)
select position, weights, false, 'Published system default'
from seed
on conflict (position) do nothing;

create or replace function public.save_appraisal_weight_profile(
  p_position text,
  p_weights jsonb,
  p_updated_by text,
  p_sync_key text
)
returns public.appraisal_weight_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_position text;
  v_editor text;
  v_count integer;
  v_total integer;
  v_valid boolean;
  v_result public.appraisal_weight_profiles;
begin
  if not exists (
    select 1 from app_private.appraisal_sync_config
    where setting_key='sync_key_sha256'
      and setting_value=encode(
        extensions.digest(convert_to(coalesce(p_sync_key,''),'UTF8'),'sha256'),
        'hex'
      )
  ) then
    raise exception 'Invalid Management Sync Key' using errcode='42501';
  end if;

  v_position := upper(
    regexp_replace(trim(coalesce(p_position,'')), '[[:space:]]+', ' ', 'g')
  );
  v_editor := left(trim(coalesce(p_updated_by,'')), 60);

  if char_length(v_position) not between 1 and 55 then
    raise exception 'Position name must contain 1 to 55 characters';
  end if;
  if char_length(v_editor) < 2 then
    raise exception 'Updated-by name is required';
  end if;
  if jsonb_typeof(p_weights) <> 'array' or jsonb_array_length(p_weights) <> 10 then
    raise exception 'Weights must contain exactly 10 values';
  end if;

  select count(*)::integer,
         coalesce(sum((item.value #>> '{}')::integer),0)::integer,
         bool_and(
           jsonb_typeof(item.value)='number'
           and (item.value #>> '{}') ~ '^[0-9]+$'
           and (item.value #>> '{}')::integer between 0 and 100
         )
  into v_count, v_total, v_valid
  from jsonb_array_elements(p_weights) item(value);

  if v_count <> 10 or not coalesce(v_valid,false) or v_total <> 100 then
    raise exception 'Weights must be whole numbers from 0 to 100 totaling exactly 100';
  end if;

  insert into public.appraisal_weight_profiles(
    position, weights, is_custom, updated_at, updated_by
  )
  values (v_position, p_weights, true, now(), v_editor)
  on conflict (position) do update
  set weights=excluded.weights,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.save_appraisal_weight_profile(text,jsonb,text,text)
from public;
grant execute on function public.save_appraisal_weight_profile(text,jsonb,text,text)
to anon, authenticated;
