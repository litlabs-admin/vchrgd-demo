import { NextResponse } from "next/server";
import { verifyCheckoutAccess } from "@/lib/checkout-access";

export class CheckoutRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readCheckoutJson<T>(request: Request): Promise<T> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new CheckoutRequestError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutRequestError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32 * 1024) { await reader.cancel(); throw new CheckoutRequestError("Request too large.", 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value as T;
  } catch { throw new CheckoutRequestError("Invalid JSON."); }
}

export function requireCheckoutAccess(request: Request, paymentId: unknown, bodyToken?: unknown) {
  if (!verifyCheckoutAccess(paymentId, request.headers.get("x-checkout-token") || bodyToken)) {
    throw new CheckoutRequestError("Your secure checkout session has expired. Please reopen your secure email link or refresh to start a new checkout.", 403);
  }
}

export function checkoutErrorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof CheckoutRequestError ? error.message : "Unable to process checkout. Please try again." }, { status: error instanceof CheckoutRequestError ? error.status : 500 });
}

// A bounded per-instance abuse brake; authorization never depends on this cache.
const attempts = new Map<string, { count: number; until: number }>();
export function limitCheckoutRequests(key: string, maximum = 90, windowMs = 60_000) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
  const current = attempts.get(key);
  if (current && current.until > now) {
    if (++current.count > maximum) throw new CheckoutRequestError("Too many requests. Please wait a moment and try again.", 429);
  } else if (attempts.size < 10000) attempts.set(key, { count: 1, until: now + windowMs });
}
