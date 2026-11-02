const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let checks = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); checks++; }
function throws(fn) { assert.throws(fn); checks++; }
function load(relative, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error("External network is forbidden in pre-release tests"); };
async function main() {
  const bearer = "Bearer " + "a".repeat(64);
  const auth = load("src/lib/frasers-plus-webhook-auth.ts");
  for (const [expected, supplied, status] of [
    ["", "", 503], ["", bearer, 503], ["Basic invalid", bearer, 503], ["Bearer ", bearer, 503],
    [bearer, "", 401], [bearer, "Bearer wrong", 401], [bearer, bearer + " ", 401],
    [bearer, bearer, 200], [` ${bearer}\n`, bearer, 200],
  ]) check(auth.getFrasersPlusWebhookAuthStatus(expected, supplied), status);

  const config = load("src/lib/frasers-plus.ts", {
    "@/lib/frasers-plus-return-token": { createFrasersPlusReturnToken: () => "fixture" },
  });
  const baseEnv = {
    NODE_ENV: "production", FRASERS_PLUS_LIVE_VALIDATION: "false", FRASERS_PLUS_LIVE_PRODUCTION: "true",
    FRASERS_PLUS_LIVE_RETURN_TOKEN_SECRET: "",
    FRASERS_PLUS_USE_MOCK: "false", FRASERS_PLUS_API_KEY: "fixture-proxy-secret", FRASERS_PLUS_MERCHANT_ID: "fixture-store",
    FRASERS_PLUS_API_BASE_URL: "https://frasers-proxy.payments.vchrgd.app/live",
    FRASERS_PLUS_REDIRECT_URL: "https://payments.vchrgd.app/frasers-plus/return",
    FRASERS_PLUS_WEBHOOK_AUTH_VALUE: bearer, FRASERS_PLUS_RETURN_TOKEN_SECRET: "fixture-return-secret",
  };
  Object.assign(process.env, baseEnv);
  check(config.getFrasersPlusConfig().useMock, false);
  for (const [key, value] of [
    ["FRASERS_PLUS_USE_MOCK", "true"], ["FRASERS_PLUS_API_KEY", ""], ["FRASERS_PLUS_API_KEY", "test-api-token"],
    ["FRASERS_PLUS_MERCHANT_ID", ""], ["FRASERS_PLUS_WEBHOOK_AUTH_VALUE", ""], ["FRASERS_PLUS_RETURN_TOKEN_SECRET", ""],
    ["FRASERS_PLUS_API_BASE_URL", "https://merchant-api.frasersplus.fgfs.services"],
    ["FRASERS_PLUS_REDIRECT_URL", "https://staging.vchrgd.app/frasers-plus/return"],
    ["FRASERS_PLUS_LIVE_VALIDATION", "true"],
  ]) { process.env[key] = value; throws(() => config.getFrasersPlusConfig()); Object.assign(process.env, baseEnv); }
  process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET = "";
  try { config.getFrasersPlusConfig(); assert.fail("Missing return secret accepted"); }
  catch (error) {
    check(error.message.includes("FRASERS_PLUS_RETURN_TOKEN_SECRET"), true);
    check(error.message.includes(baseEnv.FRASERS_PLUS_API_KEY), false);
    check(error.message.includes(bearer), false);
  }
  Object.assign(process.env, baseEnv);
  Object.assign(process.env, { FRASERS_PLUS_LIVE_PRODUCTION: "false", FRASERS_PLUS_LIVE_VALIDATION: "true", FRASERS_PLUS_REDIRECT_URL: "https://staging.vchrgd.app/frasers-plus/return" });
  check(config.getFrasersPlusConfig().useMock, false);
  process.env.FRASERS_PLUS_REDIRECT_URL = baseEnv.FRASERS_PLUS_REDIRECT_URL;
  throws(() => config.getFrasersPlusConfig());
  const guards = load("src/lib/mock-route-guards.ts");
  Object.assign(process.env, { SHOW_DEMO_CONTROLS: "true", ENABLE_MOCK_PAYMENT_ROUTES: "true" });
  check(guards.areMockPaymentRoutesEnabled(), false);
  Object.assign(process.env, baseEnv);
  check(guards.areMockPaymentRoutesEnabled(), false);
  process.env.FRASERS_PLUS_LIVE_PRODUCTION = "false";
  check(guards.areMockPaymentRoutesEnabled(), true);
  Object.assign(process.env, { SHOW_DEMO_CONTROLS: "false", ENABLE_MOCK_PAYMENT_ROUTES: "false" });
  check(guards.areMockPaymentRoutesEnabled(), false);

  const tokens = load("src/lib/frasers-plus-return-token.ts");
  Object.assign(process.env, baseEnv);
  process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET = "replace-with-legacy-secret";
  throws(() => config.getFrasersPlusConfig());
  throws(() => tokens.createFrasersPlusReturnToken("VCHRGD-fixture"));
  process.env.FRASERS_PLUS_LIVE_RETURN_TOKEN_SECRET = "dedicated-production-secret-fixture";
  check(config.getFrasersPlusConfig().useMock, false);
  const liveSigned = tokens.createFrasersPlusReturnToken("VCHRGD-fixture");
  check(tokens.verifyFrasersPlusReturnToken("VCHRGD-fixture", liveSigned), true);
  process.env.FRASERS_PLUS_LIVE_PRODUCTION = "false";
  check(tokens.verifyFrasersPlusReturnToken("VCHRGD-fixture", liveSigned), false);
  Object.assign(process.env, baseEnv);
  const signed = tokens.createFrasersPlusReturnToken("VCHRGD-fixture");
  check(tokens.verifyFrasersPlusReturnToken("VCHRGD-fixture", signed), true);
  check(tokens.verifyFrasersPlusReturnToken("VCHRGD-other", signed), false);
  check(tokens.verifyFrasersPlusReturnToken("VCHRGD-fixture", signed + "x"), false);

  const dataStore = new Map();
  const state = load("src/lib/frasers-plus-merchant-state.ts", {
    "@/lib/server-data": {
    withJsonFileTransaction: async (_key, action) => action(),
      readJsonFile: async (key, fallback) => structuredClone(dataStore.get(key) || fallback),
      writeJsonFile: async (key, value) => { dataStore.set(key, structuredClone(value)); },
    },
  });
  const session = {
    paymentId: "VCHRGD-prerelease-fixture", uniquePaymentReference: "upr-fixture", provider: "FRASERS_PLUS",
    amount: 850, currency: "GBP", totalBeforeDiscount: 900, discountAmount: 50, discountCode: "FIXTURE50",
    chargerName: "Seven Pro Tethered", chargerSlug: "seven-pro-tethered",
    latestStatus: { currentType: "AUTHORIZATION", status: "APPROVED", source: "webhook", updatedAt: new Date().toISOString() },
  };
  function resetSession(next = session) { dataStore.set("merchant-state.json", { sessions: [structuredClone(next)], auditEvents: [] }); }
  let requests = [];
  let responses = [];
  const completed = { ok: true, status: 200, data: { type: "CAPTURE", status: "COMPLETED" } };
  const capture = load("src/lib/frasers-plus-capture.ts", {
    "@/lib/frasers-plus": {
      getFrasersPlusConfig: () => ({ useMock: false }),
      frasersPlusRequest: async (url, options) => {
        requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
        const result = responses.shift();
        if (!result) throw new Error("Unexpected provider request");
        if (result instanceof Error) throw result;
        return { response: { ok: result.ok, status: result.status }, data: result.data };
      },
    },
    "@/lib/frasers-plus-merchant-state": state,
  });
  const origin = "https://payments.vchrgd.app";
  resetSession(); responses = [completed];
  check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, true);
  check(requests.length, 1);
  check(requests[0].method, "PUT");
  check(requests[0].body.paymentAmount, { amount: 850, currency: "GBP" });
  check(requests[0].body.metadata, { paymentId: session.paymentId, vchrgdPaymentId: session.paymentId });
  const basket = requests[0].body.basket;
  check(basket.internalOrderId, session.paymentId);
  check(basket.basketItems.products.length, 1);
  check(basket.total, 850);
  check(Math.round((basket.subtotal + basket.tax) * 100), 85000);
  check(basket.discount, 50);
  check(capture.buildFrasersPlusCreditBasket(session, 425).total, 425);
  check(capture.buildFrasersPlusCreditBasket(session, 425).basketItems.products.length, 1);
  check(capture.buildFrasersPlusCreditBasket(session, 425).discount, 25);

  let paid = 0;
  let configured = bearer;
  let workflow = null;
  let topUps = 0;
  let approvals = 0;
  let projects = 0;
  const route = load("src/app/api/frasers-plus/webhook/authorization/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/frasers-plus": { getFrasersPlusConfig: () => ({ webhookAuthValue: configured }) },
    "@/lib/frasers-plus-webhook-auth": auth,
    "@/lib/frasers-plus-merchant-state": state,
    "@/lib/frasers-plus-capture": capture,
    "@/lib/checkout-interactions": { updateCheckoutInteractionStatus: async () => { paid++; } },
    "@/lib/post-survey-workflows": {
      getPostSurveyWorkflowByPaymentId: async () => workflow,
      getOutstandingWorkflowBalance: () => 246,
      completeSurveyWorkflowTopUp: async () => { topUps++; workflow.topUpPaymentStatus = "COMPLETED"; },
    },
    "@/lib/workflow-sync": {
      ensureJumptechProjectForOriginalPayment: async () => { projects++; },
      markJumptechQuoteApprovedForWorkflow: async () => { approvals++; },
    },
  });
  const invoke = (payload, token = bearer) => route.POST(new Request(`${origin}/api/frasers-plus/webhook/authorization`, {
    method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }));
  const approved = { uniquePaymentReference: session.uniquePaymentReference, type: "AUTHORIZATION", status: "APPROVED" };
  check((await invoke(approved)).status, 200);
  check(requests.length, 1); // Captured state survives duplicate authorization.
  check((await state.getPaymentSessionByUpr(session.uniquePaymentReference)).latestStatus.currentType, "CAPTURE");
  configured = ""; check((await invoke("{}")).status, 503); configured = bearer;
  check((await invoke("{}", "")).status, 401);
  check((await invoke("{}", "Bearer wrong")).status, 401);
  for (const invalid of ["null", "not-json", "[]", "{}", { ...approved, status: " " }, { ...approved, uniquePaymentReference: 4 }]) {
    check((await invoke(invalid)).status, 400);
  }
  const stateBeforeUnknown = structuredClone(dataStore.get("merchant-state.json"));
  check((await invoke({ ...approved, uniquePaymentReference: "unknown-staging-reference" })).status, 503);
  check((await invoke({ ...approved, uniquePaymentReference: "mismatched-reference", metadata: { paymentId: session.paymentId } })).status, 503);
  check(dataStore.get("merchant-state.json"), stateBeforeUnknown);
  resetSession(); requests = []; paid = 0;
  for (const status of ["DECLINED", "PENDING", "CANCELLED"]) check((await invoke({ ...approved, status })).status, 200);
  check(requests.length, 0); check(paid, 0);
  responses = [{ ok: false, status: 503, data: {} }];
  check((await invoke(approved)).status, 502); check(paid, 0);
  responses = [completed];
  check((await invoke(approved)).status, 200); check(paid, 1);
  check((await invoke(approved)).status, 200); check(requests.length, 2);

  resetSession(); requests = []; responses = [{ ok: true, status: 202, data: { type: "CAPTURE", status: "PENDING" } }, { ok: true, status: 200, data: { type: "AUTHORIZATION", status: "APPROVED" } }];
  check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, false);
  check(requests.map((item) => item.method), ["PUT", "GET"]);
  check((await state.getPaymentSessionByUpr(session.uniquePaymentReference)).latestStatus.currentType, "AUTHORIZATION");
  resetSession(); responses = [{ ok: true, status: 204, data: null }, completed];
  check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, true);
  resetSession(); responses = [{ ok: false, status: 409, data: {} }, completed];
  check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, true);
  resetSession(); responses = [{ ok: false, status: 409, data: {} }, { ok: true, status: 200, data: { type: "AUTHORIZATION", status: "APPROVED" } }];
  check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, false);
  resetSession(); requests = []; responses = [completed];
  const concurrent = await Promise.all([capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session), capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)]);
  check(concurrent.map((item) => item.ok), [true, true]); check(requests.length, 1);
  resetSession(); requests = [];
  for (const amount of [0, -1, NaN, Infinity]) check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, { ...session, amount })).ok, false);
  check(requests.length, 0);
  resetSession(); responses = [new Error("Mock timeout")];
  await assert.rejects(capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)); checks++;
  responses = [completed]; check((await capture.captureFrasersPlusAuthorization(origin, session.uniquePaymentReference, session)).ok, true);
  for (const type of ["CREDIT", "REVERSAL"]) {
    resetSession({ ...session, latestStatus: { ...session.latestStatus, currentType: type, status: "COMPLETED" } });
    requests = []; paid = 0;
    check((await invoke(approved)).status, 200);
    check((await invoke({ ...approved, type: "CAPTURE", status: "COMPLETED" })).status, 200);
    check(requests.length, 0); check(paid, 0);
    check((await state.getPaymentSessionByUpr(session.uniquePaymentReference)).latestStatus.currentType, type);
  }
  resetSession(); requests = []; responses = [completed]; projects = 0;
  workflow = { id: "workflow-fixture", sourcePaymentId: "VCHRGD-original-fixture", topUpPaymentId: session.paymentId, topUpPaymentStatus: "PENDING" };
  check((await invoke(approved)).status, 200);
  check((await invoke(approved)).status, 200);
  check(topUps, 1); check(approvals, 1); check(projects, 0); check(requests.length, 1);
  console.log(`PASS: ${checks} pre-release assertions. Provider, storage and notifications fully mocked; external fetch forbidden.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv); global.fetch = originalFetch;
});
