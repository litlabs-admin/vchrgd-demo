const assert=require('node:assert/strict');
const {createLoader}=require('./test-app-loader.cjs');
const origin='https://review.example.test';
let checks=0;
const equal=(actual,expected,label)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,label);checks++;};
const address={line1:'1 Synthetic Street',city:'Test',postalCode:'AA1 1AA',country:'GB'};
const workflow=(extra={})=>({id:'review-workflow',sourcePaymentId:'REVIEW-ORDER',currentPaymentId:'REVIEW-ORDER',sourceKind:'payment',provider:'CARD',paymentChoice:'card',
  createdAt:'2026-10-28T10:00:00Z',updatedAt:'2026-10-28T10:00:00Z',originalAmount:935,amendedAmount:1035,balanceDue:100,surveyStatus:'BALANCE_PENDING',
  refundStatus:'NONE',topUpPaymentStatus:'NONE',reviewToken:'synthetic-review-token',customerEmail:'review@example.test',customerName:'Synthetic Review',billingAddress:address,deliveryAddress:address,history:[],...extra});
async function persistence(load) {
  const store=load('@/lib/server-data'), merchant=load('@/lib/frasers-plus-merchant-state'),workflows=load('@/lib/post-survey-workflows');
  await store.writeJsonFile('merchant-state.json',{sessions:[],auditEvents:[]});
  await Promise.all(Array.from({length:30},(_,i)=>merchant.storeCardCheckoutSession({paymentId:'ORDER-'+i,providerPaymentReference:'provider-'+i,redirectUrl:origin+'/checkout',amount:935,currency:'GBP',cardProcessor:'REVOLUT'})));
  const sessions=await merchant.listPaymentSessions();equal(sessions.length,30,'concurrent orders retained');equal(new Set(sessions.map(s=>s.paymentId)).size,30,'all distinct IDs');
  await Promise.all(sessions.map(s=>merchant.updateCardCheckoutStatus({paymentId:s.paymentId,status:'COMPLETED'})));
  equal((await merchant.listPaymentSessions()).filter(s=>s.latestStatus.status==='COMPLETED').length,30,'concurrent statuses retained');
  equal((await merchant.listAuditEvents(500)).length,60,'audit entries retained');
  await merchant.updateCardCheckoutStatus({paymentId:'ORDER-0',status:'REFUNDED'});
  for(const status of ['PENDING','COMPLETED','AUTHORISED'])await merchant.updateCardCheckoutStatus({paymentId:'ORDER-0',status});
  equal((await merchant.getPaymentSessionByPaymentId('ORDER-0')).latestStatus.status,'REFUNDED','refund terminal against stale callbacks');
  await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow(),workflow({id:'other-workflow',sourcePaymentId:'OTHER'})]});
  await Promise.all([workflows.confirmSurveyReceived('review-workflow','review'),workflows.requestSurveyWorkflowRefund('other-workflow','review','Synthetic cancellation')]);
  equal((await workflows.getPostSurveyWorkflowById('review-workflow')).surveyStatus,'SURVEY_RECEIVED','first workflow update retained');
  equal((await workflows.getPostSurveyWorkflowById('other-workflow')).refundStatus,'REQUESTED','second workflow update retained');
  await assert.rejects(store.withJsonFileTransaction('failed.json',async()=>{throw Error('fixture failure');}));checks++;
  await store.withJsonFileTransaction('failed.json',async()=>store.writeJsonFile('failed.json',{ok:true}));equal((await store.readJsonFile('failed.json',{})).ok,true,'lock released after exception');
}
async function main(){
  let load=createLoader();await persistence(load);await load.close();
  // Session rotation, disabling/re-enabling and rollout of legacy user records.
  {
    const jar=new Map();load=createLoader({mocks:{'next/headers':{cookies:async()=>({get:key=>jar.has(key)?{value:jar.get(key)}:undefined})}}});
    const users=load('@/lib/admin-users'),auth=load('@/lib/admin-auth');
    const {user}=await users.createManagedAdminUser({username:'review@example.test',password:'SyntheticPassword123!',mfaRequired:true,actor:'review'});
    const cookie=await auth.createAdminSessionToken(user.username);jar.set('vchrgd_admin_session',cookie);
    equal(Boolean(await auth.getAdminSession()),true,'fresh login valid');
    await users.rotateManagedAdminUserPassword({userId:user.id,password:'ChangedSyntheticPassword123!',actor:'review'});
    equal(await auth.getAdminSession(),null,'reset password revokes old cookie');
    jar.set('vchrgd_admin_session',await auth.createAdminSessionToken(user.username));
    await users.rotateManagedAdminUserTotpSecret({userId:user.id,actor:'review'});equal(await auth.getAdminSession(),null,'TOTP rotation revokes cookie');
    jar.set('vchrgd_admin_session',await auth.createAdminSessionToken(user.username));
    await users.updateManagedAdminUserAccess({userId:user.id,enabled:false,mfaRequired:true,actor:'review'});equal(await auth.getAdminSession(),null,'disable revokes');
    await users.updateManagedAdminUserAccess({userId:user.id,enabled:true,mfaRequired:true,actor:'review'});equal(await auth.getAdminSession(),null,'re-enable never revives cookie');
    jar.set('vchrgd_admin_session',await auth.createAdminSessionToken(user.username));equal(Boolean(await auth.getAdminSession()),true,'new login works after rotation');
    const version=(await users.getManagedAdminUserByUsername(user.username)).sessionVersion;
    await users.rotateManagedAdminUserPassword({userId:user.id,password:'AnotherSyntheticPassword123!',actor:'review'});
    await assert.rejects(auth.createAdminSessionToken(user.username,version));checks++;
  }
  // Definite Chat failure retries, confirmed delivery dedupes, uncertain delivery holds.
  for(const outcome of ['failed','missing','unknown','success']){
    let sends=0;load=createLoader({env:outcome==='missing'?{}:{GOOGLE_CHAT_WEBHOOK_URL:'https://chat.example.test/synthetic'},fetchMock:async()=>{
      sends++;if(outcome==='unknown')throw Error('Synthetic lost response');return new Response(null,{status:outcome==='failed'&&sends===1?503:200});
    }});
    const notifier=load('@/lib/google-chat-notifications'),store=load('@/lib/server-data');
    await Promise.all(Array.from({length:5},()=>notifier.sendUniqueGoogleChatNotification('key','Synthetic notification')));
    await notifier.sendUniqueGoogleChatNotification('key','Synthetic notification');
    equal(sends,outcome==='missing'?0:outcome==='failed'?2:1,outcome+' send count');
    equal(Object.keys((await store.readJsonFile('google-chat-notifications.json',{sent:{}})).sent).length,['failed','success'].includes(outcome)?1:0,outcome+' receipt status');
  }
  // Actual balance route and provider helper: no live requests; only one payable attempt.
  for(const method of ['card','frasers-plus']){
    let calls=0;
    load=createLoader({mocks:{
      '@/lib/square':{shouldUseSquareCardCheckout:()=>false},
      '@/lib/revolut':{getRevolutConfig:()=>({currency:'GBP'}),shouldUseMockRevolutCheckout:()=>false,buildRevolutOrderPayload:p=>p,
        createRevolutOrder:async()=>{calls++;return {response:new Response(null,{status:201}),data:{id:'provider-fixture',checkout_url:origin+'/provider'}};}},
      '@/lib/frasers-plus':{getFrasersPlusConfig:()=>({useMock:false}),buildMerchantDefaults:()=>({merchantId:'fixture',merchantName:'Fixture',redirectUrl:origin+'/return'}),
        buildMerchantRedirectUrl:()=>origin+'/return',frasersPlusRequest:async()=>{calls++;return {response:new Response(null,{status:201}),data:{uniquePaymentReference:'fixture-upr',redirectUrl:origin+'/provider'}};}},
    }});
    const store=load('@/lib/server-data');await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow()]});
    const route=load('@/app/api/survey-review/balance/complete/route');
    const request=m=>new Request(origin+'/api/survey-review/balance/complete',{method:'POST',headers:{origin},body:new URLSearchParams({token:'synthetic-review-token',method:m})});
    const concurrent=await Promise.all(Array.from({length:8},()=>route.POST(request(method))));
    equal(calls,1,method+' concurrent provider creates once');equal(concurrent.filter(r=>r.status===303).length>=1,true,'one completed request');
    equal((await route.POST(request(method))).headers.get('location'),origin+'/provider','retry reuses URL');equal(calls,1,'retry no second order');
    equal((await route.POST(request(method==='card'?'frasers-plus':'card'))).status,409,'route switching cannot create second payable order');equal(calls,1,'switch no side effect');
    equal((await route.POST(new Request(origin+'/api/survey-review/balance/complete',{method:'POST',headers:{origin:'https://evil.example.test'},body:new URLSearchParams({token:'synthetic-review-token'})}))).status,403,'cross-site denied');
  }
  // Ambiguous provider failure must survive a new request; no automatic retry.
  {
    let calls=0;load=createLoader({mocks:{'@/lib/post-survey-payments':{createCardCheckoutForWorkflow:async()=>{calls++;throw Error('Synthetic timeout');}}}});
    const store=load('@/lib/server-data');await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow()]});
    const balance=load('@/lib/balance-checkout');
    await assert.rejects(balance.startOrResumeBalanceCheckout(origin,'synthetic-review-token','card'));checks++;
    await assert.rejects(balance.startOrResumeBalanceCheckout(origin,'synthetic-review-token','card'));checks++;
    equal(calls,1,'uncertain result never sends twice');
  }
  // Legacy pending attempts are adopted, including after process/code restart.
  {
    load=createLoader({mocks:{'@/lib/post-survey-payments':{createCardCheckoutForWorkflow:()=>{throw Error('Must not create');}}}});
    const store=load('@/lib/server-data');await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow({topUpPaymentId:'OLD-TOPUP',topUpPaymentStatus:'PENDING',topUpPaymentChoice:'card'})]});
    await store.writeJsonFile('merchant-state.json',{sessions:[{paymentId:'OLD-TOPUP',amount:100,redirectUrl:origin+'/legacy'}],auditEvents:[]});
    equal(await load('@/lib/balance-checkout').startOrResumeBalanceCheckout(origin,'synthetic-review-token','card'),origin+'/legacy','legacy pending URL adopted');
  }
  // Old admin endpoint must use actual verified capture implementation.
  {
    let calls=0,fulfillment=0,completed=false,authenticated=true;
    load=createLoader({mocks:{'@/lib/admin-auth':{isAdminAuthenticated:async()=>authenticated},
      '@/lib/frasers-plus':{getFrasersPlusConfig:()=>({useMock:false}),frasersPlusRequest:async()=>{calls++;return {response:new Response(null,{status:completed?200:202}),data:{type:'CAPTURE',status:completed?'COMPLETED':'PENDING'}};}},
      '@/lib/workflow-sync':{ensureJumptechProjectForOriginalPayment:async()=>{fulfillment++;}},
    }});
    const store=load('@/lib/server-data');await store.writeJsonFile('merchant-state.json',{sessions:[{paymentId:'REVIEW-ORDER',provider:'FRASERS_PLUS',uniquePaymentReference:'fixture-upr',amount:935,currency:'GBP',latestStatus:{currentType:'AUTHORIZATION',status:'AUTHORISED'}}],auditEvents:[]});
    const route=load('@/app/api/frasers-plus/payment/[upr]/route'),context={params:Promise.resolve({upr:'fixture-upr'})};
    const request=(type='CAPTURE',amount=935)=>new Request(origin+'/api/frasers-plus/payment/fixture-upr',{method:'PUT',headers:{origin,'content-type':'application/json'},body:JSON.stringify({type,paymentAmount:{amount,currency:'GBP'}})});
    equal((await route.PUT(request(),context)).status,502,'pending capture not successful');equal(fulfillment,0,'pending never fulfils');
    equal((await load('@/lib/frasers-plus-merchant-state').getPaymentSessionByPaymentId('REVIEW-ORDER')).latestStatus.status,'AUTHORISED','no false completed state');
    const before=calls;equal((await route.PUT(request('CREDIT'),context)).status,409,'refund workflow cannot be bypassed');equal(calls,before,'credit sends no API request');
    equal((await route.PUT(request('CAPTURE',1),context)).status,409,'capture tampering rejected');
    authenticated=false;equal((await route.PUT(request(),context)).status,401,'admin authentication required');authenticated=true;
    completed=true;equal((await route.PUT(request(),context)).status,200,'confirmed capture works');equal(fulfillment,1,'confirmed capture fulfils');
    const merchant=load('@/lib/frasers-plus-merchant-state');
    await merchant.updateFrasersPlusPaymentState({uniquePaymentReference:'fixture-upr',currentType:'REVERSAL',status:'CANCELLED'});
    const count=calls;equal((await route.PUT(request(),context)).status,502,'reversed payment cannot be captured');equal(calls,count,'no provider call after reversal');
    await merchant.storeAuthorizationWebhookEvent({uniquePaymentReference:'fixture-upr',type:'AUTHORIZATION',status:'APPROVED',raw:{}});
    equal((await merchant.getPaymentSessionByUpr('fixture-upr')).latestStatus.currentType,'REVERSAL','late authorisation cannot rewind reversal');
  }
  {
    let authenticated=true;load=createLoader({mocks:{'@/lib/admin-auth':{isAdminAuthenticated:async()=>authenticated}}});
    const store=load('@/lib/server-data');await store.writeJsonFile('merchant-state.json',{sessions:[{paymentId:'KNOWN',uniquePaymentReference:'known-upr'}],auditEvents:[]});
    const route=load('@/app/api/frasers-plus/session/route');
    let response=await route.GET(new Request(origin+'/api/frasers-plus/session?paymentId=missing&upr=known-upr'));
    equal((await response.json()).paymentId,'KNOWN','awaited UPR fallback');
    equal((await route.GET(new Request(origin+'/api/frasers-plus/session?paymentId=missing'))).status,404,'missing session 404');
    authenticated=false;equal((await route.GET(new Request(origin+'/api/frasers-plus/session?paymentId=KNOWN'))).status,401,'private API denied');
  }
  console.log(JSON.stringify({passed:checks,providerCalls:'mocked',productionWrites:0,externalNetworkCalls:0}));
}
module.exports={persistence,workflow};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
