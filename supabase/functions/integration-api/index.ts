import { createClient } from 'npm:@supabase/supabase-js@2'
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,key,{auth:{persistSession:false}})
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-vkluche-key','access-control-allow-methods':'GET,OPTIONS'}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}})
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='GET')return response({error:'method_not_allowed'},405)
 const secret=req.headers.get('x-vkluche-key')||'';if(!secret)return response({error:'missing_api_key'},401)
 const{data:resolved,error:authError}=await admin.rpc('resolve_integration_key',{p_secret:secret});const access=resolved?.[0];if(authError||!access)return response({error:'invalid_or_inactive_api_key'},401)
 const path=new URL(req.url).pathname.split('/').filter(Boolean).pop()||'health',org=access.organization_id,started=new Date().toISOString();let data:any[]|null=[],error:any=null
 if(path==='health')return response({ok:true,provider:access.provider,organization_id:org})
 if(path==='listings')({data,error}=await admin.from('listings').select('id,external_id,status,active,vin,registration_plate,data,updated_at').eq('organization_id',org).order('updated_at',{ascending:false}).limit(1000))
 else if(path==='auctions')({data,error}=await admin.from('auctions').select('id,status,start_price,reserve_price,bid_step,starts_at,ends_at,winner_bid_id,updated_at,listings!inner(id,external_id,organization_id,data)').eq('listings.organization_id',org).order('updated_at',{ascending:false}).limit(1000))
 else if(path==='deals')({data,error}=await admin.from('auction_deals').select('id,status,amount,workflow_stage,created_at,updated_at,auctions!inner(id,listings!inner(organization_id,external_id,data))').eq('auctions.listings.organization_id',org).order('updated_at',{ascending:false}).limit(1000))
 else return response({error:'unknown_resource',resources:['health','listings','auctions','deals']},404)
 await admin.from('integration_sync_runs').insert({connection_id:access.connection_id,direction:'outbound',status:error?'error':'success',processed:data?.length||0,failed:error?1:0,error_summary:error?.message||'',started_at:started,finished_at:new Date().toISOString()})
 await admin.from('integration_connections').update({last_sync_at:new Date().toISOString(),last_error:error?.message||'',status:error?'error':'active'}).eq('id',access.connection_id)
 return error?response({error:error.message},500):response({data,count:data?.length||0,next:null})
})
