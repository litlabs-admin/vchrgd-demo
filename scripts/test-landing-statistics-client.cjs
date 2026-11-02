const {readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const code=readFileSync(path.join(__dirname,'../public/home-charging/analytics.js'),'utf8');
function client({gpc=false,hidden=false,blocked=false}={}){let time=0;const sent=[],values=new Map(),session=new Map(),listeners={},timers=[];const control={addEventListener:(_,fn)=>listeners.toggle=fn},status={};
 const store=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 const doc={visibilityState:hidden?'hidden':'visible',querySelector:s=>s==='#statistics-toggle'?control:status,querySelectorAll:()=>[],addEventListener:(k,fn)=>listeners[k]=fn};
 class Element{constructor(){this.classList={contains:k=>k==='checkout'};this.href='https://payments.vchrgd.app/';}closest(s){return s==='a'?this:s==='.hero-actions'?{}:null;}}
 const context={document:doc,navigator:{globalPrivacyControl:gpc},crypto:{randomUUID},performance:{now:()=>time},Date,JSON,URL,Element,location:{origin:'https://payments.vchrgd.app'},window:{addEventListener:(k,fn)=>listeners[k]=fn},fetch:async(_,o)=>{sent.push(JSON.parse(o.body));},setInterval:fn=>{timers.push(fn);return 1;},clearInterval:()=>{}};
 if(blocked){Object.defineProperty(context,'localStorage',{get(){throw Error('blocked');}});Object.defineProperty(context,'sessionStorage',{get(){throw Error('blocked');}});}else Object.assign(context,{localStorage:store(values),sessionStorage:store(session)});
 vm.runInNewContext(code,context);return{sent,values,advance(ms){time+=ms;timers.forEach(fn=>fn());},click(){listeners.click({target:new Element()});},toggle(){listeners.toggle();},doc,listeners};}
let c=client();assert.deepEqual(c.sent.map(p=>p.event),['page_view']);assert.equal(c.values.size,0);c.advance(9000);assert.equal(c.sent.length,1);c.advance(1000);assert.equal(c.sent[1].event,'page_engaged');c.click();c.click();assert.equal(c.sent.filter(p=>p.event==='checkout_hero').length,2);assert.notEqual(c.sent.at(-1).eventId,c.sent.at(-2).eventId);assert(c.sent.every(p=>Object.keys(p).sort().join(',')==='event,eventId,pageId'));
let h=client({hidden:true});h.advance(20000);assert.equal(h.sent.length,1);h.click();assert(h.sent.some(p=>p.event==='page_engaged'));
let o=client();o.toggle();const before=o.sent.length;o.click();o.advance(20000);assert.equal(o.sent.length,before);assert.equal(o.values.size,1);assert(o.values.has('vchrgd_site_statistics_off'));
assert.equal(client({gpc:true}).sent.length,0);assert.equal(client({blocked:true}).sent[0].event,'page_view');

console.log('PASS: landing statistics client: no persistent visitor IDs, visible-time engagement, repeat clicks, opt-out, GPC and blocked storage.');
