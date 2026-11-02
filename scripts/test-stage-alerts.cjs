const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baseline = path.resolve(root, '../frasers-production-selection-popup');
const read = (name, dir = root) => require('./click-source-guards.cjs').readProtected(name, dir);
const originalEnv = {...process.env};
const originalFetch = global.fetch;
const originalConsoleError = console.error;
const diagnostics = [];
console.error = (...args) => diagnostics.push(args);
const clone = value => structuredClone(value);
const store = new Map();
const reservations = new Set();
const providerMessages = new Map();
const calls = [];
const delays = [];
let writes = 0, reads = 0, fail = false, missingName = false, failReceiptWrite = false, beforeRead, failureResponse, acceptLegacyIds = false;
const mocks = {
  '@/lib/server-data': {
    withJsonFileTransaction: async (_key, action) => action(),
    readJsonFile: async (key, fallback) => { reads++; beforeRead?.(key); return clone(store.get(key) ?? fallback); },
    writeJsonFile: async (key, value) => {
      writes++;
      if (failReceiptWrite && key.startsWith('prebooking-stage-alert-') && value.sentAt) throw new Error('Write failed');
      store.set(key, clone(value));
    },
    getDataStoreMode: () => process.env.APP_DATA_STORE || 'memory',
    tryReserveDedupeKey: async (scope,key) => { const id=`${scope}:${key}`; if(reservations.has(id))return false; reservations.add(id); return true; },
    releaseDedupeKey: async (scope,key) => { reservations.delete(`${scope}:${key}`); },
  },
  'node:timers/promises': {setTimeout: async ms => { delays.push(ms); }},
  'next/server': {NextResponse: {json: (data, init) => Response.json(data, init)}},
};
const cache = new Map();
function load(name) {
  if (mocks[name]) return mocks[name];
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const filename = path.join(root, 'src', name.slice(2)) + '.ts';
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const module = {exports:{}};
  cache.set(name, module);
  new Function('require', 'module', 'exports', code)(load, module, module.exports);
  return module.exports;
}
global.fetch = async (url, init) => {
  const target = new URL(url);
  assert.equal(target.hostname, 'chat.googleapis.com', 'No provider/payment/network calls permitted');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal);
  calls.push({key:target.searchParams.get('requestId'),body:init.body});
  if (failureResponse) return Response.json(failureResponse.body, {status:failureResponse.status});
  if (fail) return Response.json({error:'unavailable'}, {status:503});
  if (missingName) return Response.json({});
  const requestId = target.searchParams.get('requestId');
  if (requestId && !acceptLegacyIds) return Response.json({error:{status:'INVALID_ARGUMENT',message:'request_id is not supported for incoming webhooks'}},{status:400});
  const key = requestId || `message-${providerMessages.size}`;
  if (!providerMessages.has(key)) providerMessages.set(key, {name:`spaces/fixture/messages/${key}`});
  return Response.json(providerMessages.get(key));
};
const logic = load('@/lib/prebooking-stage-alerts');
const clock = load('@/lib/survey-stage-clock');
const workflows = load('@/lib/post-survey-workflows');
const route = load('@/app/api/backoffice/stage-alerts/route');
const NOW = Date.parse('2026-09-16T12:00:00Z');
const SINCE = new Date(NOW - logic.PREBOOKING_ALERT_AFTER_MS).toISOString();
const base = {
  id:'fixture',sourcePaymentId:'VCHRGD-FIXTURE',currentPaymentId:'VCHRGD-FIXTURE',sourceKind:'payment',
  provider:'CARD',paymentChoice:'card',createdAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-16T11:59:59Z',
  customerName:'Test Customer',customerEmail:'test@example.com',originalAmount:935,amendedAmount:935,
  surveyStatus:'SURVEY_RECEIVED',surveyReceivedAt:SINCE,refundStatus:'NONE',topUpPaymentStatus:'NONE',history:[],
  stageClock:{status:'SURVEY_RECEIVED',enteredAt:SINCE,source:'transition'},
};
const payment = {paymentId:base.sourcePaymentId,provider:'CARD',cardProcessor:'REVOLUT',amount:935,
  createdAt:base.createdAt,updatedAt:base.updatedAt,latestStatus:{status:'COMPLETED',source:'webhook',updatedAt:base.createdAt}};
const paymentMap = new Map([[payment.paymentId, payment]]);
const stage = name => ({...clone(base),surveyStatus:name,stageClock:{...base.stageClock,status:name}});
let checks = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function yes(value, label) { assert.ok(value, label); checks++; }
async function rejects(fn, pattern) { await assert.rejects(fn, pattern); checks++; }
function reset(items=[base], payments=[payment]) {
  store.clear(); reservations.clear(); providerMessages.clear(); calls.length=0; delays.length=0; writes=0; reads=0;
  fail=false; missingName=false; failReceiptWrite=false; beforeRead=undefined; failureResponse=undefined; acceptLegacyIds=false; diagnostics.length=0;
  store.set('post-survey-workflows.json', {workflows:clone(items)});
  store.set('merchant-state.json', {sessions:clone(payments),auditEvents:[]});
  store.set('prebooking-stage-alert-activation.json',{startedAt:SINCE});
  Object.assign(process.env, {NODE_ENV:'test',APP_DATA_STORE:'memory',APP_DATA_NAMESPACE:'stage-alert-tests',
    APP_URL:'https://payments.vchrgd.app',NEXT_PUBLIC_APP_URL:'https://payments.vchrgd.app',
    PREBOOKING_STAGE_ALERTS_ENABLED:'true',PREBOOKING_STAGE_ALERTS_INCLUDE_EXISTING:'false',
    GOOGLE_CHAT_WEBHOOK_URL:'https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture'});
}
const run = options => logic.sendDuePrebookingStageAlerts({now:NOW,...options});
async function main() {
  // Replaced by the security release's explicit changed-file allowlist, not by relaxed business assertions.
  if (process.env.SECURITY_REGRESSION !== 'true') {
  // Verify the existing workflow/payment code is byte-for-byte equivalent after
  // removing only the explicit stage-clock additions.
  let source = read('src/lib/post-survey-workflows.ts');
  for (const addition of [
    'import { trackSurveyStage } from "@/lib/survey-stage-clock";\n',
    '  stageClock?: {\n    status: SurveyWorkflowStatus;\n    enteredAt: string;\n    source: "transition" | "first-observed";\n  };\n',
    '    stageClock: existing?.stageClock,\n',
    '  const previousStatus = workflow.surveyStatus;\n',
    '  trackSurveyStage(workflow, previousStatus);\n',
    '  const previousStages = new Map(state.workflows.map((workflow) => [workflow.id, workflow.surveyStatus]));\n',
    '  for (const workflow of visibleWorkflows) {\n    trackSurveyStage(workflow, previousStages.get(workflow.id));\n  }\n',
  ]) { yes(source.includes(addition)); source=source.replace(addition,''); }
  eq(source,read('src/lib/post-survey-workflows.ts',baseline),'Existing business logic changed');
  function protect(relative) {
    for (const item of fs.readdirSync(path.join(baseline,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,item.name);
      if(item.isDirectory()) protect(name);
      else if(name==='src/components/frasers-plus-promo-popup.tsx') {
        eq(read(name).replace('https://application.pay.frasers.plus/?partner=VCHRGD&template=online&location=frasersplus_webpage',
          'https://application.pay.frasers.plus/?partner=FrasersPlusMarketing&template=online&location=FrasersplusMarketingWebpage'),
          read(name,baseline),'Only the requested popup URL may change');
      }
      else if(name!=='src/lib/post-survey-workflows.ts') eq(read(name),read(name,baseline),`Protected: ${name}`);
    }
  }
  protect('src');
  const crons=JSON.parse(read('vercel.json')).crons;
  eq(crons.slice(0,2),JSON.parse(read('vercel.json',baseline)).crons);
  eq(crons[2],{path:'/api/backoffice/stage-alerts',schedule:'*/15 * * * *'});
  }

  reset();
  for (const status of ['AWAITING_SURVEY','SURVEY_RECEIVED','REVIEW_READY','BALANCE_PENDING','READY_FOR_BOOKING']) {
    const w=stage(status);
    eq(logic.getPrebookingAlertCandidate(w,paymentMap,NOW-1),null,`${status} premature`);
    yes(logic.getPrebookingAlertCandidate(w,paymentMap,NOW),`${status} at exactly 72h`);
  }
  for (const status of ['BOOKED_FOR_INSTALLATION','INSTALLED','DECLINED']) eq(logic.getPrebookingAlertCandidate(stage(status),paymentMap,NOW),null);
  for (const extra of [
    {bookedAt:SINCE},{archivedAt:SINCE},{customerDecision:'DECLINED'},
    {refundStatus:'REQUESTED'},{refundStatus:'APPROVED'},{refundStatus:'COMPLETED'},
    {jumptech:{status:'SCHEDULED'}},{jumptech:{currentStatusLabel:'INSTALLED'}},
    {jumptech:{status:'CANCELLED'}},{jumptech:{jobs:[{scheduledFor:SINCE}]}},
    {jumptech:{jobs:[{completedAt:SINCE}]}},
  ]) eq(logic.getPrebookingAlertCandidate({...base,...extra},paymentMap,NOW),null);
  yes(logic.getPrebookingAlertCandidate({...base,jumptech:{status:'NOT_BOOKED'}},paymentMap,NOW));
  eq(logic.getPrebookingAlertCandidate(base,new Map(),NOW),null,'Abandoned checkouts excluded');
  for(const status of ['PENDING','FAILED','CANCELLED','REFUNDED','REVERSED','APPROVED','AUTHORISED','AUTHORIZED']) {
    eq(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,latestStatus:{status}}]]),NOW),null);
  }
  for(const provider of ['CARD','FRASERS_PLUS']) {
    for(const status of ['AUTHORISED','AUTHORIZED','APPROVED']) {
      eq(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,provider,latestStatus:{status,currentType:'AUTHORIZATION'}}]]),NOW),null,'Approval alone is not paid');
    }
    for(const currentType of ['AUTHORIZATION','AUTHORISATION','CREDIT','REVERSAL','REFUND','CANCELLATION']) {
      eq(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,provider,latestStatus:{status:'COMPLETED',currentType}}]]),NOW),null,'Completed non-capture events must not count as payment');
    }
  }
  for(const status of ['COMPLETED','PAID','CAPTURED']) {
    yes(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,latestStatus:{status,currentType:'CARD'}}]]),NOW),'Captured card payment is eligible');
    yes(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,provider:'FRASERS_PLUS',latestStatus:{status,currentType:'CAPTURE'}}]]),NOW),'Confirmed Frasers capture is eligible');
  }
  eq(logic.getPrebookingAlertCandidate(base,new Map([[payment.paymentId,{...payment,provider:'FRASERS_PLUS',latestStatus:{status:'COMPLETED'}}]]),NOW),null,'Unverified Frasers capture must not count');
  eq(logic.getPrebookingAlertCandidate({...base,sourcePaymentId:'missing',currentPaymentId:'test-topup-1'},new Map([['test-topup-1',{...payment,paymentId:'test-topup-1'}]]),NOW),null);
  eq(logic.getPrebookingAlertCandidate({...base,sourcePaymentId:'missing',currentPaymentId:'extras-id',topUpPaymentId:'extras-id'},new Map([['extras-id',{...payment,paymentId:'extras-id'}]]),NOW),null,'An explicitly linked top-up cannot qualify the original order');
  eq(logic.getPrebookingAlertCandidate({...base,sourcePaymentId:'missing',currentPaymentId:'extras-id',replacementPaymentId:'extras-id'},new Map([['extras-id',{...payment,paymentId:'extras-id'}]]),NOW),null,'Legacy top-up aliases cannot qualify the original order');
  yes(logic.getPrebookingAlertCandidate({...base,amendedAmount:1181,balanceDue:246,surveyStatus:'BALANCE_PENDING',stageClock:{...base.stageClock,status:'BALANCE_PENDING'}},paymentMap,NOW),'Original paid order remains eligible with extras outstanding');
  const tracked=clone(base);
  eq(clock.trackSurveyStage(tracked,tracked.surveyStatus,new Date(NOW).toISOString()),false);
  eq(tracked.stageClock.enteredAt,SINCE,'Same-stage updates must not reset clock');
  tracked.surveyStatus='REVIEW_READY';
  yes(clock.trackSurveyStage(tracked,'SURVEY_RECEIVED',new Date(NOW).toISOString()));
  eq(logic.getPrebookingAlertCandidate(tracked,paymentMap,NOW),null);
  tracked.surveyStatus='SURVEY_RECEIVED';
  clock.trackSurveyStage(tracked,'REVIEW_READY',new Date(NOW+1).toISOString());
  yes(logic.getPrebookingAlertCandidate(tracked,paymentMap,NOW+logic.PREBOOKING_ALERT_AFTER_MS+1).key !== logic.getPrebookingAlertCandidate(base,paymentMap,NOW).key,'Re-entry is a new episode');
  const legacy={...clone(base),stageClock:undefined};
  clock.trackSurveyStage(legacy,legacy.surveyStatus,new Date(NOW).toISOString());
  eq(logic.getPrebookingAlertCandidate(legacy,paymentMap,NOW),null,'Default must not flood historical jobs');
  yes(logic.getPrebookingAlertCandidate(legacy,paymentMap,NOW,true),'Explicit backlog opt-in');
  const legacyBalance={...stage('BALANCE_PENDING'),surveyReviewedAt:SINCE,stageClock:undefined};
  clock.trackSurveyStage(legacyBalance,legacyBalance.surveyStatus,new Date(NOW).toISOString());
  yes(logic.getPrebookingAlertCandidate(legacyBalance,paymentMap,NOW,true),'Legacy extras awaiting first payment use the recorded quote review date');
  eq(logic.getPrebookingAlertCandidate({...base,stageClock:{...base.stageClock,enteredAt:'invalid'}},paymentMap,NOW),null);
  eq(logic.getPrebookingAlertCandidate({...base,stageClock:{...base.stageClock,enteredAt:new Date(NOW+1).toISOString()}},paymentMap,NOW),null);

  reset();
  await workflows.confirmSurveyReceived(base.id,'test');
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock,base.stageClock);
  await workflows.prepareSurveyReviewLink(base.id,'test',{});
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock.status,'REVIEW_READY');
  reset();
  await workflows.syncPostSurveyWorkflows([payment],[]);
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock,base.stageClock,'Sync preserves clock');
  reset([{...stage('AWAITING_SURVEY'),surveyReceivedAt:undefined}]);
  await workflows.recordJumptechProjectUpdate('test-project','test',{integrationId:base.sourcePaymentId,status:'IN_REVIEW'});
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock.status,'SURVEY_RECEIVED');
  const after=clone(store.get('post-survey-workflows.json').workflows[0].stageClock);
  await workflows.recordJumptechProjectUpdate('test-project','test',{status:'IN_REVIEW'});
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock,after,'Routine Jumptech refresh preserves clock');
  reset([{...stage('READY_FOR_BOOKING'),amendedAmount:1181}]);
  await workflows.syncPostSurveyWorkflows([payment],[]);
  eq(store.get('post-survey-workflows.json').workflows[0].stageClock.status,'BALANCE_PENDING','Sync-driven transitions tracked');

  reset(); process.env.PREBOOKING_STAGE_ALERTS_ENABLED='false';
  eq((await run()).enabled,false); eq(reads,0); eq(writes,0); eq(calls.length,0);
  for(const status of ['PENDING','AUTHORISED','APPROVED','FAILED']) {
    reset([base],[{...payment,latestStatus:{status}}]);
    const unpaidRun=await run(); eq(unpaidRun.due,0); eq(unpaidRun.sent,0); eq(calls.length,0);
  }
  reset(); delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
  await rejects(()=>run(),/not configured/); eq(writes,0);
  reset(); process.env.NODE_ENV='production';
  await rejects(()=>run(),/durable shared/);
  reset([{...base,stageClock:undefined}]);
  process.env.PREBOOKING_STAGE_ALERTS_INCLUDE_EXISTING='true';
  const before=clone(store.get('post-survey-workflows.json'));
  eq((await run({dryRun:true})).due,1); eq(writes,0); eq(calls.length,0); eq(store.get('post-survey-workflows.json'),before);
  reset([{...base,stageClock:undefined}]);
  eq((await run()).sent,0);
  const initialized=store.get('post-survey-workflows.json').workflows[0];
  eq(initialized,{...base,stageClock:undefined},'Scheduler must not write order data');
  eq(store.get('prebooking-stage-observations.json')[base.id].enteredAt,new Date(NOW).toISOString());
  const initialWrites=writes; await run(); eq(writes,initialWrites);
  eq((await run({now:NOW+logic.PREBOOKING_ALERT_AFTER_MS})).sent,1,'Legacy observation clock survives repeat runs');

  reset();
  store.delete('prebooking-stage-alert-activation.json');
  eq((await run()).sent,0,'Default initial activation must not alert historical jobs');
  eq(store.get('prebooking-stage-alert-activation.json').startedAt,new Date(NOW).toISOString());
  reset(); store.delete('prebooking-stage-alert-activation.json');
  process.env.PREBOOKING_STAGE_ALERTS_INCLUDE_EXISTING='true';
  eq((await run()).sent,1,'Explicit backlog opt-in can alert immediately');
  reset();
  const unchangedOrders=clone(store.get('post-survey-workflows.json'));
  const unchangedPayments=clone(store.get('merchant-state.json'));
  eq((await run()).sent,1); eq(providerMessages.size,1);
  eq(store.get('post-survey-workflows.json'),unchangedOrders,'Delivery must not change orders');
  eq(store.get('merchant-state.json'),unchangedPayments,'Delivery must not change payments');
  eq(calls[0].key,null,'New incoming-webhook deliveries omit requestId');
  eq((await run()).alreadySent,1); eq(calls.length,1);
  const text=JSON.parse(calls[0].body).text;
  yes(text.includes('Test Customer')); yes(text.includes('3 days'));
  yes(text.includes('/backoffice?tab=orders&focusOrder=fixture'));
  yes(!text.includes('/survey-review/') && !text.includes(base.customerEmail));
  reset(); failureResponse={status:429,body:{error:{status:'RESOURCE_EXHAUSTED'}}};
  eq((await run()).failed,1); eq([...store.values()].filter(v=>v?.sentAt).length,0);
  eq(reservations.size,0,'Confirmed rejection releases the reservation');
  const failedCall=clone(calls[0]); failureResponse=undefined;
  eq((await run()).sent,1); eq(calls[1],failedCall,'Retry must reuse the stored payload');
  reset(); fail=true; eq((await run()).failed,1); fail=false;
  eq((await run()).deferred,1,'Do not overlap a possibly in-flight request');
  eq((await run({now:NOW+120000})).failed,1,'Ambiguous server error requires review rather than duplicate delivery');
  eq(calls.length,1); eq(reservations.size,1);
  reset(); missingName=true; eq((await run()).failed,1);
  eq(JSON.parse(diagnostics[0][1]).category,'unconfirmed_delivery'); eq(JSON.parse(diagnostics[0][1]).retrySafe,false);
  reset(); failureResponse={status:400,body:{error:{status:'INVALID_ARGUMENT',message:'Invalid requestId: secret-token customer@example.com https://chat.googleapis.com/private'}}};
  eq((await run()).failed,1);
  eq(JSON.parse(diagnostics[0][1]).hint,'request_id'); eq(JSON.parse(diagnostics[0][1]).httpStatus,400); eq(JSON.parse(diagnostics[0][1]).retrySafe,true);
  yes(!JSON.stringify(diagnostics).includes('secret-token')&&!JSON.stringify(diagnostics).includes('customer@example.com')&&!JSON.stringify(diagnostics).includes('https://'));
  reset(); failureResponse={status:403,body:{error:{status:'PERMISSION_DENIED',message:'secret-token'}}};
  eq((await run()).failed,1);
  eq(JSON.parse(diagnostics[0][1]).httpStatus,403); eq(JSON.parse(diagnostics[0][1]).apiStatus,'PERMISSION_DENIED'); eq(JSON.parse(diagnostics[0][1]).retrySafe,true);
  reset(); failReceiptWrite=true;
  eq((await run()).failed,1); eq(providerMessages.size,1);
  eq(JSON.parse(diagnostics[0][1]).phase,'receipt'); eq(JSON.parse(diagnostics[0][1]).retrySafe,false);
  failReceiptWrite=false; eq((await run({now:NOW+120000})).failed,1); eq(providerMessages.size,1,'Lost receipt must not create another provider message'); eq(calls.length,1);
  reset(); await Promise.all([run(),run()]); eq(providerMessages.size,1,'Concurrent runs reserve one delivery'); eq(calls.length,1);
  const seedLegacyReceipt = () => {
    const candidate=logic.getPrebookingAlertCandidate(base,paymentMap,NOW);
    const filename=`prebooking-stage-alert-${candidate.key}.json`;
    store.set(filename,{text:logic.buildPrebookingAlertMessage(candidate,NOW),preparedAt:SINCE});
    return {key:candidate.key,filename};
  };
  reset(); let legacyReceipt=seedLegacyReceipt();
  eq((await run()).sent,1,'Rejected legacy ID migrates to a plain webhook');
  eq(calls.length,2); eq(calls[0].key,legacyReceipt.key); eq(calls[0].body,calls[1].body,'Migration preserves the stored payload');
  eq(calls[1].key,null); eq(store.get(legacyReceipt.filename).deliveryMode,'webhook'); eq(providerMessages.size,1);
  eq((await run()).alreadySent,1); eq(calls.length,2,'Previously delivered alert is not resent');
  reset(); legacyReceipt=seedLegacyReceipt(); fail=true;
  eq((await run()).failed,1); eq(calls.length,1,'Ambiguous failure must not switch ID');
  eq(calls[0].key,legacyReceipt.key); eq(store.get(legacyReceipt.filename).requestId,undefined);
  reset(); legacyReceipt=seedLegacyReceipt(); acceptLegacyIds=true; failReceiptWrite=true;
  eq((await run()).failed,1); eq(providerMessages.size,1);
  failReceiptWrite=false; eq((await run({now:NOW+120000})).failed,1); eq(calls.length,1);
  eq(providerMessages.size,1,'Accepted legacy ID with lost receipt never switches or duplicates');
  reset(); legacyReceipt=seedLegacyReceipt(); failReceiptWrite=true;
  eq((await run()).failed,1); eq(providerMessages.size,1);
  failReceiptWrite=false; eq((await run({now:NOW+120000})).failed,1); eq(calls.length,2);
  eq(providerMessages.size,1,'Migrated legacy send is held after a lost receipt');
  reset(); let workflowReads=0;
  beforeRead=key=>{if(key==='post-survey-workflows.json' && ++workflowReads===2) store.get(key).workflows[0].bookedAt=SINCE;};
  eq((await run()).skipped,1); eq(calls.length,0,'Recheck booking before delivery');
  const many=Array.from({length:21},(_,i)=>({...clone(base),id:`job-${i}`,sourcePaymentId:`ORDER-${i}`,currentPaymentId:`ORDER-${i}`}));
  reset(many,many.map(w=>({...payment,paymentId:w.sourcePaymentId})));
  const batch=await run(); eq(batch.sent,20); eq(batch.deferred,1); eq(delays.length,19); yes(delays.every(ms=>ms>=1000));
  const nextBatch=await run(); eq(nextBatch.sent,1); eq(nextBatch.alreadySent,20);

  reset();
  for(const secret of ['', 'fixture-secret']) {
    process.env.CRON_SECRET=secret;
    for(const token of ['', 'Bearer incorrect']) {
      eq((await route.GET(new Request('https://payments.vchrgd.app/api/backoffice/stage-alerts',{headers:{authorization:token}}))).status,401);
    }
  }
  eq(calls.length,0);
  process.env.PREBOOKING_STAGE_ALERTS_ENABLED='false';
  const req=()=>new Request('https://payments.vchrgd.app/api/backoffice/stage-alerts',{headers:{authorization:'Bearer fixture-secret'}});
  eq((await route.GET(req())).status,200); eq(calls.length,0);
  process.env.PREBOOKING_STAGE_ALERTS_ENABLED='true'; fail=true;
  store.get('post-survey-workflows.json').workflows[0].stageClock.enteredAt=new Date(Date.now()-73*3_600_000).toISOString();
  store.get('prebooking-stage-alert-activation.json').startedAt=new Date(Date.now()-73*3_600_000).toISOString();
  eq((await route.GET(req())).status,503);
  console.log(`PASS: ${checks} stage-alert and production-source protection checks (mock datastore/webhook only).`);
}
main().catch(error=>{originalConsoleError(error);process.exitCode=1;}).finally(()=>{process.env=originalEnv;global.fetch=originalFetch;console.error=originalConsoleError;});
