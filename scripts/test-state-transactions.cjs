// Deliberately separate from offline tests. Only accepts an explicitly supplied,
// disposable LOOPBACK database, never application environment credentials.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createLoader}=require('./test-app-loader.cjs');
const {persistence,workflow}=require('./test-handover-remediation.cjs');
async function main(){
  const input=process.argv[2];if(!input)throw Error('Supply the disposable loopback database URL explicitly.');
  const url=new URL(input);
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/remediation_')||!url.port)throw Error('Only a disposable remediation_ database on 127.0.0.1 is permitted.');
  const env={APP_DATA_STORE:'supabase',APP_DATA_NAMESPACE:'remediation_test_'+randomUUID(),SUPABASE_DB_URL:input};
  let paymentCreates=0;
  const mocks={'@/lib/post-survey-payments':{createCardCheckoutForWorkflow:async(_origin,order)=>{
    paymentCreates++;if(order.id==='failed-balance')throw Error('Synthetic provider timeout');
    return {response:new Response(null,{status:201}),redirectUrl:'https://review.example.test/existing-checkout'};
  }}};
  const first=createLoader({env,database:true,mocks}),second=createLoader({env,database:true,mocks});
  let checks=0;
  try{
    await persistence(first);
    const a=first('@/lib/frasers-plus-merchant-state'),b=second('@/lib/frasers-plus-merchant-state');
    const store=first('@/lib/server-data'),otherStore=second('@/lib/server-data');
    await store.writeJsonFile('merchant-state.json',{sessions:[],auditEvents:[]});
    await Promise.all(Array.from({length:50},(_,i)=>(i%2?a:b).storeCardCheckoutSession({paymentId:'CROSS-CLIENT-'+i,providerPaymentReference:'reference-'+i,redirectUrl:'https://review.example.test/fixture',amount:935,currency:'GBP'})));
    assert.equal((await a.listPaymentSessions()).length,50);checks++;
    assert.equal((await b.listAuditEvents(500)).length,50);checks++;
    await store.writeJsonFile('rollback.json',{value:'before'});
    await assert.rejects(store.withJsonFileTransaction('rollback.json',async()=>{
      await store.writeJsonFile('rollback.json',{value:'never committed'});throw Error('Synthetic transaction failure');
    }));checks++;
    assert.equal((await otherStore.readJsonFile('rollback.json',{})).value,'before');checks++;
    await otherStore.withJsonFileTransaction('rollback.json',async()=>otherStore.writeJsonFile('rollback.json',{value:'after'}));
    assert.equal((await store.readJsonFile('rollback.json',{})).value,'after');checks++;
    // Nested, different JSON keys use the same SQL connection/transaction; needed
    // for work-order number allocation. Both changes roll back together.
    await assert.rejects(store.withJsonFileTransaction('outer.json',async()=>{
      await store.writeJsonFile('outer.json',{value:1});
      await store.withJsonFileTransaction('inner.json',async()=>store.writeJsonFile('inner.json',{value:2}));
      throw Error('Synthetic nested rollback');
    }));checks++;
    assert.equal(await otherStore.readJsonFile('outer.json',null),null);checks++;
    assert.equal(await otherStore.readJsonFile('inner.json',null),null);checks++;
    // No new schema/format needed: a client using the previous payload format
    // still reads the state; new code can extend legacy records atomically.
    await store.writeJsonFile('legacy.json',{sessions:[{paymentId:'legacy',amount:935}],auditEvents:[]});
    await otherStore.withJsonFileTransaction('legacy.json',async()=>{
      const value=await otherStore.readJsonFile('legacy.json',{});value.sessions.push({paymentId:'new',amount:935});await otherStore.writeJsonFile('legacy.json',value);
    });
    assert.equal((await store.readJsonFile('legacy.json',{})).sessions.length,2);checks++;
    await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow()]});
    const balanceA=first('@/lib/balance-checkout'),balanceB=second('@/lib/balance-checkout');
    await Promise.allSettled([balanceA.startOrResumeBalanceCheckout('https://review.example.test','synthetic-review-token','card'),balanceB.startOrResumeBalanceCheckout('https://review.example.test','synthetic-review-token','card')]);
    assert.equal(paymentCreates,1);checks++;
    assert.equal(await balanceB.startOrResumeBalanceCheckout('https://review.example.test','synthetic-review-token','card'),'https://review.example.test/existing-checkout');checks++;
    await store.writeJsonFile('post-survey-workflows.json',{workflows:[workflow({id:'failed-balance',reviewToken:'failed-token'})]});
    await assert.rejects(balanceA.startOrResumeBalanceCheckout('https://review.example.test','failed-token','card'));checks++;
    await assert.rejects(balanceB.startOrResumeBalanceCheckout('https://review.example.test','failed-token','card'));checks++;
    assert.equal(paymentCreates,2);checks++; // One successful create, one ambiguous attempt; no retry.
    console.log(JSON.stringify({passed:true,crossClientAndRollbackChecks:checks,concurrentOrders:50,clients:2,endpoint:'loopback only',productionWrites:0}));
  }finally{await Promise.all([first.close(),second.close()]);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
