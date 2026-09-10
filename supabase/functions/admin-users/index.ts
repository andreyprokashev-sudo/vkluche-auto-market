import { createClient } from 'npm:@supabase/supabase-js@2'

const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version','access-control-allow-methods':'POST,OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405)
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')
  if(!token)return reply({error:'authentication_required'},401)
  const sessionClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}})
  const{data:{user:actor},error:authError}=await sessionClient.auth.getUser(token)
  if(authError||!actor)return reply({error:'invalid_session'},401)
  const{data:actorProfile}=await admin.from('profiles').select('role').eq('id',actor.id).maybeSingle()
  if(actorProfile?.role!=='admin')return reply({error:'admin_required'},403)

  let body:any={};try{body=await req.json()}catch{return reply({error:'invalid_json'},400)}
  const action=String(body.action||'list')
  if(action==='list'){
    const page=Math.max(1,Math.min(1000,Number(body.page)||1)),perPage=Math.max(1,Math.min(100,Number(body.perPage)||100))
    const{data:userPage,error}=await admin.auth.admin.listUsers({page,perPage});if(error)return reply({error:error.message},500)
    const users=userPage.users||[],ids=users.map(user=>user.id)
    const[profilesResult,membersResult,organizationsResult,preferencesResult]=await Promise.all([
      ids.length?admin.from('profiles').select('id,name,phone,city,role,account_type,created_at').in('id',ids):Promise.resolve({data:[]}),
      ids.length?admin.from('organization_members').select('user_id,organization_id,member_role,active,organizations(name)').in('user_id',ids).eq('active',true):Promise.resolve({data:[]}),
      admin.from('organizations').select('id,name,inn').order('name'),
      ids.length?admin.from('notification_preferences').select('user_id,max_enabled,max_chat_id,telegram_enabled,telegram_chat_id').in('user_id',ids):Promise.resolve({data:[]})
    ])
    const profiles=new Map((profilesResult.data||[]).map((row:any)=>[row.id,row])),preferences=new Map((preferencesResult.data||[]).map((row:any)=>[row.user_id,row])),members=new Map<string,any[]>()
    for(const row of membersResult.data||[]){const list=members.get(row.user_id)||[];list.push(row);members.set(row.user_id,list)}
    return reply({users:users.map(user=>{const profile=profiles.get(user.id)||{},prefs=preferences.get(user.id)||{};return{id:user.id,email:user.email||'',name:profile.name||user.user_metadata?.name||'',phone:profile.phone||'',city:profile.city||'',role:profile.role||'user',account_type:profile.account_type||'private',created_at:user.created_at,last_sign_in_at:user.last_sign_in_at,email_confirmed_at:user.email_confirmed_at,banned_until:user.banned_until,max_connected:Boolean(prefs.max_enabled&&prefs.max_chat_id),telegram_connected:Boolean(prefs.telegram_enabled&&prefs.telegram_chat_id),organizations:members.get(user.id)||[]}}),organizations:organizationsResult.data||[],page,hasMore:users.length===perPage})
  }

  const targetId=String(body.userId||'');if(!targetId)return reply({error:'user_required'},400)
  if(targetId===actor.id&&['block','set_role'].includes(action))return reply({error:'Нельзя заблокировать себя или изменить собственную роль'},400)
  const log=async(details:Record<string,unknown>)=>admin.from('admin_user_actions').insert({admin_id:actor.id,target_user_id:targetId,action,details})
  if(action==='block'||action==='unblock'){
    if(action==='block'){const{count}=await admin.from('profiles').select('id',{count:'exact',head:true}).eq('role','admin');const{data:target}=await admin.from('profiles').select('role').eq('id',targetId).maybeSingle();if(target?.role==='admin'&&(count||0)<=1)return reply({error:'Нельзя заблокировать единственного администратора'},400)}
    const{error}=await admin.auth.admin.updateUserById(targetId,{ban_duration:action==='block'?'876000h':'none'});if(error)return reply({error:error.message},400)
    await log({reason:String(body.reason||'')});return reply({ok:true})
  }
  if(action==='set_role'){
    const role=String(body.role||'');if(!['user','admin'].includes(role))return reply({error:'invalid_role'},400)
    const{data:target}=await admin.from('profiles').select('role').eq('id',targetId).maybeSingle();if(target?.role==='admin'&&role!=='admin'){const{count}=await admin.from('profiles').select('id',{count:'exact',head:true}).eq('role','admin');if((count||0)<=1)return reply({error:'Нельзя понизить единственного администратора'},400)}
    const{error}=await admin.from('profiles').update({role}).eq('id',targetId);if(error)return reply({error:error.message},400);await log({role});return reply({ok:true})
  }
  if(action==='set_account_type'){
    const accountType=String(body.accountType||'');if(!['private','professional'].includes(accountType))return reply({error:'invalid_account_type'},400)
    const{error}=await admin.from('profiles').update({account_type:accountType}).eq('id',targetId);if(error)return reply({error:error.message},400);await log({account_type:accountType});return reply({ok:true})
  }
  if(action==='add_to_organization'){
    const organizationId=String(body.organizationId||''),memberRole=String(body.memberRole||'viewer');if(!organizationId||!['owner','administrator','manager','viewer'].includes(memberRole))return reply({error:'invalid_membership'},400)
    const{error}=await admin.from('organization_members').upsert({organization_id:organizationId,user_id:targetId,member_role:memberRole,active:true},{onConflict:'organization_id,user_id'});if(error)return reply({error:error.message},400)
    await admin.from('profiles').update({account_type:'professional'}).eq('id',targetId);await log({organization_id:organizationId,member_role:memberRole});return reply({ok:true})
  }
  if(action==='remove_from_organization'){
    const organizationId=String(body.organizationId||'');const{data:membership}=await admin.from('organization_members').select('member_role').eq('organization_id',organizationId).eq('user_id',targetId).maybeSingle();if(membership?.member_role==='owner')return reply({error:'Сначала передайте права владельца компании'},400)
    const{error}=await admin.from('organization_members').update({active:false}).eq('organization_id',organizationId).eq('user_id',targetId);if(error)return reply({error:error.message},400);await log({organization_id:organizationId});return reply({ok:true})
  }
  return reply({error:'unknown_action'},400)
})
