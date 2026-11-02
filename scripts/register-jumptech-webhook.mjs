import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}

const envFile = path.join(process.cwd(), ".env.local");
const localEnv = loadEnvFile(envFile);
const config = { ...localEnv, ...process.env };

const apiBaseUrl = (config.JUMPTECH_API_BASE_URL || "https://api.jumptech.co.uk").replace(/\/+$/, "");
const apiToken = config.JUMPTECH_API_TOKEN;
const webhookSecret = config.JUMPTECH_WEBHOOK_SECRET;
const explicitBaseUrl = process.argv[2];
const resolvedBaseUrl =
  explicitBaseUrl ||
  config.PUBLIC_APP_URL ||
  (config.VERCEL_URL ? `https://${config.VERCEL_URL}` : "");

if (!apiToken) {
  throw new Error("JUMPTECH_API_TOKEN is required.");
}

if (!webhookSecret) {
  throw new Error("JUMPTECH_WEBHOOK_SECRET is required.");
}

if (!resolvedBaseUrl) {
  throw new Error("Pass the public app base URL as the first argument or set PUBLIC_APP_URL.");
}

const webhookUrl = `${resolvedBaseUrl.replace(/\/+$/, "")}/api/jumptech/webhook`;
const authorization = apiToken;

async function jumptechRequest(url, init) {
  const requestUrl = new URL(`${apiBaseUrl}${url}`);
  if (
    apiToken &&
    requestUrl.hostname.includes(".staging.") &&
    !requestUrl.searchParams.has("apikey")
  ) {
    requestUrl.searchParams.set("apikey", apiToken);
  }

  const response = await fetch(requestUrl.toString(), {
    ...init,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  return {
    response,
    text,
  };
}

const secretResult = await jumptechRequest("/webhooks/hooks/secret", {
  method: "POST",
  headers: {
    "Content-Type": "text/plain",
  },
  body: webhookSecret,
});

if (!secretResult.response.ok) {
  throw new Error(
    `Unable to set Jumptech webhook secret (${secretResult.response.status}): ${secretResult.text}`,
  );
}

const subscriptionResult = await jumptechRequest("/webhooks/hooks", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    projectUpdateType: "STATUS",
    hookUrl: webhookUrl,
    retryEnabled: true,
  }),
});

if (!subscriptionResult.response.ok) {
  throw new Error(
    `Unable to register Jumptech webhook (${subscriptionResult.response.status}): ${subscriptionResult.text}`,
  );
}

console.log("Jumptech webhook registered.");
console.log(`Webhook URL: ${webhookUrl}`);
console.log(`Response: ${subscriptionResult.text || "No response body"}`);
