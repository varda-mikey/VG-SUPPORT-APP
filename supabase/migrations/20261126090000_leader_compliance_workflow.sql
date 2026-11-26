-- Additive Leader Daily Checklist compliance workflow. Existing checklist data is untouched.
create table if not exists public.vg_checklist_cases (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references public.vg_checklist_leaders(id),
  work_date date not null,
  attendance_status text not null default 'working' check (attendance_status in ('working','day_off','absent','on_leave')),
  letter_type text not null check (letter_type in ('nte','non_nte')),
  subject text not null check (char_length(subject) between 3 and 200),
  details text not null check (char_length(details) between 5 and 5000),
  leader_explanation text not null default '',
  leader_signature text,
  leader_signed_at timestamptz,
  status text not null default 'issued' check (status in ('issued','responded','cleared','returned')),
  head_note text not null default '',
  head_signature text,
  head_decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vg_checklist_cases_leader_date on public.vg_checklist_cases(leader_id,work_date desc);
create index if not exists vg_checklist_cases_status on public.vg_checklist_cases(status,created_at desc);
alter table public.vg_checklist_cases enable row level security;
revoke all on public.vg_checklist_cases from anon, authenticated;

create table if not exists public.vg_checklist_case_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.vg_checklist_cases(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime text not null check (mime = 'application/pdf'),
  bytes bigint not null check (bytes between 1 and 10485760),
  added_by text not null check (added_by in ('head','leader')),
  created_at timestamptz not null default now()
);
create index if not exists vg_checklist_case_files_case on public.vg_checklist_case_files(case_id,created_at);
alter table public.vg_checklist_case_files enable row level security;
revoke all on public.vg_checklist_case_files from anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('vg-checklist-compliance','vg-checklist-compliance',false,10485760,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

-- Storage remains private; only the service-role gateway issues signed URLs.
drop policy if exists "vg compliance no direct access" on storage.objects;
create policy "vg compliance no direct access" on storage.objects for select to anon using (false);


