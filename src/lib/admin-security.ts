import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS_FILE = "admin-login-attempts.json";

type LoginAttemptState = {
  count: number;
  lockedUntil: number;
  lastAttemptAt?: number;
};

type LoginAttemptFile = {
  attempts: Record<string, LoginAttemptState>;
};

declare global {
  var __adminLoginAttempts: Map<string, LoginAttemptState> | undefined;
}

function attemptStore() {
  globalThis.__adminLoginAttempts ??= new Map<string, LoginAttemptState>();
  return globalThis.__adminLoginAttempts;
}

async function readLoginAttempts() {
  return withJsonFileTransaction(LOGIN_ATTEMPTS_FILE, async () => {
  const state = await readJsonFile<LoginAttemptFile>(LOGIN_ATTEMPTS_FILE, { attempts: {} });
  const now = Date.now();
  let changed = false;

  for (const [key, value] of Object.entries(state.attempts)) {
    const expiredLockout = value.lockedUntil > 0 && value.lockedUntil <= now;
    const staleAttempt =
      !value.lockedUntil &&
      value.lastAttemptAt !== undefined &&
      now - value.lastAttemptAt > LOCKOUT_WINDOW_MS;

    if (expiredLockout || staleAttempt) {
      delete state.attempts[key];
      changed = true;
    }
  }

  if (changed) {
    await writeJsonFile(LOGIN_ATTEMPTS_FILE, state);
  }

  return state;

  });
}

async function writeLoginAttempts(state: LoginAttemptFile) {
  await writeJsonFile(LOGIN_ATTEMPTS_FILE, state);
}

export function getAdminAttemptKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  const realIp =
    firstForwardedIp ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "local-dev";

  return realIp;
}

export async function getAdminLoginAttemptState(key: string) {
  const now = Date.now();
  const state = (await readLoginAttempts()).attempts[key] ?? attemptStore().get(key);

  if (!state) {
    return { blocked: false, remainingMs: 0 };
  }

  if (state.lockedUntil > now) {
    return { blocked: true, remainingMs: state.lockedUntil - now };
  }

  if (state.lockedUntil && state.lockedUntil <= now) {
    attemptStore().delete(key);
  }

  return { blocked: false, remainingMs: 0 };
}

export async function registerAdminLoginFailure(key: string) {
  return withJsonFileTransaction(LOGIN_ATTEMPTS_FILE, async () => {
  const now = Date.now();
  const state = await readLoginAttempts();
  const existing = state.attempts[key] ?? attemptStore().get(key);
  const count = (existing?.count ?? 0) + 1;
  const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : 0;
  const next = { count, lockedUntil, lastAttemptAt: now };

  attemptStore().set(key, next);
  state.attempts[key] = next;
  await writeLoginAttempts(state);

  return {
    blocked: lockedUntil > now,
    remainingMs: lockedUntil > now ? lockedUntil - now : 0,
  };

  });
}

export async function clearAdminLoginFailures(key: string) {
  return withJsonFileTransaction(LOGIN_ATTEMPTS_FILE, async () => {
  attemptStore().delete(key);
  const state = await readLoginAttempts();
  if (state.attempts[key]) {
    delete state.attempts[key];
    await writeLoginAttempts(state);
  }

  });
}

export function formatRemainingLockoutMs(remainingMs: number) {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
}
