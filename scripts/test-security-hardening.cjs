const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let checks = 0, providerCalls = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const env = { NODE_ENV:'production', ADMIN_SESSION_SECRET:'fixture-admin-secret-not-live', FRASERS_PLUS_RETURN_TOKEN_SECRET:'fixture-return-secret-not-live', ENABLE_FRASERS_PLUS:'true', REVOLUT_API_KEY:'fixture-key', REVOLUT_REDIRECT_URL:'https://payments.example.test/card/return' };
const json = (value, init) => { const result = Response.json(value, init); result.cookies = { set(){} }; return result; };
function loader(mocks = {}, environment = env) {
  const cache = new Map();
  const load = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'next/server') return { NextResponse:{json}, after(){} };
    if (name === 'next/navigation') return { redirect(url){ throw Object.assign(new Error('redirect'), {url}); } };
    if (name === 'next/link') return p => require('react').createElement('a', p, p.children);
    if (!name.startsWith('@/')) {
      if (name.startsWith('node:') || name.startsWith('react')) return require(name);
      throw Error('Unexpected dependency: '+name);
    }
    if (cache.has(name)) return cache.get(name).exports;
    let file = path.join(root, 'src', name.slice(2)); file += fs.existsSync(file+'.ts') ? '.ts' : '.tsx';
    const module = {exports:{}}; cache.set(name,module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
      {module,exports:module.exports,require:load,process:{env:environment},Buffer,Request,Response,URL,URLSearchParams,Intl,Date,TextEncoder,Uint8Array,console,
       fetch(){throw Error('External network forbidden');}}, {filename:file});
    return module.exports;
  };
  return load;
}
const origin = 'https://payments.example.test';
const req = (route, payload, access, extra={}) => new Request(origin+route, {method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(access?{'x-checkout-token':access.token}:{}),...extra},body:JSON.stringify(payload)});
const settings = {chargers:[{slug:'seven-pro-tethered',name:'Seven Pro Tethered',unitPrice:550,installedPrice:935}],adjustments:{},discounts:[
  {id:'voucher',kind:'VOUCHER',code:'FIXTURE50',label:'Private voucher',amount:50,enabled:true,appliesTo:'all'},
  {id:'disabled',kind:'VOUCHER',code:'DISABLED',label:'Disabled',amount:900,enabled:false,appliesTo:'all'},
  {id:'expired',kind:'VOUCHER',code:'EXPIRED',label:'Expired',amount:20,enabled:true,appliesTo:'all',expiresAt:'2020-01-01'},
],updatedAt:'2026-09-24T00:00:00Z'};
const memory = new Map(), reservations = new Set(), sessions = new Map();
const storage = {
  withJsonFileTransaction: async (_key, action) => action(),
  readJsonFile:async(key,fallback)=>structuredClone(memory.get(key)??fallback),
  writeJsonFile:async(key,value)=>memory.set(key,structuredClone(value)),
  tryReserveDedupeKey:async(scope,key)=>{const k=scope+key;if(reservations.has(k))return false;reservations.add(k);return true;},
  releaseDedupeKey:async(scope,key)=>reservations.delete(scope+key),
};
const sessionStore = {
  getPaymentSessionByPaymentId:async id=>sessions.get(id),
  getPaymentSessionByUpr:async upr=>[...sessions.values()].find(item=>item.uniquePaymentReference===upr),
  storeCardCheckoutSession:async item=>sessions.set(item.paymentId,{...item,provider:'CARD',latestStatus:{status:'PENDING'}}),
  storeFrasersPlusPaymentSession:async item=>sessions.set(item.paymentId,{...item,provider:'FRASERS_PLUS',latestStatus:{status:'PENDING'}}),
};
const baseMocks = {'@/lib/server-data':storage,'@/lib/product-settings':{getProductSettings:async()=>structuredClone(settings)},'@/lib/frasers-plus-merchant-state':sessionStore};
const accessLib = loader()('@/lib/checkout-access');
const fresh = () => accessLib.createCheckoutAccess();
const address = {line1:'1 Synthetic Street',city:'Test',postalCode:'AA1 1AA',country:'GB'};
const cardPayload = access => ({paymentId:access.paymentId,customerId:'synthetic',firstName:'Synthetic',lastName:'Customer',email:'test@example.test',phone:'+447700900123',charger:{slug:'seven-pro-tethered',name:'Seven Pro Tethered',installPrice:935,hardwarePrice:550},total:935,surveyAdjustment:0,billingAddress:address,deliveryAddress:address});
const fpPayload = access => ({paymentId:access.paymentId,type:'AUTHORIZATION',method:'ONLINE',mcc:'5552',customer:{id:'synthetic',firstName:'Synthetic',lastName:'Customer',email:'test@example.test',phone:'+447700900123',billingAddress:address,deliveryAddress:address},merchant:{},paymentAmount:{amount:935,currency:'GBP'},description:'Seven Pro Tethered installation',metadata:{chargerSlug:'seven-pro-tethered'}});
const walk = (node,test) => {if(!node||typeof node!=='object')return null;if(test(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=walk(child,test);if(found)return found;}return null;};

async function main() {
  const access = fresh();
  check(access.paymentId.length <= 40,true,'payment provider reference limit');
  check(accessLib.verifyCheckoutAccess(access.paymentId,access.token),true,'valid capability');
  for(const token of ['',access.token+'x',access.token+'.extra',123,null]) check(accessLib.verifyCheckoutAccess(access.paymentId,token),false,'invalid capability');
  check(accessLib.verifyCheckoutAccess('OTHER',access.token),false,'cross-order capability');
  check(accessLib.verifyCheckoutAccess(access.paymentId,fresh().token),false,'unrelated capability');
  const returns=loader()('@/lib/frasers-plus-return-token');
  const recovery=loader()('@/lib/checkout-recovery-token');
  check(accessLib.hasCheckoutResumeAccess(access.paymentId,{rt:returns.createFrasersPlusReturnToken(access.paymentId)}),true,'legacy signed return');
  check(accessLib.hasCheckoutResumeAccess(access.paymentId,{recovery:recovery.createCheckoutRecoveryToken(access.paymentId)}),true,'existing recovery email');
  check(accessLib.hasCheckoutResumeAccess('OTHER',{recovery:recovery.createCheckoutRecoveryToken(access.paymentId)}),false,'recovery order binding');
  check(accessLib.hasCheckoutResumeAccess(access.paymentId,{recovery:recovery.createCheckoutRecoveryToken(access.paymentId,-100)}),false,'expired recovery');
  const pricing=loader(baseMocks)('@/lib/checkout-pricing');
  check(pricing.publicProductSettings(settings).discounts.length,0,'private vouchers withheld');
  check(pricing.calculateCheckoutQuote(settings,'seven-pro-tethered').total,935,'current catalog price');
  check(pricing.calculateCheckoutQuote(settings,'seven-pro-tethered','fixture50').total,885,'valid voucher');
  for(const code of ['DISABLED','EXPIRED','UNKNOWN']) check(pricing.calculateCheckoutQuote(settings,'seven-pro-tethered',code).invalidVoucher,true,'invalid voucher');
  const offerSettings={...settings,discounts:[...settings.discounts,{id:'offer',kind:'SPECIAL_OFFER',label:'Offer',amount:30,enabled:true,appliesTo:'all'}]};
  check(pricing.calculateCheckoutQuote(offerSettings,'seven-pro-tethered','FIXTURE50').total,905,'offers do not stack with vouchers');
  for(const total of [1,0,-1,'935',null,NaN,Infinity]) {assert.throws(()=>pricing.requireExpectedTotal(935,total));checks++;}

  let sessionReads=0;
  const home=loader({...baseMocks,
    '@/components/integration-showcase':{IntegrationShowcase:()=>null},'@/components/payment-popup-return-bridge':{PaymentPopupReturnBridge:()=>null},'@/components/trustpilot-widget':{TrustpilotWidget:()=>null},
    '@/lib/admin-auth':{isAdminAuthenticated:async()=>false},'@/lib/frasers-plus':{getFrasersPlusConfig:()=>({useMock:false})},
    '@/lib/post-survey-workflows':{getPostSurveyWorkflowByPaymentId:async()=>null},
    '@/lib/checkout-interactions':{getCheckoutInteractionByPaymentId:async()=>null,updateCheckoutInteractionStatus(){throw Error('Homepage must not mutate');}},
    '@/lib/frasers-plus-merchant-state':{getPaymentSessionByPaymentId:async id=>{sessionReads++;return {paymentId:id,customerEmail:'fixture@example.test',createdAt:'2026-09-24T00:00:00Z'};},updateCardCheckoutStatus(){throw Error('Homepage must not mutate');}},
  })('@/app/page').default;
  for(const params of [{resume:'payment',paymentId:access.paymentId},{paymentId:access.paymentId,card_payment:'success',order_id:'forged'},{paymentId:access.paymentId,card_payment:'cancelled'}]) {
    const tree=await home({searchParams:Promise.resolve(params)});
    check(Boolean(walk(tree,n=>n.props?.resumePaymentSession)),false,'no unauthorized PII');
  }
  check(sessionReads,0,'no unauthorized session lookups');
  const owned=await home({searchParams:Promise.resolve({resume:'payment',paymentId:access.paymentId,ct:access.token})});
  check(walk(owned,n=>n.props?.resumePaymentSession).props.resumePaymentSession.customerEmail,'fixture@example.test','owned resume retained');
  check(walk(owned,n=>n.props?.productSettings).props.productSettings.discounts.length,0,'no voucher registry in hydration');

  const interaction=loader(baseMocks)('@/app/api/checkout-interactions/route');
  const payload={paymentId:access.paymentId,lastStep:5,selectedSlug:'seven-pro-tethered',status:'ACTIVE',customerEmail:'fixture@example.test',total:1};
  check((await interaction.POST(req('/api/checkout-interactions',payload))).status,403,'unauthorized interaction');
  check((await interaction.POST(req('/api/checkout-interactions',payload,fresh()))).status,403,'cross-order write');
  for(const invalid of [{status:'PAYMENT_COMPLETED'},{status:'BOGUS'},{lastStep:999},{lastStep:1.5},{customerEmail:'x'.repeat(2000)},{customerFirstName:123},{billingPostalCode:true},{selectedSlug:{}}]) check((await interaction.POST(req('/api/checkout-interactions',{...payload,...invalid},access))).status,400,'invalid interaction rejected');
  check((await interaction.POST(req('/api/checkout-interactions',payload,access))).status,200,'legitimate tracking retained');
  check(memory.get('checkout-interactions.json')[0].total,935,'tracked amount authoritative');
  sessions.set(access.paymentId,{paymentId:access.paymentId,provider:'CARD',amount:935,latestStatus:{status:'COMPLETED'},customerEmail:'paid@example.test'});
  check((await interaction.POST(req('/api/checkout-interactions',{...payload,status:'ABANDONED',customerEmail:'attacker@example.test'},access))).status,200,'paid browser update acknowledged');
  check(memory.get('checkout-interactions.json')[0].status,'PAYMENT_COMPLETED','paid cannot be downgraded');
  check(memory.get('checkout-interactions.json')[0].customerEmail,'paid@example.test','paid details remain provider record');

  let cardSent;
  const revolut=loader()('@/lib/revolut');
  const card=loader({...baseMocks,'@/lib/square':{shouldUseSquareCardCheckout:()=>false},'@/lib/revolut':{...revolut,
    createRevolutOrder:async payload=>{providerCalls++;cardSent=payload;return {response:{ok:true,status:200},data:{id:'fixture-order',checkout_url:'https://example.test/checkout'}};},
  }})('@/app/api/card-checkout/session/route');
  for(const total of [1,0,-1,1000]) {
    const own=fresh(), p=cardPayload(own);p.total=total;p.charger.installPrice=total;
    check([400,409].includes((await card.POST(req('/api/card-checkout/session',p,own))).status),true,'price tampering rejected');
  }
  check(providerCalls,0,'tampering never contacts provider');
  const valid=fresh(), validPayload=cardPayload(valid);
  check((await card.POST(req('/api/card-checkout/session',validPayload))).status,403,'card ownership required');
  check((await card.POST(req('/api/card-checkout/session',validPayload,valid))).status,200,'legitimate card checkout retained');
  check(cardSent.amount,93500,'provider amount in pennies');
  check(cardSent.capture_mode,'automatic','automatic capture retained');
  check((await card.POST(req('/api/card-checkout/session',validPayload,valid))).status,200,'retry reuses existing checkout');
  check(providerCalls,1,'no duplicate provider request');
  sessions.get(valid.paymentId).latestStatus.status='COMPLETED';
  check((await card.POST(req('/api/card-checkout/session',validPayload,valid))).status,409,'completed order immutable');
  const voucher=fresh(), voucherPayload={...cardPayload(voucher),total:885,discountCode:'FIXTURE50',discountAmount:999};
  check((await card.POST(req('/api/card-checkout/session',voucherPayload,voucher))).status,200,'valid voucher checkout');
  check(cardSent.amount,88500,'voucher amount server-derived');

  let fpSent;
  const fp=loader({...baseMocks,'@/lib/mock-tymit':{},'@/lib/frasers-plus':{
    getFrasersPlusConfig:()=>({useMock:false}),buildMerchantDefaults:()=>({merchantId:'fixture-merchant',merchantName:'Fixture'}),resolveMerchantRedirectBase:()=>origin+'/return',buildMerchantRedirectUrl:(base,id)=>base+'?rt='+returns.createFrasersPlusReturnToken(id),
    frasersPlusRequest:async(route,init)=>{providerCalls++;fpSent=JSON.parse(init.body);return {response:{ok:true,status:200},data:{uniquePaymentReference:'fixture-upr',redirectUrl:'https://example.test/approval'}};},
  }})('@/app/api/frasers-plus/payment/route');
  const fa=fresh(), fpValid=fpPayload(fa);
  check((await fp.POST(req('/api/frasers-plus/payment',fpValid))).status,403,'Frasers ownership required');
  check((await fp.POST(req('/api/frasers-plus/payment',{...fpValid,paymentAmount:{amount:1,currency:'GBP'}},fa))).status,409,'Frasers price tampering rejected');
  check((await fp.POST(req('/api/frasers-plus/payment',fpValid,fa))).status,200,'legitimate Frasers retained');
  check(fpSent.paymentAmount.amount,935,'Frasers authoritative amount');
  check(fpSent.merchant.id,'fixture-merchant','merchant configuration preserved');
  check(fpSent.metadata.chargerSlug,'seven-pro-tethered','capture metadata preserved');
  check((await fp.POST(req('/api/frasers-plus/payment',fpValid,fa))).status,200,'Frasers retry retained');
  check(providerCalls,3,'Frasers retry does not duplicate payment');

  const target=loader()('@/lib/payment-handoff-target').safePaymentHandoffTarget;
  for(const unsafe of ['javascript:alert(1)','//evil.example','https://revolut.com.evil.example','https://revolut.com@evil.example','https://evil.example','http://pay.revolut.com','/\\evil.example']) check(target(unsafe),'/', 'unsafe handoff rejected');
  for(const safe of ['https://checkout.revolut.com/pay/fixture','https://frasersplusweb.staging.tymit.com/checkout-payment?sessionId=fixture','https://application.pay.frasers.plus/','/mock-hpp?upr=fixture']) check(target(safe),safe,'provider handoff retained');
  const freshRoute=loader()('@/app/api/checkout-session/route');
  const freshResponse=await freshRoute.POST(req('/api/checkout-session',{paymentId:access.paymentId}));
  check(freshResponse.status,200,'fresh capability issuance');
  const issued=await freshResponse.json();
  check(issued.paymentId!==access.paymentId,true,'cannot mint capability for existing order');
  check(accessLib.verifyCheckoutAccess(access.paymentId,issued.token),false,'issued token cannot authorize victim order');

  const noSecret=loader({}, {NODE_ENV:'production'})('@/lib/jumptech');
  check(noSecret.verifyJumptechWebhookSignature('{}','',''),false,'missing webhook secret fails closed');
  const jt=loader({}, {...env,JUMPTECH_WEBHOOK_SECRET:'fixture-jumptech-secret'})('@/lib/jumptech');
  const crypto=require('node:crypto');
  for(const delta of [0,-60_000,60_000,-3600_000,3600_000]) {
    const time=new Date(Date.now()+delta).toISOString();
    const sig=crypto.createHmac('sha256','fixture-jumptech-secret').update(time+'{}').digest('base64');
    check(jt.verifyJumptechWebhookSignature('{}',sig,time),Math.abs(delta)<300000,'fresh signed webhook/retry');
    check(jt.verifyJumptechWebhookSignature('{"tampered":true}',sig,time),false,'tampered webhook rejected');
  }
  check(jt.verifyJumptechWebhookSignature('{}','bogus',new Date().toISOString()),false,'invalid signature rejected');

  let cookie='',enabled=true;
  const admins=loader({'next/headers':{cookies:async()=>({get:()=>({value:cookie})})},'@/lib/admin-users':{getManagedAdminUserByUsername:async()=>({enabled}),hasManagedAdminUsers:async()=>true}})('@/lib/admin-auth');
  cookie=await admins.createAdminSessionToken('fixture@example.test');
  check(Boolean(await admins.getAdminSession()),true,'enabled admin retained');
  enabled=false;check(await admins.getAdminSession(),null,'disabled admin session revoked');
  check(admins.verifyAdminSessionToken(cookie+'.extra'),null,'extra token segments rejected');
  console.log(JSON.stringify({passed:checks,providerCallsMocked:providerCalls,externalNetworkCalls:0,productionWrites:0}));
}
main().catch(error=>{console.error(error.message);console.error(error.stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1;});
