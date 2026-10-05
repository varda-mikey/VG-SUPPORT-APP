const cors={'Access-Control-Allow-Origin':'https://varda-mikey.github.io','Access-Control-Allow-Headers':'content-type, apikey, authorization','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return respond({error:'Use POST'},405);
 try {
  const raw=await req.text();if(raw.length>1000000)return respond({error:'Request is too large'},413);
  const body=JSON.parse(raw);if(!['login','logout','branches','list','get','save','decide'].includes(body.action))return respond({error:'Invalid operation'},400);
  if(body.action!=='login'&&(!body.token||!/^[a-f0-9]{64}$/.test(body.token)))return respond({error:'Please connect to shared records first.'},401);
  if(body.action==='login'&&(typeof body.password!=='string'||body.password.length>200))return respond({error:'Enter your password'},400);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
  const ipHash=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const result=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/pr_gateway',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_action:body.action,p_data:body.data||{},p_token:body.token||null,p_password:body.action==='login'?body.password:null,p_ip:ipHash})});
  const data=await result.json();if(!result.ok)return respond({error:data.message||'Unable to complete request'},data.code==='28000'?401:data.code==='42501'?403:400);
  if(data?.error)return respond(data,400);return respond(data);
 }catch(_e){return respond({error:'Could not process the request. Please retry.'},500)}
});
