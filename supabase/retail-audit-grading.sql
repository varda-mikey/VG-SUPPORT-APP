-- Coverage is separate from the immutable recorded percentage.
create or replace function public.retail_audit_coverage(r public.retail_audits) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('required',case r.audit_type when 'main' then 68 else 54 end,
 'assessed',(select count(*) from jsonb_array_elements(r.payload->'items') x where x->>'result' in ('compliant','action','noncompliant','na')),
 'complete',jsonb_array_length(r.payload->'items')=case r.audit_type when 'main' then 68 else 54 end and not exists(select 1 from jsonb_array_elements(r.payload->'items') x where coalesce(x->>'result','') not in ('compliant','action','noncompliant','na')),
 'revised_by',(select id from public.retail_audits child where child.payload->>'revision_of'=r.id::text order by created_at desc limit 1));
$$;
revoke all on function public.retail_audit_coverage(public.retail_audits) from public,anon,authenticated;
grant execute on function public.retail_audit_coverage(public.retail_audits) to service_role;

do $change$ declare definition text; begin definition:=pg_get_functiondef('public.retail_audit_gateway(text,jsonb,text)'::regprocedure);if position($new$select public.retail_audit_coverage(audit_row) as coverage,audit_row.id,audit_row.branch,$new$ in definition)=0 then if position($old$select audit_row.id,audit_row.branch,$old$ in definition)=0 then raise exception 'Gateway patch target missing';end if;definition:=replace(definition,$old$select audit_row.id,audit_row.branch,$old$,$new$select public.retail_audit_coverage(audit_row) as coverage,audit_row.id,audit_row.branch,$new$);execute definition;end if;end $change$;

do $change$ declare definition text; begin definition:=pg_get_functiondef('public.retail_audit_gateway(text,jsonb,text)'::regprocedure);if position($new$return to_jsonb(a)||jsonb_build_object('coverage',public.retail_audit_coverage(a),'cpar',$new$ in definition)=0 then if position($old$return to_jsonb(a)||jsonb_build_object('cpar',$old$ in definition)=0 then raise exception 'Gateway patch target missing';end if;definition:=replace(definition,$old$return to_jsonb(a)||jsonb_build_object('cpar',$old$,$new$return to_jsonb(a)||jsonb_build_object('coverage',public.retail_audit_coverage(a),'cpar',$new$);execute definition;end if;end $change$;

do $change$ declare definition text; begin definition:=pg_get_functiondef('public.retail_audit_gateway(text,jsonb,text)'::regprocedure);if position($new$  v:=p_data->'payload';
  if coalesce(v->>'revision_of','')<>'' then
   select * into a from public.retail_audits where id=(v->>'revision_of')::uuid for update;
   if not found then raise exception 'Original audit not found';end if;
   if a.branch is distinct from trim(p_data->>'branch') or a.audit_type is distinct from p_data->>'audit_type' or a.audit_date is distinct from (v#>>'{fields,auditDate}')::date then raise exception 'A revision must keep the same branch, inspection date and audit type';end if;
   if exists(select 1 from public.retail_cpar_closures where audit_id=a.id) then raise exception 'Closed audits cannot be revised; start a new inspection';end if;
   if exists(select 1 from public.retail_audits where payload->>'revision_of'=a.id::text) then raise exception 'This audit already has a completed revision';end if;
   if coalesce(v->>'template_version','')<>'2026-10-expanded-fsqa-v1' then raise exception 'Complete the expanded audit template';end if;
  end if;$new$ in definition)=0 then if position($old$  v:=p_data->'payload';$old$ in definition)=0 then raise exception 'Gateway patch target missing';end if;definition:=replace(definition,$old$  v:=p_data->'payload';$old$,$new$  v:=p_data->'payload';
  if coalesce(v->>'revision_of','')<>'' then
   select * into a from public.retail_audits where id=(v->>'revision_of')::uuid for update;
   if not found then raise exception 'Original audit not found';end if;
   if a.branch is distinct from trim(p_data->>'branch') or a.audit_type is distinct from p_data->>'audit_type' or a.audit_date is distinct from (v#>>'{fields,auditDate}')::date then raise exception 'A revision must keep the same branch, inspection date and audit type';end if;
   if exists(select 1 from public.retail_cpar_closures where audit_id=a.id) then raise exception 'Closed audits cannot be revised; start a new inspection';end if;
   if exists(select 1 from public.retail_audits where payload->>'revision_of'=a.id::text) then raise exception 'This audit already has a completed revision';end if;
   if coalesce(v->>'template_version','')<>'2026-10-expanded-fsqa-v1' then raise exception 'Complete the expanded audit template';end if;
  end if;$new$);execute definition;end if;end $change$;

do $change$ declare definition text; begin definition:=pg_get_functiondef('public.retail_audit_gateway(text,jsonb,text)'::regprocedure);if position($new$  if found then return to_jsonb(v_closure);end if;
  if not (public.retail_audit_coverage(a)->>'complete')::boolean then raise exception 'Complete all expanded audit checks before final approval';end if;
  if coalesce(public.retail_audit_coverage(a)->>'revised_by','')<>'' then raise exception 'Use the completed audit revision for final approval';end if;$new$ in definition)=0 then if position($old$  if found then return to_jsonb(v_closure);end if;$old$ in definition)=0 then raise exception 'Gateway patch target missing';end if;definition:=replace(definition,$old$  if found then return to_jsonb(v_closure);end if;$old$,$new$  if found then return to_jsonb(v_closure);end if;
  if not (public.retail_audit_coverage(a)->>'complete')::boolean then raise exception 'Complete all expanded audit checks before final approval';end if;
  if coalesce(public.retail_audit_coverage(a)->>'revised_by','')<>'' then raise exception 'Use the completed audit revision for final approval';end if;$new$);execute definition;end if;end $change$;
