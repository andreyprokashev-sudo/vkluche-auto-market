const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const compare = fs.readFileSync(path.join(root, 'compare.js'), 'utf8');
let filterCalls = 0, buttons = 0;
const cars = Array.from({length:140}, (_,index)=>({id:index}));
const cards = cars.map(()=>({querySelector:selector=>selector==='[data-compare-id]'?null:{insertAdjacentHTML(){buttons++;}}}));
const context = vm.createContext({
  document:{querySelectorAll:()=>cards},
  filtered:()=>{filterCalls++;return cars;},
  escapeHtml:String, sync(){}
});
vm.runInContext(compare.slice(compare.indexOf('  function enhance()'), compare.indexOf('  new MutationObserver(enhance)')),context);
context.enhance();
assert.equal(buttons,140);
assert.equal(filterCalls,1,'A catalog render must filter once, not once per card');

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
let tick, refreshes=0;
const auction={status:'active',endsAt:2000};
const timer={textContent:''};
const timerContext=vm.createContext({
  setInterval:callback=>{tick=callback;},
  document:{hidden:false,querySelector:()=>timer,querySelectorAll:()=>[]},
  currentCar:{auction},detail:{classList:{contains:()=>true}},
  Date:{now:()=>1000},auctionLeft:()=> '00:01',
  renderAuction(){refreshes++;auction.status='awaiting_seller';},
  renderAuctionSection(){}
});
vm.runInContext(app.split('\n').find(line=>line.startsWith('setInterval(()=>')),timerContext);
for(let i=0;i<60;i++)tick();
assert.equal(refreshes,0,'Normal timer ticks must not reload auction data');
assert.equal(timer.textContent,'00:01');
auction.endsAt=900;
tick();
assert.equal(refreshes,1,'Expired auctions must still transition');
tick();
assert.equal(refreshes,1,'Completed auctions must not continually refresh');
assert.equal(timer.textContent,'Выбор продавца');
console.log('PASS: catalog filters once for 140 cards; 60 timer ticks make zero full refreshes; expiry still updates.');
