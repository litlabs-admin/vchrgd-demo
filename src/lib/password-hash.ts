import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function safeEqual(left: Buffer, right: Buffer) {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export function verifyPasswordHash(password: string, storedHash: string) {
  if (!storedHash.startsWith("scrypt$")) {
    return false;
  }

  const [, saltValue, keyValue] = storedHash.split("$");
  if (!saltValue || !keyValue) {
    return false;
  }

  const salt = Buffer.from(saltValue, "base64url");
  const expectedKey = Buffer.from(keyValue, "base64url");
  const derivedKey = scryptSync(password, salt, expectedKey.length || KEY_LENGTH);

  return safeEqual(derivedKey, expectedKey);
}
