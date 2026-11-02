import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  getManagedAdminUserByUsername,
  hasManagedAdminUsers,
} from "@/lib/admin-users";
import { verifyPasswordHash } from "@/lib/password-hash";
import { verifyTotpCode } from "@/lib/totp";

const ADMIN_COOKIE_NAME = "vchrgd_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSessionPayload = {
  sub: string;
  exp: number;
  ver: string;
};

type AuthenticatedAdminIdentity = {
  username: string;
  source: "bootstrap" | "managed";
  mfaRequired: boolean;
  sessionVersion?: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function getAdminAuthConfig() {
  const allowPlainPassword =
    process.env.ALLOW_PLAIN_ADMIN_PASSWORD === "true" || process.env.NODE_ENV !== "production";

  return {
    username: process.env.ADMIN_USERNAME || "",
    password: process.env.ADMIN_PASSWORD || "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
    totpSecret: process.env.ADMIN_TOTP_SECRET || "",
    sessionSecret: process.env.ADMIN_SESSION_SECRET || "",
    allowPlainPassword,
  };
}

export function isBootstrapAdminConfigured() {
  const { username, password, passwordHash, sessionSecret, totpSecret, allowPlainPassword } =
    getAdminAuthConfig();
  return Boolean(
    username &&
      sessionSecret &&
      totpSecret &&
      (passwordHash || (allowPlainPassword && password)),
  );
}

export async function isAdminAuthConfigured() {
  const { sessionSecret } = getAdminAuthConfig();
  if (!sessionSecret) {
    return false;
  }

  if (isBootstrapAdminConfigured()) {
    return true;
  }

  return await hasManagedAdminUsers();
}

export async function authenticateAdminCredentials(
  username: string,
  password: string,
  totpCode: string,
) {
  const config = getAdminAuthConfig();
  const normalizedUsername = normalizeUsername(username);

  if (isBootstrapAdminConfigured() && normalizeUsername(config.username) === normalizedUsername) {
    const passwordValid = config.passwordHash
      ? verifyPasswordHash(password, config.passwordHash)
      : config.allowPlainPassword
        ? safeEqual(password, config.password)
        : false;
    const totpValid = verifyTotpCode(config.totpSecret, totpCode);

    if (passwordValid && totpValid) {
      return {
        username: config.username,
        source: "bootstrap",
        mfaRequired: true,
        sessionVersion: (await getSessionVersion(config.username)) ?? undefined,
      } satisfies AuthenticatedAdminIdentity;
    }

    return null;
  }

  const user = await getManagedAdminUserByUsername(username);
  if (!user || !user.enabled) {
    return null;
  }

  const passwordValid = verifyPasswordHash(password, user.passwordHash);
  const totpValid = user.mfaRequired
    ? verifyTotpCode(user.totpSecret || "", totpCode)
    : true;

  if (!passwordValid || !totpValid) {
    return null;
  }

  return {
    username: user.username,
    source: "managed",
    mfaRequired: user.mfaRequired,
    sessionVersion: user.sessionVersion ?? "legacy-user-v1",
  } satisfies AuthenticatedAdminIdentity;
}

async function getSessionVersion(username: string) {
  if (isBootstrapSuperAdminUsername(username)) {
    const config = getAdminAuthConfig();
    return createHmac("sha256", config.sessionSecret)
      .update(JSON.stringify([config.username, config.passwordHash, config.password, config.totpSecret]))
      .digest("base64url");
  }
  const user = await getManagedAdminUserByUsername(username);
  return user?.enabled ? user.sessionVersion ?? "legacy-user-v1" : null;
}

export async function createAdminSessionToken(username: string, expectedVersion?: string) {
  const { sessionSecret } = getAdminAuthConfig();
  if (!sessionSecret) {
    throw new Error("Missing ADMIN_SESSION_SECRET");
  }

  const payload: AdminSessionPayload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    ver: (await getSessionVersion(username)) ?? "",
  };
  if (!payload.ver) throw new Error("Administrator access is no longer enabled.");
  if (expectedVersion && !safeEqual(payload.ver, expectedVersion)) throw new Error("Administrator credentials changed during sign-in. Please sign in again.");
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, sessionSecret);
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminSessionToken(token: string) {
  const { sessionSecret } = getAdminAuthConfig();
  if (!sessionSecret || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature, ...extra] = token.split(".");
  if (!encodedPayload || !signature || extra.length) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, sessionSecret);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminSessionPayload;
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.ver !== "string" || !payload.ver || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value ?? "";
  const session = token ? verifyAdminSessionToken(token) : null;
  if (!session) return null;
  const version = await getSessionVersion(session.sub);
  return version && safeEqual(session.ver, version) ? session : null;
}

export async function isAdminAuthenticated() {
  return Boolean(await getAdminSession());
}

export function isBootstrapSuperAdminUsername(username: string) {
  const config = getAdminAuthConfig();
  return isBootstrapAdminConfigured() && normalizeUsername(config.username) === normalizeUsername(username);
}

export async function isSuperAdminUsername(username: string) {
  if (isBootstrapSuperAdminUsername(username)) {
    return true;
  }

  const user = await getManagedAdminUserByUsername(username);
  return Boolean(user?.enabled && user.role === "super-admin");
}

export async function isSuperAdminAuthenticated() {
  const session = await getAdminSession();
  return Boolean(session?.sub && await isSuperAdminUsername(session.sub));
}

export function getBootstrapAdminSummary() {
  if (!isBootstrapAdminConfigured()) {
    return null;
  }

  const config = getAdminAuthConfig();
  return {
    username: config.username,
    mfaRequired: true,
  };
}

export async function setAdminSessionCookie(username: string) {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, await createAdminSessionToken(username), getAdminCookieOptions());
}

export async function setAdminSessionCookieOnResponse(response: NextResponse, username: string, expectedVersion?: string) {
  response.cookies.set(ADMIN_COOKIE_NAME, await createAdminSessionToken(username, expectedVersion), getAdminCookieOptions());
  return response;
}

function getAdminCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "", getAdminCookieOptions(0));
}

export function clearAdminSessionCookieOnResponse(response: NextResponse) {
  response.cookies.set(ADMIN_COOKIE_NAME, "", getAdminCookieOptions(0));
  return response;
}
