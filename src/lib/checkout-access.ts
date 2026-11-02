import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import { verifyCheckoutRecoveryToken } from "@/lib/checkout-recovery-token";

export type CheckoutAccess = { paymentId: string; token: string };
const PURPOSE = "checkout-access-v1";
const TTL_SECONDS = 7 * 24 * 60 * 60;

function sign(payload: string) {
  const secret = process.env.CHECKOUT_ACCESS_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("Checkout signing is not configured.");
  return createHmac("sha256", secret || "local-only-checkout-access").update(`${PURPOSE}:${payload}`).digest("base64url");
}

// Keep references below providers' 40-character limit; access depends on the HMAC, not secrecy of the ID.
export function createCheckoutAccess(paymentId = `VCHRGD-${Date.now()}-${randomBytes(8).toString("hex")}`): CheckoutAccess {
  const payload = Buffer.from(JSON.stringify({ paymentId, purpose: PURPOSE, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })).toString("base64url");
  return { paymentId, token: `${payload}.${sign(payload)}` };
}

export function verifyCheckoutAccess(paymentId: unknown, token: unknown) {
  if (typeof paymentId !== "string" || !paymentId || paymentId.length > 160 || typeof token !== "string" || token.length > 2048) return false;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.purpose === PURPOSE && value.paymentId === paymentId && Number.isInteger(value.exp) && value.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function hasCheckoutResumeAccess(paymentId: string, tokens: { ct?: string; rt?: string; recovery?: string }) {
  if (verifyCheckoutAccess(paymentId, tokens.ct)) return true;
  if (tokens.rt && verifyFrasersPlusReturnToken(paymentId, tokens.rt)) return true;
  return Boolean(tokens.recovery && verifyCheckoutRecoveryToken(tokens.recovery)?.paymentId === paymentId);
}

export function checkoutResumePath(access: CheckoutAccess) {
  return `/?resume=payment&paymentId=${encodeURIComponent(access.paymentId)}&ct=${encodeURIComponent(access.token)}`;
}
