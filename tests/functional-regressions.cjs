const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');

async function publication(isDraft, auctionFailure = false) {
  const fields = {saleMode:'auction',price:'1500000',reservePrice:'1600000',bidStep:'dynamic',auctionDuration:'24',autoExtend:'on',winnerMode:'highest',vin:'XTA210990Y1234567',registrationPlate:'',km:'100',year:'2020',condition:'used',body:'Седан',engineType:'petrol',city:'Самара',description:'Исправен',seller:'Тест',phone:'test'};
  const elements = new Map();
  const document = {querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {style:{},disabled:false,textContent:''});
    return elements.get(selector);
  }};
  const calls = [];
  const client = {
    from(table) { return {insert(payload) {
      calls.push({table,payload});
      return {select() {return {async single() {return {data:{id:'listing-1'}}}}}};
    }}; },
    async rpc(name, args) {
      calls.push({name,args});
      if (name === 'start_auction_v2') return auctionFailure ? {error:{message:'Тестовая ошибка запуска'}} : {data:{id:'auction-1'}};
      return {data:{id:'listing-1'}};
    }
  };
  const messages = [];
  const context = vm.createContext({
    document, FormData: class { [Symbol.iterator]() {return Object.entries(fields)[Symbol.iterator]()} },
    window:{vklucheAuth:{getClient:()=>client,getUser:()=>({id:'owner-1'})},dispatchEvent(){}},
    CustomEvent:class {}, editingCar:isDraft?{id:42,listingId:'listing-1',listingStatus:'draft',details:{}}:null,
    listingForm:{style:{}},brandSelect:{value:'Toyota'},modelSelect:{value:'Camry'},otherValue:'__other__',
    uploadedPhotos:['test-photo'],uploadedDocuments:[],equipmentSelection:new Set(),equipmentOtherValue:'',
    lastVinResult:null,cars:[],toast:message=>messages.push(message),
    draftFormData:()=>({details:{}}),auctionReadiness:()=>[],loadRemoteListings:async()=>{},
    render(){},renderAuctionSection(){},money:value=>String(value)
  });
  vm.runInContext(app.split('\n').find(line=>line.startsWith('async function startSavedListingAuction')), context);
  const start = app.indexOf('async function performPublishListing(){');
  const end = app.indexOf("document.querySelector('#viewPublished')", start);
  vm.runInContext(app.slice(start,end), context);
  await context.performPublishListing();
  const launch = calls.find(call=>call.name==='start_auction_v2');
  assert.ok(launch, 'Both new listings and saved drafts must launch their auction');
  assert.equal(launch.args.p_listing_id,'listing-1');
  assert.equal(launch.args.p_duration_minutes,1440);
  if(isDraft) assert.equal(calls[0].name,'publish_listing_draft');
  else assert.equal(calls[0].payload.data.auction,null,'An unconfirmed auction must not be persisted as active');
  assert.equal(document.querySelector('#wizardNext').disabled,false);
  assert.equal(document.querySelector('#publishSuccess h3').textContent,auctionFailure?'Объявление опубликовано!':'Аукцион запущен!');
  if(isDraft) assert.equal(context.editingCar.listingStatus,'published');
  if(auctionFailure) assert.equal(context.window.lastPublished.auction,null);
  if(auctionFailure) assert.ok(messages.some(message=>message.includes('не запущен')));
}

async function application(file, result, expectedTab) {
  let handler;
  const receipt = [], messages = [];
  let inserted;
  const submit = {disabled:false,textContent:''};
  const form = {dataset:{},addEventListener(type,callback) {handler=callback;}};
  const payload = {brandChoice:'Toyota',modelChoice:'Camry',year:'2020',mileage:'100',city:'Самара',condition:'good',phone:'test',comment:'',fullName:'Тест',email:'test@example.test',region:'Самара',employment:'other'};
  const context = vm.createContext({
    form,brandChoice:{value:'Toyota'},modelChoice:{value:'Camry'},other:'__other__',
    FormData:class {get(key){return payload[key]??null}},
    calculate:()=>({price:1500000,down:300000,months:60,rate:20,monthly:30000}),
    window:{
      vklucheAuth:{getClient:()=>({from:()=>({insert:value=>{inserted=value;return {select:()=>({single:async()=>{if(result instanceof Error)throw result;return result;}})}}})}),getUser:()=>({id:'owner'})},
      vklucheValuationPhotos:{value:()=>[{name:'test.jpg',url:'data:image/jpeg;base64,/9j/2Q=='}]},
      vklucheCurrentCar:()=>({name:'Toyota Camry',listingId:'listing'}),
      vklucheRequestReceipt:(...args)=>receipt.push(args),
      toast:message=>messages.push(message),dispatchEvent(){}
    },close(){},CustomEvent:class {}
  });
  vm.runInContext(read(file).split('\n').find(line=>line.includes("form.addEventListener('submit',async")),context);
  await handler({preventDefault(){},submitter:submit});
  assert.equal(submit.disabled,false,'The submit button must recover after every response');
  if(file==='trade-in.js') assert.equal(inserted.photos[0].name,'test.jpg','Valuation photos must be included in the saved request');
  if(result.data?.id) {assert.equal(receipt[0][1],expectedTab);assert.equal(receipt[0][0].id,result.data.id);}
  else {assert.equal(receipt.length,0,'No success receipt without confirmed persistence');assert.ok(messages.length);}
}

(async()=>{
  await publication(false);
  await publication(true);
  await publication(true,true);
  for(const [file,tab] of [['loan.js','my-credit'],['trade-in.js','my-trade-in']]) {
    await application(file,{data:{id:'request-1',status:'new'}},tab);
    await application(file,{error:{message:'Нет доступа'}},tab);
    await application(file,new Error('Соединение потеряно'),tab);
    await application(file,{data:null},tab);
  }
  console.log('PASS: 11 regression scenarios (new auction, draft auction, launch failure, credit and valuation persistence/errors).');
})().catch(error=>{console.error(error);process.exitCode=1;});
