import { randomBytes, randomUUID } from "node:crypto";
import { createPasswordHash } from "@/lib/password-hash";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

const ADMIN_USERS_FILE = "admin-users.json";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

type ManagedAdminUser = {
  id: string;
  username: string;
  passwordHash: string;
  role?: ManagedAdminRole;
  mfaRequired: boolean;
  totpSecret?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  sessionVersion?: string;
};

type ManagedAdminUserStore = {
  users: ManagedAdminUser[];
};

type ManagedAdminRole = "admin" | "super-admin";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function createBase32Secret(length = 32) {
  const bytes = randomBytes(length);
  let output = "";

  for (let index = 0; index < bytes.length; index += 1) {
    output += BASE32_ALPHABET[bytes[index] % BASE32_ALPHABET.length];
  }

  return output;
}

function buildOtpAuthUri(username: string, secret: string, issuer = "VCHRGD Backoffice") {
  const accountLabel = `${issuer}:${username}`;
  const params = new URLSearchParams({
    secret,
    issuer,
  });
  return `otpauth://totp/${encodeURIComponent(accountLabel)}?${params.toString()}`;
}

export function buildManagedAdminOtpAuthUri(username: string, secret: string) {
  return buildOtpAuthUri(username, secret);
}

async function readAdminUserStore() {
  return readJsonFile<ManagedAdminUserStore>(ADMIN_USERS_FILE, { users: [] });
}

async function writeAdminUserStore(store: ManagedAdminUserStore) {
  await writeJsonFile(ADMIN_USERS_FILE, store);
}

export type { ManagedAdminUser };

export async function listManagedAdminUsers() {
  const store = await readAdminUserStore();
  return [...store.users].sort((left, right) => left.username.localeCompare(right.username));
}

export async function getManagedAdminUserById(userId: string) {
  const store = await readAdminUserStore();
  return store.users.find((user) => user.id === userId) ?? null;
}

export async function getManagedAdminUserByUsername(username: string) {
  const normalizedUsername = normalizeUsername(username);
  const store = await readAdminUserStore();
  return (
    store.users.find((user) => normalizeUsername(user.username) === normalizedUsername) ?? null
  );
}

export async function createManagedAdminUser(input: {
  username: string;
  password: string;
  role?: ManagedAdminRole;
  mfaRequired: boolean;
  enabled?: boolean;
  actor: string;
}) {
  return withJsonFileTransaction(ADMIN_USERS_FILE, async () => {
  const username = normalizeUsername(input.username);
  const password = input.password.trim();

  if (!username) {
    throw new Error("Username is required.");
  }

  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters long.");
  }

  const store = await readAdminUserStore();
  if (store.users.some((user) => normalizeUsername(user.username) === username)) {
    throw new Error("An admin user with that username already exists.");
  }

  const now = new Date().toISOString();
  const totpSecret = input.mfaRequired ? createBase32Secret() : undefined;
  const user: ManagedAdminUser = {
    id: randomUUID(),
    username,
    passwordHash: createPasswordHash(password),
    role: input.role ?? "admin",
    mfaRequired: input.mfaRequired,
    totpSecret,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor,
    updatedBy: input.actor,
    sessionVersion: randomUUID(),
  };

  store.users.push(user);
  await writeAdminUserStore(store);

  return {
    user,
    setupUri: totpSecret ? buildOtpAuthUri(user.username, totpSecret) : null,
  };

  });
}

export async function updateManagedAdminUserAccess(input: {
  userId: string;
  role?: ManagedAdminRole;
  mfaRequired: boolean;
  enabled: boolean;
  actor: string;
}) {
  return withJsonFileTransaction(ADMIN_USERS_FILE, async () => {
  const store = await readAdminUserStore();
  const user = store.users.find((entry) => entry.id === input.userId);

  if (!user) {
    throw new Error("Admin user not found.");
  }

  user.enabled = input.enabled;
  user.sessionVersion = randomUUID();
  user.role = input.role ?? "admin";
  user.mfaRequired = input.mfaRequired;
  if (input.mfaRequired && !user.totpSecret) {
    user.totpSecret = createBase32Secret();
  }
  if (!input.mfaRequired) {
    user.totpSecret = undefined;
  }
  user.updatedAt = new Date().toISOString();
  user.updatedBy = input.actor;

  await writeAdminUserStore(store);

  return {
    user,
    setupUri:
      user.mfaRequired && user.totpSecret
        ? buildOtpAuthUri(user.username, user.totpSecret)
        : null,
  };

  });
}

export async function rotateManagedAdminUserPassword(input: {
  userId: string;
  password: string;
  actor: string;
}) {
  return withJsonFileTransaction(ADMIN_USERS_FILE, async () => {
  const password = input.password.trim();
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters long.");
  }

  const store = await readAdminUserStore();
  const user = store.users.find((entry) => entry.id === input.userId);

  if (!user) {
    throw new Error("Admin user not found.");
  }

  user.passwordHash = createPasswordHash(password);
  user.sessionVersion = randomUUID();
  user.updatedAt = new Date().toISOString();
  user.updatedBy = input.actor;

  await writeAdminUserStore(store);
  return user;

  });
}

export async function rotateManagedAdminUserTotpSecret(input: {
  userId: string;
  actor: string;
}) {
  return withJsonFileTransaction(ADMIN_USERS_FILE, async () => {
  const store = await readAdminUserStore();
  const user = store.users.find((entry) => entry.id === input.userId);

  if (!user) {
    throw new Error("Admin user not found.");
  }

  user.mfaRequired = true;
  user.sessionVersion = randomUUID();
  user.totpSecret = createBase32Secret();
  user.updatedAt = new Date().toISOString();
  user.updatedBy = input.actor;

  await writeAdminUserStore(store);

  return {
    user,
    setupUri: buildOtpAuthUri(user.username, user.totpSecret),
  };

  });
}

export async function hasManagedAdminUsers() {
  const store = await readAdminUserStore();
  return store.users.length > 0;
}
