import { randomBytes, scryptSync } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function createPasswordHash(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

function createBase32Secret(length = 32) {
  const bytes = randomBytes(length);
  let output = "";

  for (let index = 0; index < bytes.length; index += 1) {
    output += BASE32_ALPHABET[bytes[index] % BASE32_ALPHABET.length];
  }

  return output;
}

const password = process.argv[2];
const username = process.argv[3] || "backoffice-admin";
const issuer = process.argv[4] || "VCHRGD Backoffice";

if (!password) {
  console.error("Usage: node scripts/generate-backoffice-credentials.mjs <password> [username] [issuer]");
  process.exit(1);
}

const totpSecret = createBase32Secret();
const passwordHash = createPasswordHash(password);
const accountLabel = `${issuer}:${username}`.replace(/ /g, "%20");
const encodedIssuer = issuer.replace(/ /g, "%20");

console.log("");
console.log("Use these values in .env.local:");
console.log(`ADMIN_USERNAME=${username}`);
console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
console.log(`ADMIN_TOTP_SECRET=${totpSecret}`);
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log("");
console.log("Authenticator URI:");
console.log(`otpauth://totp/${accountLabel}?secret=${totpSecret}&issuer=${encodedIssuer}`);
