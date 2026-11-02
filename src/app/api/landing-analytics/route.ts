import { createHash, randomUUID } from "node:crypto";
import { isLandingPayload } from "@/lib/landing-analytics-events";
import { recordLandingEvent } from "@/lib/landing-analytics";
import { limitCheckoutRequests } from "@/lib/checkout-request";
export const runtime = "nodejs";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store" }, salt = randomUUID();
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers });
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return new Response(null, { status: 204, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return new Response(null, { status: 415, headers });
  if (Number(request.headers.get("content-length")) > 1024) return new Response(null, { status: 413, headers });
  // A short-lived, salted in-memory abuse brake. IP addresses are never written to analytics storage.
  try { const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    limitCheckoutRequests(`landing:${createHash("sha256").update(salt + ip).digest("hex")}`, 600);
  } catch { return new Response(null, { status: 429, headers }); }
  let payload: unknown;
  try {
    const reader = request.body?.getReader();if (!reader) return new Response(null, { status: 400, headers });
    const chunks: Uint8Array[] = [];let size = 0;
    try { while (true) { const { done, value } = await reader.read();if (done) break;size += value.byteLength;
      if (size > 1024) { await reader.cancel();return new Response(null, { status: 413, headers }); }chunks.push(value); }
    } finally { reader.releaseLock(); }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return new Response(null, { status: 400, headers }); }
  if (!isLandingPayload(payload)) return new Response(null, { status: 400, headers });
  try { limitCheckoutRequests(`landing-page:${payload.pageId}`, 90); }
  catch { return new Response(null, { status: 429, headers }); }
  try { await recordLandingEvent(payload);return new Response(null, { status: 204, headers }); }
  catch { return new Response(null, { status: 503, headers }); }
}
