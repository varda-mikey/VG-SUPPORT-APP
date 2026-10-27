begin;
do $$
declare head text:=repeat('a',64);staff text:=repeat('b',64);other text:=repeat('c',64);a uuid;b uuid;c uuid;mid uuid;out jsonb;today date:=(now() at time zone 'Asia/Manila')::date;failed boolean;
begin
 insert into app_private.mission_sessions values(encode(extensions.digest(head,'sha256'),'hex'),null,true,now()+interval '1 hour');
 out:=public.mission_gateway('save_leader','{"name":"QA AJ","pin":"qa-private-code","area":"QA"}',head);a:=(out->>'id')::uuid;
 out:=public.mission_gateway('save_leader','{"name":"QA Bea","pin":"qa-private-code","area":"QA"}',head);b:=(out->>'id')::uuid;
 insert into app_private.mission_sessions values(encode(extensions.digest(staff,'sha256'),'hex'),a,false,now()+interval '1 hour');
 insert into app_private.mission_sessions values(encode(extensions.digest(other,'sha256'),'hex'),b,false,now()+interval '1 hour');
 perform public.mission_gateway('add_missions',jsonb_build_object('leader_ids',jsonb_build_array(a),'titles','["Daily 1","Daily 2"]'::jsonb,'start_date',today,'kind','daily','due_time','17:00','weekdays','[0,1,2,3,4,5,6]'::jsonb),head);
 -- Offline historical days must be generated without requiring a login on those days.
 update app_private.missions set start_date=today-2 where leader_id=a;
 out:=public.mission_gateway('load','{}',staff);
 assert jsonb_array_length(out->'checks')=6,'Missing daily occurrences';
 assert jsonb_array_length(out->'leaders')=1,'Leader can see other profiles';
 assert not ((out->'leaders'->0)?'pin_hash'),'PIN hash leaked';
 out:=public.mission_gateway('load','{}',other);assert jsonb_array_length(out->'checks')=0,'Cross-person checks leaked';
 select x.id into c from app_private.mission_checks x join app_private.missions t on x.mission_id=t.id where t.leader_id=a limit 1;
 failed:=false;begin perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',0,'status','submitted'),other);exception when others then failed:=true;end;assert failed,'Other leader can update task';
 perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',0,'status','submitted','remarks','QA output'),staff);
 failed:=false;begin perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',1,'status','approved'),staff);exception when others then failed:=true;end;assert failed,'Leader approved own task';
 failed:=false;begin perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',0,'status','approved'),head);exception when others then failed:=true;end;assert failed,'Stale update accepted';
 perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',1,'status','returned','review_note','More proof'),head);
 assert (select submitted_at is null from app_private.mission_checks where id=c),'Returned task still marked complete';
 perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',2,'status','submitted'),staff);
 perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',3,'status','approved'),head);
 assert (select status='approved' and approved_at is not null from app_private.mission_checks where id=c),'Approval not saved';
 assert (select count(*)=4 from app_private.mission_history where check_id=c),'Missing activity history';
 perform public.mission_gateway('add_missions',jsonb_build_object('leader_ids',jsonb_build_array(a),'titles','["Special"]'::jsonb,'start_date',today+1,'kind','special','due_time','17:00','weekdays','[]'::jsonb),head);
 perform public.mission_gateway('load','{}',staff);
 select x.id into c from app_private.mission_checks x join app_private.missions t on x.mission_id=t.id where t.leader_id=a and t.kind='special';
 perform public.mission_gateway('update_check',jsonb_build_object('id',c,'version',0,'status','submitted'),staff);
 assert (select status='submitted' from app_private.mission_checks where id=c),'Special mission cannot finish early';
 failed:=false;begin perform public.mission_gateway('save_leader','{"name":"Unauthorized","pin":"anything"}',staff);exception when others then failed:=true;end;assert failed,'Staff can manage profiles';
 raise notice 'PASS: recurring history, isolation, submission, review, stale-write prevention, early completion and history';
end $$;
rollback;
