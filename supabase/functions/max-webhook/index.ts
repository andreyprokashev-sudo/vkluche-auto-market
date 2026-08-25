import { createClient } from 'npm:@supabase/supabase-js@2'
import { maxCa } from './max-ca.ts'

const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,botToken=Deno.env.get('MAX_BOT_TOKEN')!,webhookSecret=Deno.env.get('MAX_WEBHOOK_SECRET')||''
const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version'}
const maxHeaders={Authorization:botToken,'Content-Type':'application/json'}
const maxClient=Deno.createHttpClient({caCerts:[maxCa]})
const fetch=(input:string|URL|Request,init:RequestInit={})=>globalThis.fetch(input,{...init,client:maxClient} as RequestInit)

async function botInfo(){const response=await fetch('https://platform-api2.max.ru/me',{headers:maxHeaders});const data=await response.json();if(!response.ok)throw new Error(data?.message||`MAX: ${response.status}`);return data}
async function send(chatId:string,text:string){const response=await fetch(`https://platform-api2.max.ru/messages?chat_id=${encodeURIComponent(chatId)}`,{method:'POST',headers:maxHeaders,body:JSON.stringify({text})});if(!response.ok)console.error('MAX message error',response.status,await response.text())}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  const body=await request.json().catch(()=>({}))
  if(body.action==='demo'&&webhookSecret&&request.headers.get('x-setup-secret')===webhookSecret){
    const email=String(body.email||'').trim().toLowerCase(),{data:users,error:userError}=await admin.auth.admin.listUsers({page:1,perPage:1000}),user=users?.users.find(item=>item.email?.toLowerCase()===email);if(userError||!user)return Response.json({error:'Пользователь не найден'},{status:404});const{data:prefs}=await admin.from('notification_preferences').select('max_enabled,max_chat_id').eq('user_id',user.id).maybeSingle();if(!prefs?.max_enabled||!prefs.max_chat_id)return Response.json({error:'MAX не подключён к этому аккаунту'},{status:400});await send(String(prefs.max_chat_id),String(body.text||'Тестовое уведомление ВКЛЮЧЕ'));return Response.json({sent:true})
  }
  if(body.action==='setup'&&webhookSecret&&request.headers.get('x-setup-secret')===webhookSecret){
    try{const webhookUrl=`${supabaseUrl}/functions/v1/max-webhook`,response=await fetch('https://platform-api2.max.ru/subscriptions',{method:'POST',headers:maxHeaders,body:JSON.stringify({url:webhookUrl,update_types:['bot_started'],secret:webhookSecret})}),result=await response.json().catch(()=>({}));if(!response.ok)return Response.json({error:result?.message||`MAX: ${response.status}`,code:response.status,details:result},{status:502});const bot=await botInfo();return Response.json({configured:true,bot:{name:bot.name,username:bot.username,user_id:bot.user_id},webhookUrl})}catch(error){return Response.json({error:(error as Error).message},{status:502})}
  }
  if(body.action==='connect'||body.action==='test'){
    const jwt=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'',{data:{user}}=await admin.auth.getUser(jwt)
    if(!user)return Response.json({error:'Войдите в аккаунт'},{status:401,headers:cors})
    if(body.action==='test'){const{data:prefs}=await admin.from('notification_preferences').select('max_enabled,max_chat_id').eq('user_id',user.id).maybeSingle();if(!prefs?.max_enabled||!prefs.max_chat_id)return Response.json({error:'Сначала подключите MAX'},{status:400,headers:cors});await send(String(prefs.max_chat_id),'Это тестовое уведомление ВКЛЮЧЕ. Канал MAX подключён и работает.');return Response.json({sent:true},{headers:cors})}
    const token=crypto.randomUUID().replaceAll('-',''),expiresAt=new Date(Date.now()+15*60*1000).toISOString()
    const{error}=await admin.from('max_connection_tokens').insert({token,user_id:user.id,expires_at:expiresAt})
    if(error)return Response.json({error:error.message},{status:400,headers:cors})
    try{const bot=await botInfo(),name=bot.username||bot.link?.split('/').pop()||bot.name;if(!name)throw new Error('MAX не вернул имя бота');return Response.json({url:`https://max.ru/${encodeURIComponent(name)}?start=${token}`,botName:bot.name||name,expiresAt},{headers:cors})}catch(error){return Response.json({error:(error as Error).message},{status:502,headers:cors})}
  }
  if(webhookSecret&&request.headers.get('x-max-bot-api-secret')!==webhookSecret)return Response.json({error:'invalid secret'},{status:401})
  if(body.update_type!=='bot_started'||!body.payload||!body.chat_id)return Response.json({ok:true})
  const{data:connection}=await admin.from('max_connection_tokens').select('*').eq('token',String(body.payload)).is('used_at',null).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(!connection){await send(String(body.chat_id),'Ссылка подключения устарела или уже использована. Вернитесь во ВКЛЮЧЕ и создайте новую.');return Response.json({ok:true})}
  await admin.from('notification_preferences').upsert({user_id:connection.user_id,max_chat_id:String(body.chat_id),max_enabled:true,updated_at:new Date().toISOString()})
  await admin.from('user_consents').insert({user_id:connection.user_id,document_code:'channel_max',document_version:'2026-08-25',granted:true,granted_at:new Date().toISOString(),metadata:{source:'max_bot',max_user_id:String(body.user?.user_id||'')}})
  await admin.from('max_connection_tokens').update({used_at:new Date().toISOString()}).eq('token',connection.token)
  await send(String(body.chat_id),'MAX подключён к ВКЛЮЧЕ. Теперь сюда могут приходить выбранные уведомления об автомобилях и аукционах. Отключить канал можно в личном кабинете.')
  return Response.json({ok:true})
})
