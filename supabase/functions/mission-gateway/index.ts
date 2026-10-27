const cors={'Access-Control-Allow-Origin':'https://varda-mikey.github.io','Access-Control-Allow-Headers':'content-type, apikey, authorization','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
Deno.serve(async(req:Request)=>{
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Use POST'},405);
 try{
  const raw=await req.text();if(raw.length>260000)return reply({error:'Request too large'},413);
  const b=JSON.parse(raw);if(!['login','logout','load','save_leader','add_missions','stop_mission','update_check'].includes(b.action))return reply({error:'Unknown operation'},400);
  if(b.action!=='login'&&!/^[a-f0-9]{64}$/.test(b.token||''))return reply({error:'Please sign in'},401);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
  const ipHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/mission_gateway',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_action:b.action,p_data:b.data||{},p_token:b.token||null,p_ip:ipHash})});
  const d=await r.json();if(!r.ok)return reply({error:d.message||'Could not complete request'},d.code==='28000'?401:400);return reply(d,d.error?400:200);
 }catch{return reply({error:'Unable to process request. Please retry.'},500)}
});
