import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT || 3025);
const TARGET_BASE_URL = cleanBaseUrl(
  process.env.TYMIT_API_BASE_URL || "https://merchant-api.staging.tymit.com",
);
const TYMIT_API_KEY = clean(process.env.TYMIT_API_KEY);
const SHARED_SECRET = clean(process.env.VCHRGD_PROXY_SHARED_SECRET);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 256 * 1024);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT"]);
const ALLOWED_PREFIX = "/v1/";
const STATE_PREFIX = "/_state/";
const STATE_FILE = clean(
  process.env.STATE_FILE || "/opt/vchrgd-frasers-proxy/staging-state.json",
);
let stateMutation = Promise.resolve();

function clean(value) {
  return String(value || "").trim();
}

function cleanBaseUrl(value) {
  return clean(value).replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function sendJson(response, status, payload, requestId) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  });
  response.end(JSON.stringify(payload));
}

function getRequestBody(request, requestId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body too large.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", (error) => {
      error.requestId = requestId;
      reject(error);
    });
  });
}

function assertConfigured() {
  if (!TARGET_BASE_URL || !TYMIT_API_KEY || !SHARED_SECRET) {
    throw new Error("Proxy configuration is incomplete.");
  }
}

function emptyState() {
  return { values: {}, dedupe: {} };
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return {
      values: parsed?.values && typeof parsed.values === "object" ? parsed.values : {},
      dedupe: parsed?.dedupe && typeof parsed.dedupe === "object" ? parsed.dedupe : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  const temporaryFile = `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, STATE_FILE);
  await chmod(STATE_FILE, 0o600);
}

function mutateState(mutator) {
  const operation = stateMutation.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  stateMutation = operation.catch(() => undefined);
  return operation;
}

function isValidStateKey(value, maxLength = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

async function readJsonBody(request, requestId) {
  const body = await getRequestBody(request, requestId);
  if (!body.length) {
    return {};
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

async function handleState(request, response, requestId) {
  if (!isAuthorized(request)) {
    return sendJson(response, 401, { error: "Unauthorized." }, requestId);
  }

  const incomingUrl = new URL(request.url, "http://proxy.local");
  const action = incomingUrl.pathname.slice(STATE_PREFIX.length);

  if (request.method === "GET" && action === "value") {
    const key = incomingUrl.searchParams.get("key");
    if (!isValidStateKey(key)) {
      return sendJson(response, 400, { error: "Invalid state key." }, requestId);
    }
    const state = await readState();
    const found = Object.prototype.hasOwnProperty.call(state.values, key);
    return sendJson(
      response,
      200,
      { found, value: found ? state.values[key].value : null },
      requestId,
    );
  }

  if (request.method === "GET" && action === "version") {
    const key = incomingUrl.searchParams.get("key");
    if (!isValidStateKey(key)) {
      return sendJson(response, 400, { error: "Invalid state key." }, requestId);
    }
    const state = await readState();
    return sendJson(
      response,
      200,
      { version: state.values[key]?.updatedAt || "missing" },
      requestId,
    );
  }

  if (request.method === "PUT" && action === "value") {
    const body = await readJsonBody(request, requestId);
    if (!isValidStateKey(body.key)) {
      return sendJson(response, 400, { error: "Invalid state key." }, requestId);
    }
    await mutateState((state) => {
      state.values[body.key] = {
        value: body.value,
        updatedAt: new Date().toISOString(),
      };
    });
    return sendJson(response, 200, { ok: true }, requestId);
  }

  if (request.method === "POST" && action === "dedupe/reserve") {
    const body = await readJsonBody(request, requestId);
    if (!isValidStateKey(body.scope, 256) || !isValidStateKey(body.key)) {
      return sendJson(response, 400, { error: "Invalid dedupe key." }, requestId);
    }
    const dedupeKey = `${body.scope}:${body.key}`;
    const reserved = await mutateState((state) => {
      if (state.dedupe[dedupeKey]) {
        return false;
      }
      state.dedupe[dedupeKey] = new Date().toISOString();
      return true;
    });
    return sendJson(response, 200, { reserved }, requestId);
  }

  if (request.method === "POST" && action === "dedupe/release") {
    const body = await readJsonBody(request, requestId);
    if (!isValidStateKey(body.scope, 256) || !isValidStateKey(body.key)) {
      return sendJson(response, 400, { error: "Invalid dedupe key." }, requestId);
    }
    await mutateState((state) => {
      delete state.dedupe[`${body.scope}:${body.key}`];
    });
    return sendJson(response, 200, { ok: true }, requestId);
  }

  return sendJson(response, 404, { error: "Not found." }, requestId);
}

function isAuthorized(request) {
  return (
    clean(request.headers["x-vchrgd-proxy-secret"]) === SHARED_SECRET ||
    clean(request.headers["x-api-key"]) === SHARED_SECRET
  );
}

function buildTargetUrl(requestUrl) {
  const incoming = new URL(requestUrl, "http://proxy.local");
  const target = new URL(`${TARGET_BASE_URL}${incoming.pathname}`);
  target.search = incoming.search;
  return target;
}

function copyResponseHeaders(headers) {
  const copied = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "connection" ||
      lower === "content-encoding"
    ) {
      continue;
    }
    copied[key] = value;
  }
  copied["Cache-Control"] = "no-store";
  return copied;
}

async function handleProxy(request, response, requestId) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return sendJson(response, 405, { error: "Method not allowed." }, requestId);
  }

  const incomingUrl = new URL(request.url, "http://proxy.local");
  if (!incomingUrl.pathname.startsWith(ALLOWED_PREFIX)) {
    return sendJson(response, 404, { error: "Not found." }, requestId);
  }

  if (!isAuthorized(request)) {
    return sendJson(response, 401, { error: "Unauthorized." }, requestId);
  }

  assertConfigured();

  const body = ["POST", "PUT", "PATCH"].includes(request.method)
    ? await getRequestBody(request, requestId)
    : undefined;
  const targetUrl = buildTargetUrl(request.url);
  const startedAt = Date.now();

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "Content-Type": request.headers["content-type"] || "application/json",
      "x-api-key": TYMIT_API_KEY,
      "X-Request-Id": requestId,
    },
    body: body?.length ? body : undefined,
    redirect: "manual",
  });

  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const headers = copyResponseHeaders(upstream.headers);
  headers["X-Request-Id"] = requestId;

  response.writeHead(upstream.status, headers);
  response.end(upstreamBody);

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      requestId,
      method: request.method,
      path: incomingUrl.pathname,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
    }),
  );
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();

  try {
    if (request.url === "/health") {
      return sendJson(
        response,
        200,
        {
          ok: true,
          target: new URL(TARGET_BASE_URL || "https://invalid.local").hostname,
        },
        requestId,
      );
    }

    if (request.url?.startsWith(STATE_PREFIX)) {
      return await handleState(request, response, requestId);
    }

    await handleProxy(request, response, requestId);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        requestId,
        status,
        error: error instanceof Error ? error.message : "Unexpected proxy error.",
      }),
    );
    sendJson(response, status, { error: "Proxy request failed.", requestId }, requestId);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      message: "VCHRGD Frasers proxy listening",
      port: PORT,
      target: TARGET_BASE_URL,
    }),
  );
});
