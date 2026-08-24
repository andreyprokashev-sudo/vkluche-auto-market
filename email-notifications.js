(function(){
  const form=document.querySelector('#notificationSettingsForm'),emailLabel=form?.querySelector('fieldset label:nth-of-type(2)');
  if(!form||!emailLabel)return;
  emailLabel.insertAdjacentHTML('afterend','<button class="test-email-btn" id="testEmailNotification" type="button">Отправить тестовое письмо</button><small class="test-email-status" id="testEmailStatus"></small>');
  const button=document.querySelector('#testEmailNotification'),status=document.querySelector('#testEmailStatus');
  button.addEventListener('click',async()=>{if(!window.vklucheAuth?.require(()=>button.click()))return;button.disabled=true;status.textContent='Отправляем…';const{data,error}=await window.vklucheAuth.getClient().functions.invoke('send-notifications',{body:{test:true}});button.disabled=false;if(error||data?.error){status.textContent=`Ошибка: ${data?.error||error.message}`;status.className='test-email-status error';return}status.textContent=`Письмо отправлено на ${data.email}. Проверьте также папку «Спам».`;status.className='test-email-status success'});
  async function processQueue(){if(!window.vklucheAuth?.getUser?.())return;await window.vklucheAuth.getClient().functions.invoke('send-notifications',{body:{}})}
  window.addEventListener('vkluche:auth',processQueue);window.addEventListener('vkluche:profile',processQueue);setTimeout(processQueue,2500);
})();
