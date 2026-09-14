(()=>{
  const card=document.querySelector('.detail-aside .sticky-card');
  if(!card)return;
  const primary=document.createElement('div');
  primary.className='compact-aside-actions';
  ['sendMessage','showPhone','openViewing'].forEach(id=>{const item=document.getElementById(id);if(item)primary.append(item)});
  const auction=document.getElementById('auctionBox');
  (auction||card.querySelector('.seller'))?.before(primary);

  const more=document.createElement('details');
  more.className='compact-aside-more';
  more.innerHTML='<summary>Другие действия</summary><div class="compact-aside-more-body"></div>';
  const body=more.lastElementChild;
  ['openReservation','openTradeIn','historyReportButton','openConsultation','detailFav','detailCompare'].forEach(id=>{const item=document.getElementById(id);if(item)body.append(item)});
  card.querySelector('.seller')?.before(more);

  const detail=document.getElementById('carDetail');
  new MutationObserver(()=>{if(detail.classList.contains('open'))more.open=false}).observe(detail,{attributes:true,attributeFilter:['class']});
})();
