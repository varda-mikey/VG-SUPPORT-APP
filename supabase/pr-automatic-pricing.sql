-- Normalize totals on the server too, so all previews, lists and PDFs agree.
create or replace function public.pr_calculate_payload(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; result jsonb:='[]'; price numeric; quantity numeric;
begin
 if jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'Add item lines';end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
  if coalesce(r->>'unitPrice','')='' or coalesce(r->>'qty','')='' then raise exception 'Enter Unit Price and Request Qty for every item. Refresh the form if Unit Price is missing.';end if;
  price:=(r->>'unitPrice')::numeric;quantity:=(r->>'qty')::numeric;
  if price<0 or price>999999999 or price<>round(price,2) or quantity<=0 or quantity>999999999 then raise exception 'Enter a valid unit price (up to two decimals) and positive request quantity';end if;
  r:=(r-'balance')||jsonb_build_object('unitPrice',price::text,'qty',quantity::text,'amount',round(price*quantity,2)::text);
  result:=result||jsonb_build_array(r);
 end loop;
 return jsonb_set(p,'{rows}',result);
end;$$;
revoke all on function public.pr_calculate_payload(jsonb) from public,anon,authenticated;
grant execute on function public.pr_calculate_payload(jsonb) to service_role;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.pr_gateway(text,jsonb,text,text,text)'::regprocedure);
 definition:=replace(definition,'v_payload:=p_data->''payload'';','v_payload:=public.pr_calculate_payload(p_data->''payload'');');
 definition:=replace(definition,'v_payload:=coalesce(p_data->''payload'',v_rec.payload);','v_payload:=case when v_status=''approved'' then public.pr_calculate_payload(coalesce(p_data->''payload'',v_rec.payload)) else v_rec.payload end;');
 execute definition;
end $$;
notify pgrst,'reload schema';
