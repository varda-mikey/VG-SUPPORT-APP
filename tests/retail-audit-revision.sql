begin;
set local role service_role;
do $test$
declare original public.retail_audits; revised public.retail_audits; payload jsonb; result jsonb; rec jsonb; token text:=repeat('d',64);
begin
 insert into app_private.retail_audit_sessions values(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),'Revision QA auditor',now()+interval '1 hour');
 select jsonb_build_object('fields',jsonb_build_object('auditDate','2026-10-20','auditorName','Revision QA','auditorRole','Retail Head'),'items',jsonb_agg(jsonb_build_object('s',0,'i',n,'label','Original checkpoint '||n,'result','compliant'))) into payload from generate_series(0,44) n;
 insert into public.retail_audits(submission_key,branch,audit_date,auditor,audit_type,score,payload) values(gen_random_uuid(),'TEST REVISION ONLY','2026-10-20','Revision QA','main',100,payload) returning * into original;
 result:=public.retail_audit_gateway('get',jsonb_build_object('audit_id',original.id),null);
 if result#>>'{coverage,complete}'<>'false' or result#>>'{coverage,assessed}'<>'45' or result#>>'{coverage,required}'<>'68' then raise exception 'FAIL old coverage';end if;
 begin perform public.retail_audit_gateway('finalize_audit',jsonb_build_object('audit_id',original.id,'comments','QA'),token);raise exception 'FAIL incomplete audit closed';exception when others then if SQLERRM not like 'Complete all expanded%' then raise;end if;end;
 select jsonb_build_object('template_version','2026-10-expanded-fsqa-v1','revision_of',original.id,'fields',payload->'fields','items',jsonb_agg(jsonb_build_object('s',s,'i',i,'label','Expanded checkpoint '||n,'result',case when n=1 then 'action' when n=3 then 'na' when n=68 then 'noncompliant' else 'compliant' end))) into payload from (select row_number() over(order by s,i) n,s,i from (select ordinality::integer-1 s,value::integer cnt from jsonb_array_elements_text('[6,13,8,6,6,6,4,11,4,4]'::jsonb) with ordinality) sections cross join lateral generate_series(0,cnt-1) i) checks;
 rec:=jsonb_build_object('submission_key',gen_random_uuid(),'branch',original.branch,'audit_type','main','payload',jsonb_set(payload,'{fields,auditDate}','"2026-10-21"'));
 begin perform public.retail_audit_gateway('submit_audit',rec,null);raise exception 'FAIL inspection date changed';exception when others then if SQLERRM not like 'A revision must keep%' then raise;end if;end;
 rec:=rec||jsonb_build_object('payload',jsonb_set(payload,'{items,67,result}','""'));
 begin perform public.retail_audit_gateway('submit_audit',rec,null);raise exception 'FAIL blank graded';exception when others then if SQLERRM<>'Every checkpoint needs a result' then raise;end if;end;
 rec:=rec||jsonb_build_object('payload',payload);result:=public.retail_audit_gateway('submit_audit',rec,null);select * into revised from public.retail_audits where id=(result->>'id')::uuid;
 if revised.score<>98 or revised.audit_date<>original.audit_date or not (public.retail_audit_coverage(revised)->>'complete')::boolean then raise exception 'FAIL revised grading';end if;
 if (select score from public.retail_audits where id=original.id)<>100 or public.retail_audit_coverage(original)->>'revised_by'<>revised.id::text then raise exception 'FAIL original history lost';end if;
 result:=public.retail_audit_gateway('submit_audit',rec,null);if result->>'id'<>revised.id::text then raise exception 'FAIL retry duplicated';end if;
 rec:=rec||jsonb_build_object('submission_key',gen_random_uuid());begin perform public.retail_audit_gateway('submit_audit',rec,null);raise exception 'FAIL duplicate revision';exception when others then if SQLERRM<>'This audit already has a completed revision' then raise;end if;end;
end $test$;
select 'PASS: incomplete old audit, server closure guard, same-day revision enforcement, blank rejection, 68-check regrading, original preservation and idempotent revision' result;
rollback;
