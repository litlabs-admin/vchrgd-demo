import { isCheckoutClickEvent } from "@/lib/checkout-click-events";
import { recordCheckoutClick } from "@/lib/checkout-clicks";

export const runtime = "nodejs";
export const maxDuration = 10;
const MAX_BODY_BYTES = 128;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403, headers });
  }
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") {
    return new Response(null, { status: 204, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return new Response(null, { status: 415, headers });
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return new Response(null, { status: 413, headers });
  }
  let payload: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return new Response(null, { status: 413, headers });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return new Response(null, { status: 400, headers }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    Object.keys(payload).length !== 1 || !("event" in payload) || !isCheckoutClickEvent(payload.event)) {
    return new Response(null, { status: 400, headers });
  }
  try {
    await recordCheckoutClick(payload.event);
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
