import { createHmac, timingSafeEqual } from "node:crypto";

function getReturnTokenSecret() {
  if (process.env.FRASERS_PLUS_LIVE_PRODUCTION === "true") {
    const secret = process.env.FRASERS_PLUS_LIVE_RETURN_TOKEN_SECRET || process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET;
    if (!secret || secret.startsWith("replace-with-")) {
      throw new Error("Frasers Plus production return-link signing is not configured.");
    }
    return secret;
  }
  return (
    process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.FRASERS_PLUS_API_KEY ||
    "local-dev-return-token"
  );
}

function sign(paymentId: string) {
  return createHmac("sha256", getReturnTokenSecret()).update(paymentId).digest("base64url");
}

export function createFrasersPlusReturnToken(paymentId: string) {
  return sign(paymentId);
}

export function verifyFrasersPlusReturnToken(paymentId: string, token: string) {
  if (!paymentId || !token) {
    return false;
  }

  const expected = sign(paymentId);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
