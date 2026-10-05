create or replace function public.pr_calculate_payload(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; result jsonb:='[]'; price numeric; quantity numeric; daily numeric; days numeric; stock numeric; pct numeric; gross numeric; shortage numeric; buffer numeric; suggested numeric; mode text:=coalesce(p#>>'{fields,poMode}','manual');
begin
 if mode not in ('manual','automatic') then raise exception 'Choose Manual PO or PO Automatic';end if;
 if jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'Add item lines';end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
  -- Compatibility for the original form already open in a browser: keep its explicit line amount.
  if p#>>'{fields,poMode}' is null and coalesce(r->>'unitPrice','')='' then
   if coalesce(r->>'amount','')='' or coalesce(r->>'qty','')='' then raise exception 'Enter order quantity and amount';end if;
   result:=result||jsonb_build_array(r-'balance');continue;
  end if;
  if coalesce(r->>'unitPrice','')='' then raise exception 'Enter a Unit Price for every item';end if;
  price:=(r->>'unitPrice')::numeric;
  if mode='automatic' then
   daily:=(r->>'dailyPar')::numeric; days:=(r->>'days')::numeric;
   stock:=coalesce(nullif(r->>'onHand',''),'0')::numeric;pct:=coalesce(nullif(r->>'bufferPercent',''),'0')::numeric;
   if daily is null or days is null or daily<=0 or days<=0 or daily>999999999 or days>999999999 or stock<0 or stock>999999999 or pct<0 or pct>100 then raise exception 'Enter positive Daily PAR and Days Covered, valid stock on hand and a buffer from 0 to 100 percent';end if;
   gross:=round(daily*days,3);shortage:=round(greatest(0,gross-stock),3);buffer:=round(shortage*pct/100,3);suggested:=round(shortage+buffer,3);
   quantity:=case when r->>'qtyOverride'='true' then (r->>'qty')::numeric else suggested end;
   r:=r||jsonb_build_object('dailyPar',daily::text,'days',days::text,'onHand',stock::text,'bufferPercent',pct::text,'gross',gross::text,'bufferQty',buffer::text,'suggested',suggested::text,'qtyOverride',coalesce(r->>'qtyOverride','false')='true');
  else quantity:=(r->>'qty')::numeric;end if;
  if price is null or quantity is null or price<0 or price>999999999 or price<>round(price,2) or quantity<=0 or quantity>999999999 then raise exception 'Enter a valid unit price and positive final order quantity. Remove items that need no order.';end if;
  r:=(r-'balance')||jsonb_build_object('unitPrice',price::text,'qty',quantity::text,'amount',round(price*quantity,2)::text);
  result:=result||jsonb_build_array(r);
 end loop;
 return jsonb_set(p,'{rows}',result);
end;$$;
revoke all on function public.pr_calculate_payload(jsonb) from public,anon,authenticated;
grant execute on function public.pr_calculate_payload(jsonb) to service_role;
notify pgrst,'reload schema';
