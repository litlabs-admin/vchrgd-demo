const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the real workflow logic against an in-memory store, never production data.
const store = new Map();
const dedupe = new Set();
let sends = 0;
let jumptechWrites = 0;
const clone = value => structuredClone(value);
const mocks = {
  '@/lib/server-data': {
    withJsonFileTransaction: async (_key, action) => action(),
    readJsonFile: async (key, fallback) => clone(store.get(key) ?? fallback),
    writeJsonFile: async (key, value) => store.set(key, clone(value)),
    tryReserveDedupeKey: async (scope, key) => {
      const k = `${scope}:${key}`;
      if (dedupe.has(k)) return false;
      dedupe.add(k); return true;
    },
    releaseDedupeKey: async (scope, key) => dedupe.delete(`${scope}:${key}`),
  },
  '@/lib/gmail-sender': {
    isGmailSenderConfigured: () => true,
    sendGmailMessage: async () => { sends++; return { id: 'test-message' }; },
  },
  '@/lib/frasers-plus-merchant-state': { recordAdminAuditEvent: async () => {} },
  '@/lib/checkout-interactions': {},
  '@/lib/jumptech': {
    isJumptechConfigured: () => true,
    updateJumptechProjectStatus: async () => { jumptechWrites++; return { response: {ok:true} }; },
  },
  '@/lib/app-url': { getCustomerAppUrl: () => 'https://payments.vchrgd.app' },
};
const cache = new Map();
function load(specifier) {
  if (mocks[specifier]) return mocks[specifier];
  if (!specifier.startsWith('@/')) return require(specifier);
  if (cache.has(specifier)) return cache.get(specifier).exports;
  const file = path.join(__dirname, '..', 'src', specifier.slice(2)) + '.ts';
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports:{} }; cache.set(specifier, module);
  const fn = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, {filename:file});
  fn(load, module, module.exports); return module.exports;
}
const workflows = load('@/lib/post-survey-workflows');
const emails = load('@/lib/additional-costs-email-sender');
const sync = load('@/lib/workflow-sync');
const base = {
  id:'fixture',sourcePaymentId:'VCHRGD-FIXTURE',currentPaymentId:'VCHRGD-FIXTURE',
  sourceKind:'payment',provider:'CARD',paymentChoice:'card',createdAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),customerName:'Test Customer',customerEmail:'test@example.com',
  originalAmount:935,amendedAmount:1181,balanceDue:246,additionalInstallationCosts:246,
  surveyStatus:'BOOKED_FOR_INSTALLATION',topUpPaymentStatus:'NONE',refundStatus:'NONE',
  reviewToken:'test-token',bookingApprovedAt:'2026-09-02T12:00:00Z',bookedAt:'2026-09-08T12:00:00Z',
  installationDate:'2026-09-14T12:00:00Z',installerName:'Test Installer',history:[],
  jumptech:{projectId:'fixture-project',status:'SCHEDULED',currentStatusLabel:'SCHEDULED',createdAt:'2026-08-12T12:00:00Z'},
};
function seed(w=base) { store.set('post-survey-workflows.json', {workflows:[clone(w)]}); }
function current() {return clone(store.get('post-survey-workflows.json').workflows[0]);}
async function main() {
  let checks = 0;
  for (const stage of ['AWAITING_SURVEY','SURVEY_RECEIVED','REVIEW_READY','BALANCE_PENDING','READY_FOR_BOOKING','BOOKED_FOR_INSTALLATION','INSTALLED']) {
    for (const payment of ['NONE','PENDING','FAILED','CANCELLED']) {
      const w = {...base,surveyStatus:stage,topUpPaymentStatus:payment};
      assert.equal(workflows.canPayWorkflowBalance(w),true,`${stage}/${payment} must remain payable`);
      assert.equal(workflows.isSurveyReviewLinkExpired(w),false); checks++;
    }
    assert.equal(workflows.canPayWorkflowBalance({...base,surveyStatus:stage,topUpPaymentStatus:'COMPLETED'}),false);checks++;
  }
  for(const status of ['REQUESTED','APPROVED','COMPLETED']) {
    assert.equal(workflows.canPayWorkflowBalance({...base,refundStatus:status}),false);checks++;
  }
  assert.equal(workflows.canPayWorkflowBalance({...base,surveyStatus:'DECLINED'}),false);checks++;
  assert.equal(workflows.canPayWorkflowBalance({...base,amendedAmount:935}),false);checks++;
  for(const stage of ['BOOKED_FOR_INSTALLATION','INSTALLED']) {
    seed({...base,surveyStatus:stage});
    await workflows.attachTopUpPaymentToWorkflow(base.id,'test',{paymentId:'VCHRGD-FIXTURE-topup-1',paymentChoice:'card'});
    assert.equal(current().surveyStatus,stage); checks++;
    await workflows.failSurveyWorkflowTopUp(base.id,'test',{status:'FAILED',detail:'Test decline'});
    assert.equal(current().surveyStatus,stage); checks++;
    assert.equal(workflows.canPayWorkflowBalance(current()),true); checks++;
    await workflows.completeSurveyWorkflowTopUp(base.id,'test','Test completion');
    assert.equal(current().surveyStatus,stage); checks++;
    assert.equal(current().balanceDue,0);checks++;
    assert.equal(workflows.canPayWorkflowBalance(current()),false);checks++;
    assert.equal(current().installationDate,base.installationDate);checks++;
    await sync.markJumptechQuoteApprovedForWorkflow(base.id,'test');
    assert.equal(jumptechWrites,0);checks++;
    await workflows.recordJumptechProjectUpdate(base.id,'test',{
      projectId:base.jumptech.projectId,status:stage==='INSTALLED'?'INSTALLED':'SCHEDULED',
      additionalInstallationCosts:246,quoteTotal:1181,
    });
    assert.equal(current().balanceDue,0);checks++;
  }
  assert.match(emails.getAdditionalCostsEmailIneligibilityReason(base),/not QUOTE/);checks++;
  assert.equal(emails.getAdditionalCostsEmailIneligibilityReason(base,{allowProgressedOrder:true}),null);checks++;
  seed();process.env.ADDITIONAL_COSTS_EMAILS_ENABLED='true';
  const first=await emails.sendAdditionalCostsEmailForWorkflow({workflow:current(),allowProgressedOrder:true});
  assert.equal(first.state,'sent');checks++;
  const second=await emails.sendAdditionalCostsEmailForWorkflow({workflow:current(),allowProgressedOrder:true});
  assert.equal(second.state,'ineligible');assert.equal(sends,1);checks+=2;
  assert.equal(current().surveyStatus,'BOOKED_FOR_INSTALLATION');checks++;
  assert.equal(current().additionalCostsEmailSentAmount,246);checks++;
  const duplicate=await emails.sendAdditionalCostsEmailForWorkflow({workflow:base,allowProgressedOrder:true});
  assert.equal(duplicate.state,'duplicate');assert.equal(sends,1);checks+=2;
  console.log(`Passed ${checks} balance visibility, stage preservation, settlement and email recovery checks.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
