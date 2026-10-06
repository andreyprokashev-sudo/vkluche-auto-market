const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const elements=new Map();
function element(){return{value:'',style:{},classList:{},addEventListener(){},replaceChildren(){this.children=[]},append(child){this.children.push(child)}}}
const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},createElement:()=>element()};
const window={addEventListener(){}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../location.js'),'utf8'),{window,document,URLSearchParams});
const show=window.vklucheLocation.showDetail,map=document.querySelector('#detailLocationMap'),link=document.querySelector('#detailMapLink');
show({city:'Москва',details:{location:{latitude:55.751244,longitude:37.618423,address:'Скрытый адрес',precision:'approximate'}}});
let url=new URL(map.children[0].src);
assert.equal(url.hostname,'yandex.ru');assert.equal(url.searchParams.get('ll'),'37.62,55.75');assert.equal(url.searchParams.has('pt'),false);
assert.ok(!link.href.includes('Скрытый'));assert.equal(map.children.length,1);
show({city:'Москва',details:{location:{latitude:55.751244,longitude:37.618423,precision:'exact'}}});
url=new URL(map.children[0].src);assert.equal(url.searchParams.get('pt'),'37.618423,55.751244,pm2blm');
assert.equal(map.children.length,1,'Switching cars replaces rather than duplicates the map');
show({city:'Ижевск',details:{location:{latitude:'bad',longitude:1800}}});
assert.equal(map.style.display,'none');assert.equal(map.children.length,0);assert.ok(link.href.includes(encodeURIComponent('Ижевск')));
console.log('PASS: map without Leaflet, approximate privacy, exact marker, card switching, invalid coordinate fallback.');
