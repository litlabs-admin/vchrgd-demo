const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise production functions with synthetic orders and an in-memory store only.
const store = new Map();
let writes = 0;
let checks = 0;
const clone = value => structuredClone(value);
const mocks = {
  '@/lib/server-data': {
    withJsonFileTransaction: async (_key, action) => action(),
    readJsonFile: async (key, fallback) => clone(store.get(key) ?? fallback),
    writeJsonFile: async (key, value) => { writes++; store.set(key, clone(value)); },
  },
};
const cache = new Map();
function load(specifier) {
  if (mocks[specifier]) return mocks[specifier];
  if (!specifier.startsWith('@/')) return require(specifier);
  if (cache.has(specifier)) return cache.get(specifier).exports;
  const file = path.join(__dirname, '..', 'src', specifier.slice(2)) + '.ts';
  let source = fs.readFileSync(file, 'utf8');
  if (specifier === '@/lib/jumptech') source += '\nexport { getJumptechSearchStatusPriority };';
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} }; cache.set(specifier, module);
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, {filename:file})(load, module, module.exports);
  return module.exports;
}
const workflows = load('@/lib/post-survey-workflows');
const jumptech = load('@/lib/jumptech');
const base = {
  id:'dno-fixture', sourcePaymentId:'VCHRGD-DNO-FIXTURE', currentPaymentId:'VCHRGD-DNO-FIXTURE',
  sourceKind:'payment', provider:'CARD', paymentChoice:'card',
  createdAt:'2026-09-17T09:17:00.000Z', updatedAt:'2026-09-22T10:32:00.000Z',
  originalAmount:935, amendedAmount:935, additionalInstallationCosts:0,
  surveyStatus:'REVIEW_READY', surveyReceivedAt:'2026-09-19T14:34:00.000Z',
  surveyReviewedAt:'2026-09-22T10:32:00.000Z', topUpPaymentStatus:'NONE', refundStatus:'NONE',
  preferredInstallationDates:['2026-10-01'], preferredInstallationDatesEnabled:true,
  installerName:'Fixture Installer', reviewToken:'fixture-token', history:[],
  jumptech:{ projectId:'dno-project', integrationId:'VCHRGD-DNO-FIXTURE', status:'IN REVIEW', createdAt:'2026-09-17T09:17:00.000Z' },
};
function seed(overrides={}) { store.set('post-survey-workflows.json', {workflows:[clone({...base,...overrides})]}); writes=0; }
function current() { return clone(store.get('post-survey-workflows.json').workflows[0]); }
function equal(actual, expected, detail) { assert.deepEqual(actual, expected, detail); checks++; }
async function update(input={status:'DNO APPROVED'}) {
  await workflows.recordJumptechProjectUpdate(base.jumptech.projectId, 'jumptech', input);
  return current();
}

async function main() {
  const prebooking = ['AWAITING_SURVEY','SURVEY_RECEIVED','REVIEW_READY','BALANCE_PENDING','READY_FOR_BOOKING'];
  for (const stage of prebooking) {
    for (const payment of ['NONE','PENDING','FAILED','CANCELLED','COMPLETED']) {
      for (const amendedAmount of [935,1181]) {
        const due = amendedAmount > 935 && payment !== 'COMPLETED';
        seed({surveyStatus:stage, topUpPaymentStatus:payment, amendedAmount, bookingApprovedAt:'2026-09-20T10:00:00.000Z'});
        const w = await update();
        equal(w.surveyStatus, due ? 'BALANCE_PENDING' : 'READY_FOR_BOOKING', `${stage}/${payment}/${amendedAmount}`);
        equal(w.balanceDue, due ? 246 : 0);
        equal(Boolean(w.bookingApprovedAt), !due);
        equal(workflows.canPayWorkflowBalance(w), due);
        equal(w.topUpPaymentStatus, payment);
        equal(w.customerDecision, undefined, 'Do not invent customer acceptance');
        equal(w.preferredInstallationDates, base.preferredInstallationDates);
        equal(w.installerName, base.installerName);
      }
    }
  }

  for (const input of [
    {status:'DNO APPROVED'}, {status:'dno approved'}, {status:'DNO-APPROVED'},
    {status:'DNO_APPROVED'}, {status:undefined,currentStatusLabel:'DNO APPROVED'},
  ]) {
    seed(); equal((await update(input)).surveyStatus, 'READY_FOR_BOOKING');
  }
  for (const status of ['DNO SUBMITTED','DNO REJECTED','DNO NOT APPROVED','IN REVIEW','CREATED']) {
    seed(); equal((await update({status})).surveyStatus, 'REVIEW_READY');
    equal(jumptech.getJumptechSearchStatusPriority({status}) < 40, true);
  }
  equal(jumptech.getJumptechSearchStatusPriority({status:'DNO APPROVED'}), 40);
  equal(jumptech.getJumptechSearchStatusPriority({currentStatus:{label:'DNO APPROVED'}}), 40);

  for (const override of [
    {surveyStatus:'BOOKED_FOR_INSTALLATION', bookedAt:'2026-09-22T12:00:00.000Z'},
    {surveyStatus:'INSTALLED', installationDate:'2026-09-22'}, {surveyStatus:'DECLINED'},
    {customerDecision:'DECLINED'}, {refundStatus:'REQUESTED'}, {refundStatus:'APPROVED'},
    {refundStatus:'COMPLETED'}, {archivedAt:'2026-09-22T12:00:00.000Z'},
    {bookedAt:'2026-09-22T12:00:00.000Z'},
  ]) {
    seed(override); const before = current(); const after = await update();
    // A completed refund now closes the order, even if an old operational stage remains.
    equal(after.surveyStatus, override.refundStatus === 'COMPLETED' ? 'DECLINED' : before.surveyStatus);
    equal(after.bookingApprovedAt, before.bookingApprovedAt);
    equal(after.customerDecision, before.customerDecision);
  }
  seed(); equal((await update({status:'DNO APPROVED',jobs:[{scheduledFor:'2026-10-01T09:00:00Z'}]})).surveyStatus, 'BOOKED_FOR_INSTALLATION');

  // Existing DNO approvals must reconcile without a new webhook, once only.
  for (const due of [false,true]) {
    seed({amendedAmount:due ? 1181 : 935, jumptech:{...base.jumptech,status:'DNO APPROVED'}});
    await workflows.syncPostSurveyWorkflows([],[]);
    const first = current();
    equal(first.surveyStatus, due ? 'BALANCE_PENDING' : 'READY_FOR_BOOKING');
    equal(first.balanceDue, due ? 246 : 0);
    equal(first.history.length, 1);
    equal(first.stageClock.status, first.surveyStatus);
    equal(first.surveyReviewedAt, base.surveyReviewedAt);
    equal(first.surveyReceivedAt, base.surveyReceivedAt);
    equal(first.jumptech.status, 'DNO APPROVED');
    const writesBefore = writes;
    await workflows.syncPostSurveyWorkflows([],[]);
    equal(writes, writesBefore, 'Repeated reconciliation must not rewrite state');
    equal(current(), first);
    if (due) {
      await workflows.completeSurveyWorkflowTopUp(base.id, 'test', 'Fixture payment confirmed');
      await workflows.syncPostSurveyWorkflows([],[]);
      equal(current().surveyStatus, 'READY_FOR_BOOKING');
      equal(current().balanceDue, 0);
      equal(workflows.canPayWorkflowBalance(current()), false);
    }
  }
  for (const status of ['DNO SUBMITTED','DNO REJECTED']) {
    seed({jumptech:{...base.jumptech,status}});
    await workflows.syncPostSurveyWorkflows([],[]);
    equal(current().surveyStatus, 'REVIEW_READY');
  }
  seed({jumptech:{...base.jumptech,status:'DNO APPROVED'}, refundStatus:'REQUESTED'});
  await workflows.syncPostSurveyWorkflows([],[]);
  equal(current().surveyStatus, 'REVIEW_READY');

  // Preserve the previous quote-approval balance gate.
  seed({amendedAmount:1181}); equal((await update({status:'QUOTE APPROVED'})).surveyStatus, 'BALANCE_PENDING');
  seed(); equal((await update({status:'QUOTE APPROVED'})).surveyStatus, 'READY_FOR_BOOKING');

  console.log(`Passed ${checks} DNO booking, unpaid-balance, terminal-state and existing-order reconciliation checks.`);
}
main().catch(error => { console.error(error); process.exitCode=1; });
