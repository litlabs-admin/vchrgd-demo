import { createHash } from "node:crypto";
import { readJsonFile, releaseDedupeKey, tryReserveDedupeKey, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

type GoogleChatMessage = {
  text: string;
};

type GoogleChatNotificationLedger = {
  sent: Record<string, string>;
};

const GOOGLE_CHAT_LEDGER_FILE = "google-chat-notifications.json";
const MAX_LEDGER_ENTRIES = 500;

function getGoogleChatWebhookUrl() {
  return process.env.GOOGLE_CHAT_WEBHOOK_URL || "";
}

function normaliseNotificationKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

async function hasSentNotification(key: string) {
  const ledger = await readJsonFile<GoogleChatNotificationLedger>(GOOGLE_CHAT_LEDGER_FILE, { sent: {} });
  return Boolean(ledger.sent[normaliseNotificationKey(key)]);
}

async function recordSentNotification(key: string) {
  return withJsonFileTransaction(GOOGLE_CHAT_LEDGER_FILE, async () => {
  const ledger = await readJsonFile<GoogleChatNotificationLedger>(GOOGLE_CHAT_LEDGER_FILE, { sent: {} });
  const hashedKey = normaliseNotificationKey(key);
  ledger.sent[hashedKey] = new Date().toISOString();

  const entries = Object.entries(ledger.sent).sort((left, right) => right[1].localeCompare(left[1]));
  ledger.sent = Object.fromEntries(entries.slice(0, MAX_LEDGER_ENTRIES));

  await writeJsonFile(GOOGLE_CHAT_LEDGER_FILE, ledger);

  });
}

export async function sendGoogleChatNotification(message: string) {
  const webhookUrl = getGoogleChatWebhookUrl();

  if (!webhookUrl) {
    return "NOT_CONFIGURED" as const;
  }

  const payload: GoogleChatMessage = {
    text: message,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(`Google Chat notification failed with ${response.status}.`);
      return "FAILED" as const;
    }
    return "SENT" as const;
  } catch (error) {
    console.warn(
      error instanceof Error
        ? `Google Chat notification failed: ${error.message}`
        : "Google Chat notification failed.",
    );
    // A response may have been lost after delivery. Keep the reservation for
    // operator reconciliation rather than blindly duplicating the message.
    return "UNKNOWN" as const;
  }
}

export async function sendUniqueGoogleChatNotification(key: string, message: string) {
  if (await hasSentNotification(key)) {
    return;
  }

  const reserved = await tryReserveDedupeKey(
    "google-chat-notification",
    normaliseNotificationKey(key),
  );

  if (!reserved) {
    return;
  }

  const result = await sendGoogleChatNotification(message);
  if (result === "SENT") {
    await recordSentNotification(key);
  } else if (result === "FAILED" || result === "NOT_CONFIGURED") {
    await releaseDedupeKey("google-chat-notification", normaliseNotificationKey(key));
  } else {
    console.warn("Google Chat delivery unconfirmed; review the channel before retrying this notification.");
  }
}
