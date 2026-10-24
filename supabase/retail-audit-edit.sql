-- Auditor-only revisions preserve the original report and its CPAR history.
-- Patch the existing invoker function without changing grants or table policies.
do $patch$
declare definition text; old_guard text := $old$if p_action in ('review_access','auditor_logout','assess_risk','acknowledged','returned','verified','finalize_audit') then$old$;
new_guard text := $new$if p_action in ('review_access','auditor_logout','assess_risk','acknowledged','returned','verified','finalize_audit') or (p_action='submit_audit' and coalesce(p_data#>>'{payload,revision_of}','')<>'') then$new$;
old_revision text := $old$if coalesce(v->>'template_version','')<>'2026-10-expanded-fsqa-v1' then raise exception 'Complete the expanded audit template';end if;$old$;
new_revision text := $new$if coalesce(v->>'template_version','')<>'2026-10-expanded-fsqa-v1' then raise exception 'Complete the expanded audit template';end if;
   v:=v||jsonb_build_object('edited_by',v_reviewer,'edited_at',clock_timestamp());$new$;
begin
 definition:=pg_get_functiondef('public.retail_audit_gateway(text,jsonb,text)'::regprocedure);
 if position(new_guard in definition)=0 then
  if position(old_guard in definition)=0 then raise exception 'Unexpected audit gateway auth definition';end if;
  definition:=replace(definition,old_guard,new_guard);
 end if;
 if position(new_revision in definition)=0 then
  if position(old_revision in definition)=0 then raise exception 'Unexpected audit revision definition';end if;
  definition:=replace(definition,old_revision,new_revision);
 end if;
 execute definition;
end $patch$;
