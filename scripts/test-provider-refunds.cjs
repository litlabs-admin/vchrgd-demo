/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
let checks=0,session,requests,updates,paid,refund,frasers,throws,readFails;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const workflow={sourcePaymentId:'synthetic-original',currentPaymentId:'synthetic-original',originalAmount:935,amendedAmount:1181,topUpPaymentStatus:'NONE',provider:'CARD'};
function seed(processor='REVOLUT'){
  session={paymentId:workflow.sourcePaymentId,provider:'CARD',cardProcessor:processor,amount:935,currency:'GBP',providerPaymentReference:'original-provider',uniquePaymentReference:'original-frasers'};
  requests=[];updates=[];throws=false;readFails=false;
  paid=processor==='SQUARE'?{payment:{amount_money:{amount:93500,currency:'GBP'},refunded_money:{amount:0}}}:{state:'completed',amount:93500,currency:'GBP',refunded_amount:0};
  refund=processor==='SQUARE'?{refund:{id:'refund-id',status:'PENDING'}}:{id:'refund-id',state:'pending'};
  frasers={type:'CAPTURE',paymentAmount:{amount:935,currency:'GBP'},history:[]};
}
const response=(data,ok=true)=>({response:{ok,status:ok?200:500},data});
const send=async(...args)=>{requests.push(args);if(throws)throw Error('Network timeout');return response(refund);};
const mocks={
 '@/lib/frasers-plus-merchant-state':{getPaymentSessionByPaymentId:async()=>session,updateCardCheckoutStatus:async x=>updates.push(x),updateFrasersPlusPaymentState:async x=>updates.push(x)},
 '@/lib/frasers-plus-capture':{buildFrasersPlusCreditBasket:()=>[]},
 '@/lib/revolut':{refundRevolutOrder:send,retrieveRevolutOrder:async id=>response(id==='original-provider'?paid:refund,!readFails)},
 '@/lib/square':{refundSquarePayment:send,resolveSquareOrderPaymentStatus:async()=>({...response(paid,!readFails),status:'COMPLETED',paymentId:'original-provider'}),squareRequest:async(path,init)=>{eq(init.method,'GET','status check is GET');return response(refund,!readFails);}},
 '@/lib/frasers-plus':{frasersPlusRequest:async(path,init)=>{if(init.method==='PUT'){requests.push([path,JSON.parse(init.body)]);if(throws)throw Error('timeout');frasers={...frasers,type:JSON.parse(init.body).type};}return response(frasers,!readFails);}},
};
const moduleObject={exports:{}};
const source=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/lib/backoffice-provider-refunds.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(source,{require:s=>mocks[s]??require(s),module:moduleObject,exports:moduleObject.exports,console,Response,fetch(){throw Error('Live fetch forbidden');}});
const {processProviderRefund,validateProviderRefund}=moduleObject.exports;
(async()=>{
 for(const processor of ['SQUARE','REVOLUT']){
  seed(processor);eq(await validateProviderRefund(workflow),null,'eligible original payment');let result=await processProviderRefund(workflow);eq(result.outcome,'PENDING','accepted is not completed');eq(updates.length,0,'pending not marked refunded');eq(requests.length,1,'single refund request');eq(requests[0][1],935,'original amount only');
  const key=requests[0][3];await processProviderRefund(workflow);eq(requests[1][3],key,'idempotency stable');eq(key.length,40,'Square-compatible key length');
  refund=processor==='SQUARE'?{refund:{id:'refund-id',status:'COMPLETED'}}:{id:'refund-id',state:'completed'};
  result=await processProviderRefund({...workflow,refundProviderReference:'refund-id'},true);eq(result.outcome,'COMPLETED','GET confirms completion');eq(requests.length,2,'GET never resends');eq(updates[0].status,'REFUNDED','only confirmed marked refunded');
  seed(processor);throws=true;eq((await processProviderRefund(workflow)).outcome,'UNKNOWN','timeout never claimed failed/completed');eq(updates.length,0,'timeout ledger unchanged');
  seed(processor);readFails=true;eq((await processProviderRefund(workflow)).outcome,'FAILED','failed preflight');eq(requests.length,0,'failed read no transfer');
  seed(processor);paid=processor==='SQUARE'?{payment:{amount_money:{amount:90000,currency:'GBP'}}}:{state:'completed',amount:90000,currency:'GBP'};eq((await processProviderRefund(workflow)).outcome,'FAILED','amount mismatch');eq(requests.length,0,'no mismatch refund');
  seed(processor);paid=processor==='SQUARE'?{payment:{amount_money:{amount:93500,currency:'GBP'},refunded_money:{amount:100}}}:{state:'completed',amount:93500,currency:'GBP',refunded_amount:100};eq((await processProviderRefund(workflow)).outcome,'FAILED','existing partial refund protected');eq(requests.length,0,'no duplicate existing refund');
  seed(processor);refund=processor==='SQUARE'?{refund:{id:'refund-id',status:'REJECTED'}}:{id:'refund-id',state:'failed'};eq((await processProviderRefund({...workflow,refundProviderReference:'refund-id'},true)).outcome,'FAILED','confirmed failure detected');
  seed(processor);eq((await processProviderRefund(workflow,true)).outcome,'UNKNOWN','missing refund reference needs manual reconciliation');eq(requests.length,0,'status check without reference never sends money');
 }
 for(const extra of [{topUpPaymentStatus:'COMPLETED'},{currentPaymentId:'replacement'},{replacementPaymentId:'replacement'}]){seed();eq(typeof await validateProviderRefund({...workflow,...extra}),'string','separate payment reconciliation required');eq((await processProviderRefund({...workflow,...extra})).outcome,'FAILED','separate payment blocked');eq(requests.length,0,'no partial full refund');}
 for(const processor of ['MANUAL','MOCK',undefined]){seed(processor);session.cardProcessor=processor;eq(typeof await validateProviderRefund(workflow),'string','unsupported original processor blocked');}
 seed();session.amount=1;eq(typeof await validateProviderRefund(workflow),'string','ledger amount mismatch');seed();session.currency='EUR';eq(typeof await validateProviderRefund(workflow),'string','currency mismatch');
 for(const type of ['CAPTURE','AUTHORIZATION']){seed();session.provider='FRASERS_PLUS';frasers.type=type;const result=await processProviderRefund({...workflow,provider:'FRASERS_PLUS'});eq(result.outcome,'COMPLETED','Frasers verified after PUT');eq(requests[0][1].type,type==='CAPTURE'?'CREDIT':'REVERSAL','correct provider action');eq(requests.length,1,'one Frasers write');eq(updates.length,1,'Frasers completion ledger');await processProviderRefund({...workflow,provider:'FRASERS_PLUS'});eq(requests.length,1,'existing credit/reversal not repeated');}
 seed();session.provider='FRASERS_PLUS';throws=true;eq((await processProviderRefund({...workflow,provider:'FRASERS_PLUS'})).outcome,'UNKNOWN','Frasers timeout unknown');eq(updates.length,0,'Frasers timeout no completion');
 seed();session.provider='FRASERS_PLUS';eq((await processProviderRefund({...workflow,provider:'FRASERS_PLUS'},true)).outcome,'UNKNOWN','Frasers not yet refunded');eq(requests.length,0,'Frasers status check read-only');
 seed();session.provider='FRASERS_PLUS';frasers.paymentAmount.amount=100;eq((await processProviderRefund({...workflow,provider:'FRASERS_PLUS'})).outcome,'FAILED','Frasers amount mismatch');eq(requests.length,0,'Frasers mismatch no write');
 console.log(JSON.stringify({passed:checks,realProviderCalls:0,liveDataWrites:0}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
