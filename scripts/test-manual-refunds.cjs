/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const store=new Map(),locks=new Set(),audit=[];let checks=0,providerCalls=0,interactionWrites=0,authenticated=true,providerOutcome='COMPLETED';
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const mocks={
  'next/server':{NextResponse:{json:Response.json,redirect:(url,status)=>new Response(null,{status,headers:{Location:String(url)}})}},
  '@/lib/admin-auth':{getAdminSession:async()=>authenticated?{sub:'agent@example.test'}:null},
  '@/lib/server-data':{
    withJsonFileTransaction: async (_key, action) => action(),
    readJsonFile:async(k,f)=>structuredClone(store.get(k)??f),writeJsonFile:async(k,v)=>store.set(k,structuredClone(v)),
    tryReserveDedupeKey:async(s,k)=>{const id=s+k;if(locks.has(id))return false;locks.add(id);return true;},releaseDedupeKey:async(s,k)=>locks.delete(s+k),
  },
  '@/lib/frasers-plus-merchant-state':{recordAdminAuditEvent:async e=>audit.push(e)},
  '@/lib/checkout-interactions':{updateCheckoutInteractionStatus:async()=>{interactionWrites++;}},
  '@/lib/backoffice-provider-refunds':{validateProviderRefund:async()=>null,processProviderRefund:async()=>{providerCalls++;return {outcome:providerOutcome,reference:'refund-test',detail:'Synthetic provider refund'};}},
};
const cache=new Map();
function load(spec){
  if(mocks[spec])return mocks[spec];
  if(!spec.startsWith('@/'))return require(spec);
  if(cache.has(spec))return cache.get(spec).exports;
  let file=path.join(__dirname,'../src',spec.slice(2));file+=fs.existsSync(file+'.ts')?'.ts':'.tsx';
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};cache.set(spec,module);
  vm.runInNewContext(source,{require:load,module,exports:module.exports,process:{env:{APP_DATA_STORE:'memory'}},Response,Request,URL,Date,Intl,Buffer,console,fetch(){throw Error('External calls forbidden');}},{filename:file});
  return module.exports;
}
const base={id:'refund-fixture',sourcePaymentId:'VCHRGD-REFUND-FIXTURE',currentPaymentId:'VCHRGD-REFUND-FIXTURE',sourceKind:'payment',provider:'CARD',paymentChoice:'card',createdAt:'2026-09-01T10:00:00Z',updatedAt:'2026-09-01T10:00:00Z',originalAmount:935,amendedAmount:1181,balanceDue:246,surveyStatus:'AWAITING_SURVEY',refundStatus:'NONE',topUpPaymentStatus:'NONE',reviewToken:'fixture-only',customerName:'Synthetic Customer',history:[],jumptech:{projectId:'fixture-project',createdAt:'2026-09-01T10:00:00Z'}};
function seed(extra={}){store.clear();locks.clear();audit.length=0;providerCalls=0;interactionWrites=0;authenticated=true;providerOutcome='COMPLETED';store.set('post-survey-workflows.json',{workflows:[structuredClone({...base,...extra})]});}
const current=()=>structuredClone(store.get('post-survey-workflows.json').workflows[0]);
const fields={workflowId:base.id,action:'manual-refund-completed',returnTo:'/backoffice?tab=orders&focusOrder=refund-fixture',refundAmount:'935.00',refundDate:'2026-09-24',refundReference:'BANK-FIXTURE',refundMethod:'BANK_TRANSFER',adminNotes:'Customer called to cancel. Full refund independently verified.',refundConfirmed:'yes',providerRefundConfirmed:'yes',providerRefundAmount:'935.00'};
function request(overrides={},origin='https://payments.example.test'){
  const data=new FormData();for(const [k,v]of Object.entries({...fields,...overrides}))if(v!==null)data.set(k,v);
  return new Request('https://payments.example.test/api/backoffice/refunds',{method:'POST',headers:{Origin:origin},body:data});
}
const lib=load('@/lib/post-survey-workflows'),route=load('@/app/api/backoffice/refunds/route'),components=load('@/components/backoffice-refund-actions');
async function main(){
  for(const stage of ['AWAITING_SURVEY','SURVEY_RECEIVED','REVIEW_READY','BALANCE_PENDING','READY_FOR_BOOKING','BOOKED_FOR_INSTALLATION','INSTALLED','DECLINED']){
    seed({surveyStatus:stage});
    const html=renderToStaticMarkup(React.createElement(components.BackofficeRefundActions,{workflow:current(),returnTo:fields.returnTo}));
    equal(html.includes('Refund processed manually'),true,stage+' has action');equal(html.includes('Move to refund queue'),true,'provider review available');
    equal((await route.POST(request())).status,303,'manual record accepted');
    const w=current();equal(w.refundStatus,'COMPLETED','refund completed');equal(w.surveyStatus,'DECLINED','closed at every stage');equal(Boolean(w.archivedAt),false,'record remains visible');
    equal(w.manualRefund.amount,935,'excludes unpaid extras');equal(w.manualRefund.recordedBy,'agent@example.test','actor tracked');equal(w.manualRefund.reference,'BANK-FIXTURE','reference retained');equal(w.manualRefund.refundedOn,'2026-09-24','date retained');
    equal(lib.canPayWorkflowBalance(w),false,'no balance collection');equal(lib.getOutstandingWorkflowBalance(w),0,'no outstanding flag');equal(w.topUpPaymentStatus,'CANCELLED','unpaid top-up cancelled, not marked paid');equal(providerCalls,0,'manual action makes zero provider calls');
    equal(audit[0].actor,'agent@example.test','audit identity');equal(audit[0].detail.includes('935.00 GBP'),true,'audit amount');
    const done=renderToStaticMarkup(React.createElement(components.BackofficeRefundActions,{workflow:w,returnTo:fields.returnTo}));equal(done.includes('Confirm manual refund processed'),false,'completed has no repeat button');equal(done.includes('BANK-FIXTURE'),true,'refund summary');
    const oldHistory=w.history.length;
    await route.POST(request());await route.POST(request({action:'approve-refund'}));await route.POST(request({action:'request-refund'}));
    equal(providerCalls,0,'completed cannot refund again');equal(current().history.length,oldHistory,'repeated submission no duplicate history');equal(audit.length,1,'one audit completion');
    await lib.recordJumptechProjectUpdate('fixture-project','jumptech',{status:'INSTALLED'});equal(current().surveyStatus,'DECLINED','late installer update cannot reopen');
    equal(lib.getCustomerWorkflowProgress(current())[0].key,'refund','customer sees refund status');
    await lib.syncPostSurveyWorkflows([{paymentId:base.sourcePaymentId,provider:'CARD',amount:935,currency:'GBP',createdAt:base.createdAt,updatedAt:base.updatedAt,latestStatus:{status:'COMPLETED'}}],[]);
    equal(current().manualRefund.reference,'BANK-FIXTURE','manual record persists after payment sync');equal(current().surveyStatus,'DECLINED','sync cannot reopen');
    seed({surveyStatus:stage});await route.POST(request({action:'approve-refund'}));equal(providerCalls,1,'provider available at '+stage);equal(current().refundStatus,'COMPLETED','provider completion closes '+stage);equal(lib.getOutstandingWorkflowBalance(current()),0,'provider completion clears balance');
  }
  for(const invalid of [{refundConfirmed:null},{refundAmount:'1'},{refundAmount:'1181'},{refundAmount:'NaN'},{refundAmount:'-935'},{refundAmount:'935.001'},{refundDate:'2026-02-30'},{refundDate:'2099-01-01'},{refundReference:''},{refundReference:'x'.repeat(121)},{adminNotes:''},{adminNotes:'x'.repeat(2001)},{refundMethod:'BOGUS'}]){
    seed();const r=await route.POST(request(invalid));equal(new URL(r.headers.get('location')).searchParams.has('refundError'),true,'invalid input feedback');equal(current().refundStatus,'NONE','invalid cannot close');equal(providerCalls,0,'invalid cannot call provider');
  }
  seed({topUpPaymentStatus:'COMPLETED'});await route.POST(request({refundAmount:'1181'}));equal(current().manualRefund.amount,1181,'paid extras included');equal(current().topUpPaymentStatus,'COMPLETED','paid top-up history retained');
  seed({refundStatus:'REQUESTED'});await route.POST(request({action:'approve-refund'}));equal(providerCalls,1,'existing provider action works');equal(current().refundStatus,'COMPLETED','provider completion works');await route.POST(request({action:'approve-refund'}));equal(providerCalls,1,'provider completion cannot duplicate');
  seed({refundStatus:'APPROVED'});await route.POST(request());equal(current().refundStatus,'APPROVED','in-progress provider refund not overwritten');
  await route.POST(request({providerOutcomeVerified:'yes'}));equal(current().refundStatus,'COMPLETED','verified dashboard completion may be recorded without sending money');equal(providerCalls,0,'dashboard reconciliation no provider call');
  seed({refundStatus:'APPROVED',refundProviderResult:'FAILED'});await route.POST(request());equal(current().refundStatus,'COMPLETED','manual recovery after failed refund');
  seed();equal((await route.POST(request({},'https://evil.example'))).status,403,'CSRF blocked');authenticated=false;equal(new URL((await route.POST(request())).headers.get('location')).pathname,'/backoffice/login','login required');equal(current().refundStatus,'NONE','unauth no writes');
  seed();await Promise.all([route.POST(request()),route.POST(request())]);equal(audit.length,1,'concurrent manual submissions deduplicated');equal(providerCalls,0,'concurrent no provider calls');
  seed();await route.POST(request({returnTo:'https://evil.example'}));equal(new URL((await route.POST(request({returnTo:'https://evil.example'}))).headers.get('location')).origin,'https://payments.example.test','redirect stays internal');
  for(const invalid of [{providerRefundConfirmed:null},{providerRefundAmount:'1'},{adminNotes:''}]){seed();await route.POST(request({action:'approve-refund',...invalid}));equal(providerCalls,0,'provider confirmation enforced');equal(current().refundStatus,'NONE','invalid provider confirmation no changes');}
  for(const outcome of ['PENDING','UNKNOWN','FAILED']){
    seed();providerOutcome=outcome;await route.POST(request({action:'approve-refund'}));equal(current().refundStatus,'APPROVED','not prematurely completed');equal(current().refundProviderResult,outcome,'outcome preserved');equal(Boolean(current().refundCompletedAt),false,'no false completion time');
    if(outcome!=='FAILED'){await route.POST(request({action:'approve-refund'}));equal(providerCalls,1,'pending/unknown refund cannot repeat');}
    providerOutcome='COMPLETED';await route.POST(request({action:'check-provider-refund'}));equal(current().refundStatus,'COMPLETED','status reconciliation completes');
  }
  seed();await Promise.all([route.POST(request({action:'approve-refund'})),route.POST(request({action:'approve-refund'}))]);equal(providerCalls,1,'concurrent provider submissions send once');
  seed();const clean=await route.POST(request({returnTo:fields.returnTo+'&refundError=old'}));equal(new URL(clean.headers.get('location')).searchParams.has('refundError'),false,'successful action clears old error');
  const source=fs.readFileSync(path.join(__dirname,'../src/app/admin/page.tsx'),'utf8');
  for(const [start,end]of [['function SurveyWorkflowCard','function BookingWorkflowCard'],['function BookingWorkflowCard','function InstalledWorkflowCard'],['function InstalledWorkflowCard','function WorkOrderPanel']])equal(source.slice(source.indexOf(start),source.indexOf(end)).includes('<BackofficeRefundActions'),true,'shared controls in '+start);
  if(process.argv.includes('--preview')){
    seed();const cssDir=path.join(__dirname,'../.next/static/chunks');const css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
    const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif"><main style="max-width:920px;margin:auto"><p>LOCAL PREVIEW - SYNTHETIC ORDER - NO PAYMENTS</p>'+renderToStaticMarkup(React.createElement(components.BackofficeRefundActions,{workflow:current(),returnTo:fields.returnTo}))+'</main><script>document.addEventListener("submit",e=>{e.preventDefault();alert("Preview only: no refund has been issued.")})</script></body></html>';
    require('node:http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html)}).listen(3148,'127.0.0.1',()=>console.log('Synthetic preview http://localhost:3148'));
  }
  console.log(JSON.stringify({passed:checks,externalCalls:0,liveDataWrites:0}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
