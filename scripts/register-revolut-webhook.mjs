import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const minimumWebhookApiVersion = "2024-09-01";
const defaultEvents = [
  "ORDER_AUTHORISED",
  "ORDER_COMPLETED",
  "ORDER_CANCELLED",
  "ORDER_FAILED",
  "ORDER_PAYMENT_DECLINED",
  "ORDER_PAYMENT_FAILED",
];

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function replaceEnvValue(filePath, key, value) {
  const content = readFileSync(filePath, "utf8");
  const linePattern = new RegExp(`^${key}=.*$`, "m");
  const nextLine = `${key}=${value}`;
  const nextContent = linePattern.test(content)
    ? content.replace(linePattern, nextLine)
    : `${content.trimEnd()}\n${nextLine}\n`;

  writeFileSync(filePath, nextContent, "utf8");
}

function normaliseBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function resolveWebhookApiVersion(env) {
  const configuredVersion = env.REVOLUT_API_VERSION || minimumWebhookApiVersion;
  return configuredVersion >= minimumWebhookApiVersion
    ? configuredVersion
    : minimumWebhookApiVersion;
}

function deriveWebhookUrl(env) {
  const redirectUrl = env.REVOLUT_REDIRECT_URL || "";
  if (!redirectUrl) {
    throw new Error("REVOLUT_REDIRECT_URL is not set in .env.local.");
  }

  const url = new URL(redirectUrl);
  return `${url.origin}/api/revolut/webhook`;
}

async function main() {
  const root = process.cwd();
  const envPath = path.join(root, ".env.local");
  const env = parseEnvFile(envPath);
  const apiKey = env.REVOLUT_API_KEY;
  const apiBaseUrl = normaliseBaseUrl(
    env.REVOLUT_API_BASE_URL || "https://sandbox-merchant.revolut.com",
  );
  const webhookApiVersion = resolveWebhookApiVersion(env);
  const webhookUrl = process.argv[2] || deriveWebhookUrl(env);
  const shouldWriteSecret = process.argv.includes("--write-secret");

  if (!apiKey || apiKey.startsWith("replace-with-")) {
    throw new Error("REVOLUT_API_KEY must be set in .env.local before creating a webhook.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Revolut-Api-Version": webhookApiVersion,
    "Content-Type": "application/json",
  };
  const listResponse = await fetch(`${apiBaseUrl}/api/webhooks`, {
    headers,
  });
  const listBody = await listResponse.json().catch(() => null);

  if (!listResponse.ok) {
    throw new Error(
      `Could not list Revolut webhooks (${listResponse.status}): ${JSON.stringify(listBody)}`,
    );
  }

  const webhooks = Array.isArray(listBody?.webhooks) ? listBody.webhooks : [];
  const configuredWebhookId = env.REVOLUT_WEBHOOK_ID || "";
  const existingWebhook =
    webhooks.find((webhook) => webhook.id === configuredWebhookId) ||
    webhooks.find((webhook) => webhook.url === webhookUrl);
  const endpoint = existingWebhook
    ? `${apiBaseUrl}/api/webhooks/${existingWebhook.id}`
    : `${apiBaseUrl}/api/webhooks`;
  const response = await fetch(endpoint, {
    method: existingWebhook ? "PATCH" : "POST",
    headers: {
      ...headers,
    },
    body: JSON.stringify({
      url: webhookUrl,
      events: defaultEvents,
    }),
  });

  const body = await response.text();
  let data = null;

  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { raw: body };
  }

  if (!response.ok) {
    console.error(`Revolut webhook ${existingWebhook ? "update" : "creation"} failed.`);
    console.error(`Status: ${response.status}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`Revolut webhook ${existingWebhook ? "updated" : "created"}.`);
  console.log(JSON.stringify(data, null, 2));

  if (shouldWriteSecret && data && typeof data === "object") {
    if (typeof data.signing_secret === "string" && data.signing_secret) {
      replaceEnvValue(envPath, "REVOLUT_WEBHOOK_SIGNING_SECRET", data.signing_secret);
      console.log("Updated REVOLUT_WEBHOOK_SIGNING_SECRET in .env.local.");
    }

    if (typeof data.id === "string" && data.id) {
      replaceEnvValue(envPath, "REVOLUT_WEBHOOK_ID", data.id);
      console.log("Stored REVOLUT_WEBHOOK_ID in .env.local.");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
