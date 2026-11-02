import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "checkout-recovery";

type CheckoutRecoveryTokenPayload = {
  paymentId: string;
  exp: number;
  purpose: typeof PURPOSE;
};

function getRecoveryTokenSecret() {
  const secret =
    process.env.CHECKOUT_RECOVERY_TOKEN_SECRET || process.env.ADMIN_SESSION_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("Missing CHECKOUT_RECOVERY_TOKEN_SECRET");
  }

  return secret || "local-dev-checkout-recovery-token";
}

function signPayload(payload: string) {
  return createHmac("sha256", getRecoveryTokenSecret()).update(payload).digest("base64url");
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCheckoutRecoveryToken(paymentId: string, ttlSeconds = 5 * 24 * 60 * 60) {
  const cleanPaymentId = paymentId.trim();
  if (!cleanPaymentId) {
    throw new Error("Missing paymentId for checkout recovery token");
  }

  const payload: CheckoutRecoveryTokenPayload = {
    paymentId: cleanPaymentId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    purpose: PURPOSE,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyCheckoutRecoveryToken(token: string) {
  const [encodedPayload, signature, ...extra] = token.split(".");
  if (!encodedPayload || !signature || extra.length) {
    return null;
  }

  if (!safeEquals(signature, signPayload(encodedPayload))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<CheckoutRecoveryTokenPayload>;

    if (
      payload.purpose !== PURPOSE ||
      !payload.paymentId ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      paymentId: payload.paymentId,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
