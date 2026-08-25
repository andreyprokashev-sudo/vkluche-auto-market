import { createClient } from 'npm:@supabase/supabase-js@2'
import { maxCa } from '../max-webhook/max-ca.ts'

const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,resend=Deno.env.get('RESEND_API_KEY')!,maxToken=Deno.env.get('MAX_BOT_TOKEN')||'',from=Deno.env.get('EMAIL_FROM')||'ВКЛЮЧЕ <onboarding@resend.dev>'
const admin=createClient(url,key,{auth:{persistSession:false}})
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-cron-secret'}
const maxClient=Deno.createHttpClient({caCerts:[maxCa]})
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

async function send(to:string,subject:string,body:string,idempotency:string){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${resend}`,'content-type':'application/json','idempotency-key':idempotency},body:JSON.stringify({from,to:[to],subject,html:`<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto"><h2 style="color:#174caa">ВКЛЮЧЕ</h2><h3>${esc(subject)}</h3><p style="line-height:1.6;color:#475467">${esc(body)}</p><p><a href="https://andreyprokashev-sudo.github.io/vkluche-auto-market/">Открыть ВКЛЮЧЕ →</a></p></div>`,text:`${subject}\n\n${body}\n\nhttps://andreyprokashev-sudo.github.io/vkluche-auto-market/`})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.message||`Resend: ${response.status}`)
  return result.id
}

async function sendMax(chatId:string,subject:string,body:string){
  if(!maxToken)throw new Error('MAX_BOT_TOKEN не настроен')
  const response=await fetch(`https://platform-api2.max.ru/messages?chat_id=${encodeURIComponent(chatId)}`,{method:'POST',headers:{Authorization:maxToken,'Content-Type':'application/json'},body:JSON.stringify({text:`${subject}\n\n${body}\n\nОткрыть ВКЛЮЧЕ: https://andreyprokashev-sudo.github.io/vkluche-auto-market/`}),client:maxClient} as RequestInit)
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result?.message||`MAX: ${response.status}`);return String(result?.message?.body?.mid||result?.message?.mid||'sent')
}

async function processQueue(userId?:string){
  let query=admin.from('notification_delivery_queue').select('id,notification_id,channel,destination,attempts,notifications(title,body)').in('channel',['email','max']).eq('status','pending').lt('attempts',4).order('created_at').limit(50)
  if(userId)query=query.eq('user_id',userId)
  const{data:rows=[]}=await query;let sent=0,failed=0
  for(const row of rows as any[]){
    try{const title=row.notifications?.title||'Уведомление ВКЛЮЧЕ',body=row.notifications?.body||'';if(row.channel==='max')await sendMax(row.destination,title,body);else await send(row.destination,title,body,`notification-${row.notification_id}`);await admin.from('notification_delivery_queue').update({status:'sent',attempts:row.attempts+1,sent_at:new Date().toISOString(),last_error:null}).eq('id',row.id);sent++}
    catch(error){const attempts=row.attempts+1;await admin.from('notification_delivery_queue').update({status:attempts>=4?'failed':'pending',attempts,last_error:(error as Error).message}).eq('id',row.id);failed++}
  }
  return{processed:rows.length,sent,failed}
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  const body=await req.json().catch(()=>({})),cronSecret=req.headers.get('x-cron-secret')||''
  if(body.worker&&cronSecret){const{data:allowed}=await admin.rpc('verify_notification_worker',{p_secret:cronSecret});if(allowed)return Response.json(await processQueue(),{headers:cors})}
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'',{data:{user}}=await admin.auth.getUser(token)
  if(!user)return Response.json({error:'Войдите в аккаунт'},{status:401,headers:cors})
  if(body.test){try{const id=await send(user.email!,'Тест уведомлений ВКЛЮЧЕ','Email-уведомления подключены и готовы к работе.',`test-${user.id}-${new Date().toISOString().slice(0,13)}`);return Response.json({sent:true,id,email:user.email},{headers:cors})}catch(error){return Response.json({error:(error as Error).message},{status:400,headers:cors})}}
  return Response.json(await processQueue(user.id),{headers:cors})
})
