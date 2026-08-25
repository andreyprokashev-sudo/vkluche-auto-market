import { createClient } from 'npm:@supabase/supabase-js@2'
import { maxCa } from '../max-webhook/max-ca.ts'

const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,resend=Deno.env.get('RESEND_API_KEY')!,maxToken=Deno.env.get('MAX_BOT_TOKEN')||'',from=Deno.env.get('EMAIL_FROM')||'ВКЛЮЧЕ <onboarding@resend.dev>'
const admin=createClient(url,key,{auth:{persistSession:false}})
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-cron-secret'}
const maxClient=Deno.createHttpClient({caCerts:[maxCa]})
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

async function send(to:string,subject:string,body:string,idempotency:string){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${resend}`,'content-type':'application/json','idempotency-key':idempotency},body:JSON.stringify({from,to:[to],subject,html:`<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto"><div style="display:flex;align-items:center;gap:3px"><img src="https://andreyprokashev-sudo.github.io/vkluche-auto-market/assets/brand/vkluche-logo-wheel.png" width="48" height="48" alt="В" style="border-radius:12px"><h2 style="color:#174caa">КЛЮЧЕ</h2></div><h3>${esc(subject)}</h3><p style="line-height:1.6;color:#475467">${esc(body)}</p><p><a href="https://andreyprokashev-sudo.github.io/vkluche-auto-market/">Открыть ВКЛЮЧЕ →</a></p></div>`,text:`${subject}\n\n${body}\n\nhttps://andreyprokashev-sudo.github.io/vkluche-auto-market/`})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.message||`Resend: ${response.status}`)
  return result.id
}

function maxActions(type:string,auctionId?:string,listingId?:string){
  const listingLink=`https://andreyprokashev-sudo.github.io/vkluche-auto-market/?listing=${listingId||''}`
  if(auctionId){const openText=type==='auction_offer'?'Подтвердить решение':type==='question_received'?'Открыть вопрос':type.startsWith('inspection_')?'Открыть запись на осмотр':['auction_finished','auction_won','deal_confirmed'].includes(type)?'Открыть результат':'Открыть автомобиль',buttons:any[]=[[{type:'link',text:openText,url:listingLink}]];if(['auction_started','auction_reminder','auction_ending','auction_extended','outbid'].includes(type)){buttons.push([{type:'callback',text:'Сделать ставку',payload:`bid:${auctionId}`}]);buttons.push([{type:'callback',text:'Мне интересно',payload:`interest:${auctionId}`},{type:'callback',text:'Задать вопрос',payload:`question:${auctionId}`}])}buttons.push([{type:'callback',text:'Не уведомлять об этом лоте',payload:`mute:${auctionId}`}]);return[{type:'inline_keyboard',payload:{buttons}}]}
  if(listingId){const text=type==='new_message'?'Открыть переписку':type==='listing_moderation'?'Открыть карточку и результаты':'Открыть автомобиль',url=type==='new_message'?`${listingLink}&chat=1`:listingLink;return[{type:'inline_keyboard',payload:{buttons:[[{type:'link',text,url}]]}}]}
  return[{type:'inline_keyboard',payload:{buttons:[[{type:'link',text:'Открыть ВКЛЮЧЕ',url:'https://andreyprokashev-sudo.github.io/vkluche-auto-market/'}]]}}]
}

async function sendMax(chatId:string,subject:string,body:string,type:string,auctionId?:string,listingId?:string){
  if(!maxToken)throw new Error('MAX_BOT_TOKEN не настроен')
  const attachments=maxActions(type,auctionId,listingId)
  const response=await fetch(`https://platform-api2.max.ru/messages?chat_id=${encodeURIComponent(chatId)}`,{method:'POST',headers:{Authorization:maxToken,'Content-Type':'application/json'},body:JSON.stringify({text:`${subject}\n\n${body}`,attachments}),client:maxClient} as RequestInit)
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result?.message||`MAX: ${response.status}`);return String(result?.message?.body?.mid||result?.message?.mid||'sent')
}

async function sendTelegram(chatId:string,subject:string,body:string,type:string,auctionId?:string,listingId?:string){
  const link=listingId?`https://andreyprokashev-sudo.github.io/vkluche-auto-market/?listing=${listingId}${type==='new_message'?'&chat=1':''}`:'https://andreyprokashev-sudo.github.io/vkluche-auto-market/',button=type==='new_message'?'Открыть переписку':type==='listing_moderation'?'Открыть карточку и результаты':type.startsWith('inspection_')?'Открыть запись на осмотр':type==='question_received'?'Открыть вопрос':['auction_finished','auction_won','deal_confirmed'].includes(type)?'Открыть результат':'Открыть автомобиль',inline_keyboard:any[]=[[{text:button,url:link}]]
  if(auctionId&&['auction_started','auction_reminder','auction_ending','auction_extended','outbid'].includes(type))inline_keyboard.push([{text:'Сделать ставку',url:link}],[{text:'Мне интересно',callback_data:`interest:${auctionId}`},{text:'Задать вопрос',callback_data:`question:${auctionId}`}])
  if(auctionId)inline_keyboard.push([{text:'Не уведомлять об этом лоте',callback_data:`mute:${auctionId}`}])
  const response=await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')||''}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:`${subject}\n\n${body}`,reply_markup:{inline_keyboard}})}),result=await response.json().catch(()=>({}));if(!result.ok)throw new Error(result.description||`Telegram: ${response.status}`);return String(result.result?.message_id||'sent')
}

async function processQueue(userId?:string){
  let query=admin.from('notification_delivery_queue').select('id,notification_id,user_id,channel,destination,attempts,notifications(type,title,body,listing_id,auction_id,auctions(listing_id))').in('channel',['email','max','telegram']).eq('status','pending').lt('attempts',4).order('created_at').limit(50)
  if(userId)query=query.eq('user_id',userId)
  const{data:rows=[]}=await query;let sent=0,failed=0
  for(const row of rows as any[]){
    try{const title=row.notifications?.title||'Уведомление ВКЛЮЧЕ',body=row.notifications?.body||'',type=row.notifications?.type||'',auctionId=row.notifications?.auction_id,listingId=row.notifications?.listing_id||row.notifications?.auctions?.listing_id;if(row.channel==='max'){await sendMax(row.destination,title,body,type,auctionId,listingId);if(auctionId)await admin.from('max_bot_dialogs').upsert({chat_id:row.destination,user_id:row.user_id,current_auction_id:auctionId,current_listing_id:listingId,state:'idle',updated_at:new Date().toISOString()})}else if(row.channel==='telegram'){await sendTelegram(row.destination,title,body,type,auctionId,listingId);if(auctionId)await admin.from('telegram_bot_dialogs').upsert({chat_id:row.destination,user_id:row.user_id,current_auction_id:auctionId,current_listing_id:listingId,state:'idle',updated_at:new Date().toISOString()})}else await send(row.destination,title,body,`notification-${row.notification_id}`);await admin.from('notification_delivery_queue').update({status:'sent',attempts:row.attempts+1,sent_at:new Date().toISOString(),last_error:null}).eq('id',row.id);sent++}
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
