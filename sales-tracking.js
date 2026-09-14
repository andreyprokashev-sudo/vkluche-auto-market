(()=>{
  const detail=document.querySelector('#carDetail');if(!detail)return;let last='';
  function visitor(){let value=localStorage.getItem('vkluche-visitor-token');if(!value){value=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}-${Math.random()}`;localStorage.setItem('vkluche-visitor-token',value)}return value}
  async function record(){const car=window.vklucheCurrentCar?.();if(!car?.listingId||last===car.listingId)return;last=car.listingId;try{await window.vklucheAuth?.getClient?.().rpc('record_listing_view',{p_listing_id:car.listingId,p_visitor_token:visitor()})}catch(_){}}
  new MutationObserver(()=>{if(detail.classList.contains('open'))setTimeout(record,0);else last=''}).observe(detail,{attributes:true,attributeFilter:['class']});
})();
