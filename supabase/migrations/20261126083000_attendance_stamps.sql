create table if not exists public.vg_checklist_attendance_stamps (
  leader_id uuid not null references public.vg_checklist_leaders(id) on delete restrict,
  work_date date not null,
  status text not null check (status in ('absent','rest_day','awol','on_leave','removed')),
  note text not null default '',
  changed_by text not null default 'National Retail Head',
  changed_at timestamptz not null default clock_timestamp(),
  primary key (leader_id, work_date)
);

create table if not exists public.vg_checklist_attendance_stamp_audit (
  id bigint generated always as identity primary key,
  leader_id uuid not null references public.vg_checklist_leaders(id) on delete restrict,
  work_date date not null,
  status text not null check (status in ('absent','rest_day','awol','on_leave','removed')),
  note text not null default '',
  changed_by text not null,
  changed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp()
);

create index if not exists vg_checklist_attendance_stamp_audit_lookup
  on public.vg_checklist_attendance_stamp_audit (leader_id, work_date, recorded_at desc);

create or replace function public.vg_checklist_audit_attendance_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.vg_checklist_attendance_stamp_audit
    (leader_id, work_date, status, note, changed_by, changed_at)
  values
    (new.leader_id, new.work_date, new.status, new.note, new.changed_by, new.changed_at);
  return new;
end;
$$;

drop trigger if exists vg_checklist_attendance_stamp_audit_trigger on public.vg_checklist_attendance_stamps;
create trigger vg_checklist_attendance_stamp_audit_trigger
after insert or update on public.vg_checklist_attendance_stamps
for each row execute function public.vg_checklist_audit_attendance_stamp();

alter table public.vg_checklist_attendance_stamps enable row level security;
alter table public.vg_checklist_attendance_stamp_audit enable row level security;
revoke all on table public.vg_checklist_attendance_stamps from anon, authenticated;
revoke all on table public.vg_checklist_attendance_stamp_audit from anon, authenticated;
revoke execute on function public.vg_checklist_audit_attendance_stamp() from public, anon, authenticated;
grant all on table public.vg_checklist_attendance_stamps to service_role;
grant all on table public.vg_checklist_attendance_stamp_audit to service_role;
grant usage, select on sequence public.vg_checklist_attendance_stamp_audit_id_seq to service_role;

