import {
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
  type JsonWebKey,
} from "node:crypto";
import { cookies } from "next/headers";
import {
  getAdminAuthConfig,
  isBootstrapAdminConfigured,
} from "@/lib/admin-auth";
import { getManagedAdminUserByUsername } from "@/lib/admin-users";

const GOOGLE_OAUTH_STATE_COOKIE = "vchrgd_google_oauth_state";
const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

type GoogleOAuthStatePayload = {
  state: string;
  nonce: string;
  returnTo: string;
  exp: number;
};

type GoogleTokenResponse = {
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleJwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  hd?: string;
  sub?: string;
};

type GoogleAdminIdentity = {
  username: string;
  source: "bootstrap" | "managed";
  mfaRequired: boolean;
  googleEmail: string;
};

type GoogleJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
};

let cachedJwks:
  | {
      expiresAt: number;
      keys: GoogleJwk[];
    }
  | null = null;

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function decodeJwtSegment<T>(segment: string) {
  return JSON.parse(base64UrlDecode(segment)) as T;
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

function readList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getGoogleAdminConfig() {
  return {
    clientId:
      process.env.GOOGLE_ADMIN_CLIENT_ID ||
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      "",
    clientSecret:
      process.env.GOOGLE_ADMIN_CLIENT_SECRET ||
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      process.env.GOOGLE_CLIENT_SECRET ||
      "",
    redirectUri:
      process.env.GOOGLE_ADMIN_REDIRECT_URI ||
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      "",
    hostedDomain:
      process.env.GOOGLE_ADMIN_HOSTED_DOMAIN ||
      process.env.GOOGLE_OAUTH_HOSTED_DOMAIN ||
      "",
    allowedDomains: readList(process.env.GOOGLE_ADMIN_ALLOWED_DOMAINS),
  };
}

function getOAuthSigningSecret() {
  return getAdminAuthConfig().sessionSecret;
}

function resolveRedirectUri(request: Request) {
  const { redirectUri } = getGoogleAdminConfig();
  const requestUrl = new URL(request.url);

  if (redirectUri) {
    const configuredRedirect = new URL(redirectUri);
    if (configuredRedirect.host === requestUrl.host) {
      return redirectUri;
    }

    if (process.env.GOOGLE_ADMIN_USE_CONFIGURED_REDIRECT === "true") {
      return redirectUri;
    }
  }

  return `${requestUrl.origin}/api/admin/google/callback`;
}

function normalizeReturnTo(request: Request, value: string | null) {
  if (!value) {
    return "/backoffice";
  }

  try {
    const requestUrl = new URL(request.url);
    const target = new URL(value, requestUrl.origin);
    if (target.origin === requestUrl.origin && target.pathname.startsWith("/backoffice")) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    return "/backoffice";
  }

  return "/backoffice";
}

function createStateToken(payload: GoogleOAuthStatePayload) {
  const secret = getOAuthSigningSecret();
  if (!secret) {
    throw new Error("Missing ADMIN_SESSION_SECRET");
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function verifyStateToken(token: string) {
  const secret = getOAuthSigningSecret();
  if (!secret || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as GoogleOAuthStatePayload;
    if (!payload.state || !payload.nonce || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function emailDomain(value: string) {
  return value.split("@")[1]?.toLowerCase() || "";
}

function googleDomainAllowed(payload: GoogleIdTokenPayload) {
  const { allowedDomains } = getGoogleAdminConfig();
  if (!allowedDomains.length) {
    return true;
  }

  const email = payload.email || "";
  const domain = emailDomain(email);
  const hostedDomain = (payload.hd || "").toLowerCase();
  return allowedDomains.includes(domain) || allowedDomains.includes(hostedDomain);
}

async function fetchGoogleJwks() {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to retrieve Google signing keys.");
  }

  const payload = (await response.json()) as { keys?: GoogleJwk[] };
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || "300");
  cachedJwks = {
    expiresAt: now + Math.max(maxAge, 60) * 1000,
    keys: payload.keys || [],
  };
  return cachedJwks.keys;
}

async function verifyGoogleJwtSignature(idToken: string, header: GoogleJwtHeader) {
  if (header.alg !== "RS256" || !header.kid) {
    return false;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return false;
  }

  const jwk = (await fetchGoogleJwks()).find((key) => key.kid === header.kid);
  if (!jwk) {
    return false;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  return verifier.verify(
    createPublicKey({
      key: jwk,
      format: "jwk",
    }),
    Buffer.from(encodedSignature, "base64url"),
  );
}

export function isGoogleAdminAuthConfigured() {
  const { clientId, clientSecret } = getGoogleAdminConfig();
  return Boolean(clientId && clientSecret && getOAuthSigningSecret());
}

export async function createGoogleAdminAuthorization(request: Request) {
  const { clientId, hostedDomain } = getGoogleAdminConfig();
  if (!isGoogleAdminAuthConfigured()) {
    throw new Error("Google admin sign-in is not configured.");
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const requestUrl = new URL(request.url);
  const returnTo = normalizeReturnTo(request, requestUrl.searchParams.get("returnTo"));
  const redirectUri = resolveRedirectUri(request);
  const cookieStore = await cookies();

  cookieStore.set(
    GOOGLE_OAUTH_STATE_COOKIE,
    createStateToken({
      state,
      nonce,
      returnTo,
      exp: Math.floor(Date.now() / 1000) + GOOGLE_OAUTH_STATE_TTL_SECONDS,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS,
    },
  );

  const authUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");
  if (hostedDomain) {
    authUrl.searchParams.set("hd", hostedDomain);
  }

  return authUrl;
}

export async function consumeGoogleAdminAuthorization(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code") || "";
  const state = requestUrl.searchParams.get("state") || "";
  const cookieStore = await cookies();
  const storedState = verifyStateToken(cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value || "");

  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  if (!code || !state || !storedState || storedState.state !== state) {
    throw new Error("Google sign-in state could not be verified.");
  }

  const { clientId, clientSecret } = getGoogleAdminConfig();
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: resolveRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenPayload.id_token) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || "Google token exchange failed.");
  }

  const payload = await verifyGoogleIdToken(tokenPayload.id_token, storedState.nonce);
  const identity = await authenticateGoogleAdminEmail(payload.email || "");
  if (!identity) {
    throw new Error("Google account is not authorised for back office access.");
  }

  return {
    identity,
    returnTo: storedState.returnTo,
    googleSubject: payload.sub || "",
  };
}

export async function verifyGoogleIdToken(idToken: string, nonce: string) {
  const [encodedHeader, encodedPayload] = idToken.split(".");
  if (!encodedHeader || !encodedPayload) {
    throw new Error("Google ID token was malformed.");
  }

  const header = decodeJwtSegment<GoogleJwtHeader>(encodedHeader);
  const payload = decodeJwtSegment<GoogleIdTokenPayload>(encodedPayload);
  const { clientId } = getGoogleAdminConfig();
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud || ""];
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  if (!(await verifyGoogleJwtSignature(idToken, header))) {
    throw new Error("Google ID token signature could not be verified.");
  }

  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("Google ID token issuer was not accepted.");
  }

  if (!aud.includes(clientId)) {
    throw new Error("Google ID token audience did not match this app.");
  }

  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Google ID token has expired.");
  }

  if (!payload.nonce || payload.nonce !== nonce) {
    throw new Error("Google ID token nonce did not match this sign-in attempt.");
  }

  if (!payload.email || !emailVerified) {
    throw new Error("Google account email could not be verified.");
  }

  if (!googleDomainAllowed(payload)) {
    throw new Error("Google account domain is not authorised for this back office.");
  }

  return payload;
}

export async function authenticateGoogleAdminEmail(email: string) {
  const normalizedEmail = normalizeUsername(email);
  const config = getAdminAuthConfig();

  if (isBootstrapAdminConfigured() && normalizeUsername(config.username) === normalizedEmail) {
    return {
      username: config.username,
      source: "bootstrap",
      mfaRequired: true,
      googleEmail: normalizedEmail,
    } satisfies GoogleAdminIdentity;
  }

  const user = await getManagedAdminUserByUsername(normalizedEmail);
  if (!user || !user.enabled) {
    return null;
  }

  return {
    username: user.username,
    source: "managed",
    mfaRequired: user.mfaRequired,
    googleEmail: normalizedEmail,
  } satisfies GoogleAdminIdentity;
}
