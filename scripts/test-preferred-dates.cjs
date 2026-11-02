const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {loader} = require('./test-checkout-clicks.cjs');
const {withoutPreferredDatesPolicy} = require('./preferred-dates-source-guards.cjs');
const root = path.resolve(__dirname,'..');
const base = path.resolve(root,'../frasers-checkout-click-tracking');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const yes=(value,message)=>{assert.ok(value,message);checks++;};
const cutoff='2026-09-17T16:00:00.000Z';
const env={APP_DATA_STORE:'memory',NODE_ENV:'development',PREFERRED_INSTALLATION_DATES_DISABLED_FROM:cutoff};
async function main() {
  const walk=relative=>{
    for(const entry of fs.readdirSync(path.join(base,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,entry.name);
      if(entry.isDirectory())walk(name);
      else eq(withoutPreferredDatesPolicy(name,read(name)),fs.readFileSync(path.join(base,name),'utf8').replace(/\r\n/g,'\n'),`Unrelated source changed: ${name}`);
    }
  };
  // Historical feature-only hashes do not describe the authorized security patch.
  if (process.env.SECURITY_REGRESSION !== 'true') {
  walk('src');walk('public');
  for(const name of ['package.json','package-lock.json','vercel.json','next.config.ts','.vercelignore']) eq(read(name),fs.readFileSync(path.join(base,name),'utf8'));
  }
  const load=loader(env);
  const policy=load('@/lib/preferred-installation-dates-policy');
  eq(policy.preferredDatesEnabledForNewOrder('2026-09-17T15:59:59.999Z'),true);
  eq(policy.preferredDatesEnabledForNewOrder(cutoff),false);
  eq(policy.preferredDatesEnabledForNewOrder('2026-09-17T17:00:00+01:00'),false);
  eq(policy.preferredDatesEnabledForNewOrder('legacy-unknown'),true);
  eq(policy.preferredDatesEnabledForWorkflow({}),true);
  eq(policy.preferredDatesEnabledForWorkflow({preferredInstallationDatesEnabled:true}),true);
  eq(policy.preferredDatesEnabledForWorkflow({preferredInstallationDatesEnabled:false}),false);
  for(const flag of ['', 'invalid']) eq(loader({...env,PREFERRED_INSTALLATION_DATES_DISABLED_FROM:flag})('@/lib/preferred-installation-dates-policy').preferredDatesEnabledForNewOrder(cutoff),true);
  const store=load('@/lib/server-data');
  const workflows=load('@/lib/post-survey-workflows');
  const payment=(paymentId,createdAt,provider='CARD')=>({paymentId,createdAt,updatedAt:createdAt,provider,amount:935,customerName:'Test Customer',latestStatus:{status:'COMPLETED',updatedAt:createdAt}});
  const oldPayment=payment('OLD-PAYMENT','2026-09-16T12:00:00.000Z');
  const newCard=payment('NEW-CARD',cutoff);
  const newFrasers=payment('NEW-FRASERS',cutoff,'FRASERS_PLUS');
  let current=await workflows.syncPostSurveyWorkflows([oldPayment,newCard,newFrasers],[]);
  eq(current.find(w=>w.sourcePaymentId==='OLD-PAYMENT').preferredInstallationDatesEnabled,true,'Old order first synced after rollout is grandfathered');
  for(const id of ['NEW-CARD','NEW-FRASERS']) eq(current.find(w=>w.sourcePaymentId===id).preferredInstallationDatesEnabled,false);
  const old=current.find(w=>w.sourcePaymentId==='OLD-PAYMENT');
  delete old.preferredInstallationDatesEnabled;
  old.preferredInstallationDates=['2026-10-01'];
  await store.writeJsonFile('post-survey-workflows.json',{workflows:current});
  current=await workflows.syncPostSurveyWorkflows([oldPayment,newCard,newFrasers],[]);
  const legacy=current.find(w=>w.sourcePaymentId==='OLD-PAYMENT');
  eq(legacy.preferredInstallationDatesEnabled,undefined,'No retrospective reclassification');
  eq(Array.from(legacy.preferredInstallationDates),['2026-10-01']);
  const modern=current.find(w=>w.sourcePaymentId==='NEW-CARD');
  const before=JSON.stringify(await store.readJsonFile('post-survey-workflows.json',{}));
  await assert.rejects(()=>workflows.saveSurveyWorkflowPreferredInstallationDates(modern.id,'customer',['2026-10-03']),/not available/);checks++;
  eq(JSON.stringify(await store.readJsonFile('post-survey-workflows.json',{})),before,'Blocked writes must not mutate dates/history');
  await workflows.saveSurveyWorkflowPreferredInstallationDates(legacy.id,'customer',['2026-10-02']);
  eq(Array.from((await workflows.getPostSurveyWorkflowById(legacy.id)).preferredInstallationDates),['2026-10-02']);
  await workflows.markSurveyWorkflowBookedForInstallation(modern.id,'test',{installationDate:'2026-10-09',installerName:'Test Installer'});
  const booked=await workflows.getPostSurveyWorkflowById(modern.id);
  eq(booked.surveyStatus,'BOOKED_FOR_INSTALLATION');eq(booked.installationDate,'2026-10-09');eq(booked.preferredInstallationDates,undefined);
  await workflows.updateSurveyWorkflowChargerDispatch(modern.id,'test',{dispatched:true,expectedDeliveryDate:'2026-10-05'});
  yes((await workflows.getPostSurveyWorkflowById(modern.id)).chargerDispatchedAt,'Dispatch has no preferred date dependency');
  env.PREFERRED_INSTALLATION_DATES_DISABLED_FROM='';
  current=await workflows.syncPostSurveyWorkflows([oldPayment,newCard,newFrasers],[]);
  eq(current.find(w=>w.sourcePaymentId==='NEW-FRASERS').preferredInstallationDatesEnabled,false,'Cohort survives subsequent flag changes and syncs');
  env.PREFERRED_INSTALLATION_DATES_DISABLED_FROM=cutoff;

  let saves=0,audits=0,fixture=modern;
  const route=loader(env,{
    'next/server':{NextResponse:{json:(body,{status=200}={})=>Response.json(body,{status})}},
    '@/lib/request-guards':{isSameOriginRequest:()=>true},
    '@/lib/frasers-plus-merchant-state':{recordAdminAuditEvent:async()=>{audits++;}},
    '@/lib/post-survey-workflows':{...workflows,getPostSurveyWorkflowByToken:async()=>fixture,saveSurveyWorkflowPreferredInstallationDates:async()=>{saves++;return fixture;}},
  })('@/app/api/customer-installation-preferences/route');
  const request=()=>new Request('https://payments.vchrgd.app/api/customer-installation-preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'test-token',dates:['2027-01-01']})});
  eq((await route.POST(request())).status,409);eq(saves,0);eq(audits,0);
  fixture=legacy;eq((await route.POST(request())).status,200);eq(saves,1);eq(audits,1);

  const stub=()=>null;
  const portal=loader(env,{
    'lucide-react':{AlertTriangle:stub,CalendarDays:stub,CheckCircle2:stub,Clock3:stub,PackageCheck:stub},
    'next/navigation':{notFound:()=>{throw Error('Unexpected notFound');}},
    '@/components/cancel-order-request-dialog':{CancelOrderRequestDialog:stub},
    '@/components/payment-popup-submit-bridge':{PaymentPopupSubmitBridge:stub},
    '@/components/preferred-installation-dates-panel':{PreferredInstallationDatesPanel:()=>React.createElement('div',null,'DATE_PICKER_TEST_MARKER')},
    '@/lib/post-survey-workflows':{...workflows,getPostSurveyWorkflowByToken:async()=>fixture},
  })('@/app/survey-review/[token]/page').default;
  for(const provider of ['CARD','FRASERS_PLUS']) for(const stage of ['AWAITING_SURVEY','SURVEY_RECEIVED','REVIEW_READY','BALANCE_PENDING','READY_FOR_BOOKING','BOOKED_FOR_INSTALLATION','INSTALLED']) {
    fixture={...modern,provider,surveyStatus:stage,amendedAmount:1181,balanceDue:246,preferredInstallationDates:['2026-10-01'],installationDate:'2026-10-09',reviewToken:'test-token',reviewLinkExpiresAt:undefined};
    const html=renderToStaticMarkup(await portal({params:Promise.resolve({token:'test-token'}),searchParams:Promise.resolve({})}));
    yes(!/preferred dates|preferred installation dates|DATE_PICKER_TEST_MARKER/i.test(html),`${provider}/${stage} has no preference UX`);
    yes(html.includes('pay-balance'),`${provider}/${stage} retains outstanding payment controls`);
    yes(html.includes('2026-10-09'),`${provider}/${stage} retains confirmed installation date`);
  }
  fixture={...legacy,surveyStatus:'AWAITING_SURVEY',reviewToken:'test-token',reviewLinkExpiresAt:undefined};
  const legacyHtml=renderToStaticMarkup(await portal({params:Promise.resolve({token:'test-token'}),searchParams:Promise.resolve({})}));
  yes(legacyHtml.includes('DATE_PICKER_TEST_MARKER'));yes(legacyHtml.includes('Preferred dates'));
  function componentFromSource(file, name) {
    const ts=require('typescript');
    const vm=require('node:vm');
    const module={exports:{}};
    const source=ts.transpileModule(read(file)+`\nexport { ${name} };`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInNewContext(source,{module,exports:module.exports,process:{env},require:specifier=>{
      if(['react','react/jsx-runtime'].includes(specifier))return require(specifier);
      if(specifier==='next/link')return props=>React.createElement('a',props,props.children);
      if(specifier==='@/lib/post-survey-workflows')return workflows;
      if(specifier==='@/lib/preferred-installation-dates-policy')return policy;
      return new Proxy({}, {get:()=>stub});
    }});
    return module.exports[name];
  }
  const BookingCard=componentFromSource('src/app/admin/page.tsx','BookingWorkflowCard');
  for(const enabled of [false,true,undefined]) {
    const html=renderToStaticMarkup(React.createElement(BookingCard,{workflow:{...modern,preferredInstallationDatesEnabled:enabled,surveyStatus:'READY_FOR_BOOKING',installerName:'Test Installer'},installers:[],returnTo:'/backoffice',bookedReturnTo:'/backoffice'}));
    eq(html.includes('Preferred dates'),enabled!==false,'Back-office preferred-date field follows immutable cohort');
    yes(html.includes('Installer work order / PO'));yes(html.includes('Charger dispatch'));yes(html.includes('Mark as booked'));
  }
  const JourneyInformation=componentFromSource('src/components/integration-showcase.tsx','JourneyInformation');
  const newExplainer=renderToStaticMarkup(React.createElement(JourneyInformation,{preferredDatesEnabled:false}));
  yes(!newExplainer.includes('preferred installation dates'));yes(newExplainer.includes('contact you to arrange'));
  yes(renderToStaticMarkup(React.createElement(JourneyInformation,{preferredDatesEnabled:true})).includes('select up to three preferred installation dates'));
  console.log(`PASS: ${checks} preferred-date cohort, API, customer-portal rendering and source-protection checks; no external services called.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
