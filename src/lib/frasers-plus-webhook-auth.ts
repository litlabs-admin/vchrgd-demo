import { createHash, timingSafeEqual } from "node:crypto";

export function getFrasersPlusWebhookAuthStatus(configuredValue: string, receivedValue: string) {
  const expected = configuredValue.trim();
  if (!expected || !/^Bearer \S+$/.test(expected)) return 503;
  if (!receivedValue) return 401;

  // Fixed-length digests avoid secret-dependent comparison lengths.
  const expectedDigest = createHash("sha256").update(expected).digest();
  const receivedDigest = createHash("sha256").update(receivedValue).digest();
  return timingSafeEqual(expectedDigest, receivedDigest) ? 200 : 401;
}
