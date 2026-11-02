const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const base = path.resolve(root, '../frasers-prebooking-stage-alerts');
const { readProtected } = require('./click-source-guards.cjs');
let checks = 0;
const eq = (a, b, message) => { checks++; assert.deepEqual(a, b, message); };
const yes = (value, message) => { checks++; assert.ok(value, message); };
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function loader(env = { APP_DATA_STORE: 'memory', NODE_ENV: 'development' }, mocks = {}, globals = {}) {
  const cache = new Map();
  const load = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (!name.startsWith('@/')) {
      if (name.startsWith('node:') || ['react', 'react/jsx-runtime', 'react-dom/server'].includes(name)) return require(name);
      if (name === 'postgres') return () => { throw Error('Unexpected database connection'); };
      if (name === 'next/link') return props => require('react').createElement('a', props, props.children);
      throw Error(`Unexpected import: ${name}`);
    }
    let file = path.join(root, 'src', name.slice(2));
    file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText, { module, exports: module.exports, require: load, process: { env },
      Buffer, Request, Response, URL, Intl, Date, TextEncoder, Uint8Array, console,
      fetch: () => { throw Error('External fetch forbidden'); }, ...globals }, { filename: file });
    return module.exports;
  };
  return load;
}
const normal = value => JSON.parse(JSON.stringify(value));
async function main() {
  // Removing only instrumentation must reproduce every deployed baseline file.
  let preserved = 0;
  const walk = relative => {
    for (const item of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name);
      if (item.isDirectory()) walk(name);
      else { eq(readProtected(name, root), readProtected(name, base), `Protected source: ${name}`); preserved++; }
    }
  };
  // Current security-release scope is verified separately against its own live baseline.
  if (process.env.SECURITY_REGRESSION !== 'true') {
  walk('src'); walk('public');
  for (const file of ['package.json', 'package-lock.json', 'vercel.json', 'next.config.ts']) {
    eq(read(file), fs.readFileSync(path.join(base, file), 'utf8'), `Protected configuration: ${file}`);
  }
  }

  const load = loader();
  const events = load('@/lib/checkout-click-events');
  const store = load('@/lib/server-data');
  const logic = load('@/lib/checkout-clicks');
  eq(Object.keys(events.CHECKOUT_CLICK_EVENTS).length, 15);
  for (const value of [null, 5, '__proto__', 'constructor', 'email', '']) eq(events.isCheckoutClickEvent(value), false);
  for (const event of Object.keys(events.CHECKOUT_CLICK_EVENTS)) eq(events.isCheckoutClickEvent(event), true);
  eq(logic.checkoutClickDay(new Date('2026-09-16T23:30:00Z')), '2026-09-17', 'UK summer day boundary');
  eq(logic.checkoutClickDay(new Date('2026-12-16T23:30:00Z')), '2026-12-16', 'UK winter day boundary');
  await Promise.all(Array.from({ length: 100 }, () => store.incrementCheckoutClickCounter('2026-09', '2026-09-17:frasers_eligibility')));
  eq((await store.readJsonFile('checkout-clicks-2026-09.json', {}))['2026-09-17:frasers_eligibility'], 100);
  await assert.rejects(() => store.incrementCheckoutClickCounter('../merchant-state', 'x')); checks++;
  await assert.rejects(() => store.incrementCheckoutClickCounter('2026-09', '2026-08-31:frasers_eligibility')); checks++;
  await store.writeJsonFile('checkout-clicks-2026-09.json', { '2026-09-30:card_continue': 3, '2026-09-16:frasers_eligibility': 999 });
  await store.writeJsonFile('checkout-clicks-2026-10.json', {
    '2026-10-01:frasers_continue': 2, '2026-10-02:frasers_eligibility': 9,
    '2026-10-02:unknown': 999, '2026-10-02:payment_card': -10,
    '2026-10-02:card_continue': '100', '2026-10-02:payment_frasers': 4,
    '2026-10-03:frasers_eligibility': 999,
  });
  const report = await logic.getCheckoutClickSummary(7, new Date('2026-10-02T12:00:00Z'));
  eq(report.total, 18, 'Dates span month boundaries and ignore invalid/future values');
  eq(report.from, '2026-09-26'); eq(report.to, '2026-10-02'); eq(report.daily.length, 7);
  eq(report.events.find(item => item.event === 'frasers_eligibility').count, 9);
  eq((await logic.getCheckoutClickSummary(90, new Date('2027-01-02T12:00:00Z'))).daily.length, 90);
  for (const days of [7, 30, 90]) {
    const dayZero = await logic.getCheckoutClickSummary(days, new Date('2026-09-17T12:00:00Z'));
    eq(dayZero.trackingStartedOn, '2026-09-17'); eq(dayZero.from, '2026-09-17');
    eq(dayZero.daily.length, 1); eq(dayZero.total, 0, 'No pre-launch history or local preview clicks');
  }
  eq((await logic.getCheckoutClickSummary(7, new Date('2026-09-16T12:00:00Z'))).total, 0);

  let writes = [];
  const route = loader(undefined, { '@/lib/checkout-clicks': { recordCheckoutClick: async event => writes.push(event) } })('@/app/api/checkout-clicks/route');
  const makeRequest = (body, extra = {}) => new Request('https://payments.vchrgd.app/api/checkout-clicks', {
    method: 'POST', headers: { origin: 'https://payments.vchrgd.app', 'content-type': 'application/json', ...extra }, body,
  });
  for (const event of Object.keys(events.CHECKOUT_CLICK_EVENTS)) {
    const response = await route.POST(makeRequest(JSON.stringify({ event })));
    eq(response.status, 204); eq(response.headers.get('cache-control'), 'no-store');
  }
  eq(writes.length, 15);
  for (const body of ['null', '[]', '{}', '{', '{"event":"constructor"}', '{"event":"frasers_eligibility","email":"x"}']) {
    eq((await route.POST(makeRequest(body))).status, 400);
  }
  for (const origin of ['', 'https://example.invalid', 'https://payments.vchrgd.app.example.com']) {
    eq((await route.POST(makeRequest('{"event":"frasers_eligibility"}', { origin }))).status, 403);
  }
  eq((await route.POST(makeRequest('{}', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  eq((await route.POST(makeRequest('{}', { 'content-type': 'text/plain' }))).status, 415);
  eq((await route.POST(makeRequest('x'.repeat(129)))).status, 413);
  eq((await route.POST(makeRequest('{}', { 'content-length': '100000' }))).status, 413);
  eq((await route.POST(makeRequest('{"event":"frasers_eligibility"}', { 'sec-gpc': '1' }))).status, 204);
  eq((await route.POST(makeRequest('{"event":"frasers_eligibility"}', { dnt: '1' }))).status, 204);
  eq(writes.length, 15, 'Malformed, foreign and privacy-opt-out events must not write');
  const failed = loader(undefined, { '@/lib/checkout-clicks': { recordCheckoutClick: async () => { throw Error('private storage failure'); } } })('@/app/api/checkout-clicks/route');
  const failure = await failed.POST(makeRequest('{"event":"frasers_eligibility"}'));
  eq(failure.status, 503); eq(await failure.text(), '');

  for (const APP_DATA_STORE of ['remote', 'memory', 'file']) {
    const unavailable = loader({ APP_DATA_STORE, NODE_ENV: 'production', VERCEL: '1' })('@/lib/server-data');
    await assert.rejects(() => unavailable.incrementCheckoutClickCounter('2026-09', '2026-09-17:frasers_eligibility'), /atomic persistent/); checks++;
  }
  const queries = [];
  const sql = (strings, ...values) => { queries.push({ text: strings.join('?'), values }); return Promise.resolve([]); };
  const database = loader({ APP_DATA_STORE: 'supabase', NODE_ENV: 'production', APP_DATA_NAMESPACE: 'test', SUPABASE_DB_URL: 'mock' }, { postgres: () => sql })('@/lib/server-data');
  await database.incrementCheckoutClickCounter('2026-09', '2026-09-17:frasers_eligibility');
  yes(queries.at(-1).text.includes('on conflict (key) do update'));
  yes(queries.at(-1).text.includes('jsonb_set(app_state.payload'));
  eq(queries.at(-1).values[0], 'test:checkout-clicks-2026-09.json');
  yes(queries.every(item => !item.text.includes('select payload')), 'Counter increment must not read then overwrite');

  const requests = [];
  const navigator = { doNotTrack: '0', globalPrivacyControl: false };
  const client = loader(undefined, {}, { window: {}, navigator, fetch: (url, options) => { requests.push({ url, options }); return Promise.resolve({}); } })('@/lib/checkout-click-client');
  client.trackCheckoutClick('frasers_eligibility');
  eq(requests.length, 1);
  eq(requests[0].url, '/api/checkout-clicks');
  eq(JSON.parse(requests[0].options.body), { event: 'frasers_eligibility' });
  eq(requests[0].options.keepalive, true); eq(requests[0].options.credentials, 'omit');
  eq(requests[0].options.referrerPolicy, 'no-referrer');
  navigator.doNotTrack = '1'; client.trackCheckoutClick('card_continue'); eq(requests.length, 1);
  navigator.doNotTrack = '0'; navigator.globalPrivacyControl = true; client.trackCheckoutClick('card_continue'); eq(requests.length, 1);
  navigator.globalPrivacyControl = false; client.trackCheckoutClick('email'); eq(requests.length, 1);
  for (const fetch of [() => { throw Error('blocked'); }, () => Promise.reject(Error('offline'))]) {
    const blocked = loader(undefined, {}, { window: {}, navigator, fetch })('@/lib/checkout-click-client');
    eq(blocked.trackCheckoutClick('frasers_continue'), undefined);
  }
  eq(loader()('@/lib/checkout-click-client').trackCheckoutClick('frasers_continue'), undefined, 'SSR safe');

  class Element {
    constructor(button) { this.button = button; }
    closest(selector) { eq(selector, '[data-checkout-click]'); return this.button; }
  }
  const activated = [];
  const capture = loader(undefined, {}, { Element, window: {}, navigator,
    fetch: (_url, options) => { activated.push(JSON.parse(options.body).event); return Promise.resolve({}); },
  })('@/lib/checkout-click-client').captureCheckoutClick;
  const button = { dataset: { checkoutClick: 'frasers_continue' } };
  const click = { target: new Element(button), currentTarget: { contains: element => element === button },
    preventDefault() { throw Error('Must not block navigation'); }, stopPropagation() { throw Error('Must not block handlers'); } };
  capture(click); eq(activated, ['frasers_continue'], 'Nested logo/icon clicks reach the button marker');
  capture({ ...click, currentTarget: { contains: () => false } }); eq(activated.length, 1);
  capture({ ...click, target: new Element(null) }); eq(activated.length, 1);
  capture({ ...click, target: {} }); eq(activated.length, 1);
  button.dataset.checkoutClick = 'customer_email'; capture(click); eq(activated.length, 1);

  const integration = read('src/components/integration-showcase.tsx');
  for (const value of ['payment_card', 'payment_frasers', 'frasers_continue', 'card_continue', 'continue_details']) {
    yes(integration.includes(`trackingEvent="${value}"`), `Wire ${value}`);
  }
  yes(integration.includes('data-checkout-click={CONTINUE_CLICK_EVENTS[step]}'));
  const popup = read('src/components/frasers-plus-promo-popup.tsx');
  yes(popup.includes('data-checkout-click="frasers_eligibility"'));
  yes(popup.includes('onClickCapture={captureCheckoutClick}'));
  yes(popup.includes('target="_blank"'));
  yes(read('src/app/admin/page.tsx').includes('<CheckoutClickAnalytics range={readParam(params, "clickDays")} />'));
  const { CheckoutClickPanel } = load('@/components/checkout-click-summary');
  const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(CheckoutClickPanel, { data: normal(report) }));
  yes(html.includes('Check eligibility')); yes(html.includes('not unique people'));
  yes(html.includes('clickDays=30')); yes(!html.includes('NaN'));
  yes(html.includes('Day zero: 17 Sept 2026')); yes(html.includes('no historical backfill'));
  console.log(`PASS: ${checks} click tracking/privacy/atomic-counter/source-protection checks; ${preserved} baseline source/assets preserved apart from explicit instrumentation.`);
}
module.exports = { loader };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
