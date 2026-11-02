import { createHmac, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeBase32(secret: string) {
  return secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function decodeBase32(secret: string) {
  const normalized = normalizeBase32(secret);
  let bits = "";

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      continue;
    }
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number) {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function generateTotp(secret: string, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(secret, counter);
}

export function verifyTotpCode(secret: string, code: string, window = 1) {
  const sanitized = code.replace(/\s+/g, "");
  if (!secret || !/^\d{6}$/.test(sanitized)) {
    return false;
  }

  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);

  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqual(hotp(secret, nowCounter + offset), sanitized)) {
      return true;
    }
  }

  return false;
}
