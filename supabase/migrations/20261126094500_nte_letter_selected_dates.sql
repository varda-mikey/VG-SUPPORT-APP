-- One NTE letter may cover many selected calendar dates.
create table if not exists public.vg_checklist_case_dates (
  case_id uuid not null references public.vg_checklist_cases(id) on delete cascade,
  work_date date not null,
  primary key (case_id, work_date)
);
create index if not exists vg_checklist_case_dates_date on public.vg_checklist_case_dates(work_date,case_id);
alter table public.vg_checklist_case_dates enable row level security;
revoke all on public.vg_checklist_case_dates from anon, authenticated;

insert into public.vg_checklist_case_dates(case_id,work_date)
select id,work_date from public.vg_checklist_cases
on conflict do nothing;

