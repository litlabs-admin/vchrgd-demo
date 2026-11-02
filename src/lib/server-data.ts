import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";

type DataStoreMode = "file" | "memory" | "supabase" | "remote";

type StateTransaction = { keys: Set<string>; sql?: postgres.TransactionSql };
const stateTransaction = new AsyncLocalStorage<StateTransaction>();
const localMutations = new Map<string, Promise<unknown>>();

// Keep the existing JSON schema. Serialize the complete read/modify/write, not
// just the final UPSERT. Transaction locks also cover keys not yet inserted.
export async function withJsonFileTransaction<T>(filename: string, action: () => Promise<T>): Promise<T> {
  const key = getNamespacedFilename(filename);
  const current = stateTransaction.getStore();
  if (current?.keys.has(key)) return action();
  const mode = getDataStoreMode();
  if (mode === "remote") {
    throw new Error("Atomic state mutations require Supabase; the legacy remote store has no transaction protocol.");
  }
  if (mode === "supabase") {
    if (current?.sql) {
      await current.sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      current.keys.add(key);
      return action();
    }
    await ensureSupabaseStateTable();
    const sql = getSupabaseSql();
    return sql.begin(async transaction => {
      await transaction`set local lock_timeout = '10s'`;
      await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return stateTransaction.run({ keys: new Set([key]), sql: transaction }, action);
    }) as Promise<T>;
  }
  if (mode === "file" && process.env.NODE_ENV === "production") {
    throw new Error("Production state mutations require Supabase; file locks are process-local.");
  }
  const previous = localMutations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() =>
    stateTransaction.run({ keys: new Set([...(current?.keys ?? []), key]) }, action));
  localMutations.set(key, next);
  try { return await next; }
  finally { if (localMutations.get(key) === next) localMutations.delete(key); }
}

declare global {
  var __vchrgdMemoryDataStore: Map<string, string> | undefined;
  var __vchrgdMemoryDedupeStore: Set<string> | undefined;
  var __vchrgdSupabaseSql: ReturnType<typeof postgres> | undefined;
  var __vchrgdSupabaseReady: Promise<void> | undefined;
  var __vchrgdSupabaseDedupeReady: Promise<void> | undefined;
}

function cloneValue<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getDataNamespace() {
  const namespace = process.env.APP_DATA_NAMESPACE?.trim();
  return namespace ? `${namespace}:` : "";
}

function getNamespacedFilename(filename: string) {
  return `${getDataNamespace()}${filename}`;
}

function getNamespacedScope(scope: string) {
  return `${getDataNamespace()}${scope}`;
}

export function getDataStoreMode(): DataStoreMode {
  const configured = process.env.APP_DATA_STORE?.trim().toLowerCase();
  if (
    configured === "file" ||
    configured === "memory" ||
    configured === "supabase" ||
    configured === "remote"
  ) {
    return configured;
  }

  return process.env.VERCEL ? "memory" : "file";
}

function getRemoteDataStoreConfig() {
  const baseUrl = process.env.APP_DATA_API_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.APP_DATA_API_SECRET?.trim();

  if (!baseUrl || !secret) {
    throw new Error(
      "APP_DATA_STORE=remote requires APP_DATA_API_URL and APP_DATA_API_SECRET.",
    );
  }

  return { baseUrl, secret };
}

async function remoteDataRequest<T>(
  pathName: string,
  init?: { method?: "GET" | "POST" | "PUT"; body?: unknown },
) {
  const { baseUrl, secret } = getRemoteDataStoreConfig();
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: init?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-vchrgd-proxy-secret": secret,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Remote application datastore request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

function getDataDirectory() {
  return path.join(process.cwd(), ".data");
}

function getMemoryStore() {
  if (!globalThis.__vchrgdMemoryDataStore) {
    globalThis.__vchrgdMemoryDataStore = new Map<string, string>();
  }

  return globalThis.__vchrgdMemoryDataStore;
}

function getMemoryDedupeStore() {
  if (!globalThis.__vchrgdMemoryDedupeStore) {
    globalThis.__vchrgdMemoryDedupeStore = new Set<string>();
  }

  return globalThis.__vchrgdMemoryDedupeStore;
}

function ensureDataDirectory() {
  const directory = getDataDirectory();
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  return directory;
}

function resolveSupabaseDatabaseUrl() {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ""
  );
}

function getSupabaseSql() {
  if (!globalThis.__vchrgdSupabaseSql) {
    const connectionString = resolveSupabaseDatabaseUrl();
    if (!connectionString) {
      throw new Error(
        "APP_DATA_STORE=supabase requires SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL.",
      );
    }

    globalThis.__vchrgdSupabaseSql = postgres(connectionString, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }

  return globalThis.__vchrgdSupabaseSql;
}

async function ensureSupabaseStateTable() {
  if (!globalThis.__vchrgdSupabaseReady) {
    const sql = getSupabaseSql();
    globalThis.__vchrgdSupabaseReady = sql`
      create table if not exists public.app_state (
        key text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default timezone('utc', now())
      )
    `.then(() => undefined);
  }

  await globalThis.__vchrgdSupabaseReady;
}

async function ensureSupabaseDedupeTable() {
  if (!globalThis.__vchrgdSupabaseDedupeReady) {
    const sql = getSupabaseSql();
    globalThis.__vchrgdSupabaseDedupeReady = sql`
      create table if not exists public.app_dedupe_keys (
        scope text not null,
        key text not null,
        created_at timestamptz not null default timezone('utc', now()),
        primary key (scope, key)
      )
    `.then(() => undefined);
  }

  await globalThis.__vchrgdSupabaseDedupeReady;
}

export async function readJsonFile<T>(filename: string, fallback: T) {
  const storageKey = getNamespacedFilename(filename);

  if (getDataStoreMode() === "memory") {
    const stored = getMemoryStore().get(storageKey);
    if (!stored) {
      return cloneValue(fallback);
    }

    try {
      return JSON.parse(stored) as T;
    } catch {
      return cloneValue(fallback);
    }
  }

  if (getDataStoreMode() === "supabase") {
    await ensureSupabaseStateTable();
    const sql = stateTransaction.getStore()?.sql ?? getSupabaseSql();
    const rows = await sql<{ payload: T }[]>`
      select payload
      from public.app_state
      where key = ${storageKey}
      limit 1
    `;

    if (!rows.length) {
      return cloneValue(fallback);
    }

    return cloneValue(rows[0].payload);
  }

  if (getDataStoreMode() === "remote") {
    const result = await remoteDataRequest<{ found: boolean; value: T | null }>(
      `/value?key=${encodeURIComponent(storageKey)}`,
    );
    return result.found ? cloneValue(result.value as T) : cloneValue(fallback);
  }

  const filePath = path.join(ensureDataDirectory(), filename);

  if (!existsSync(filePath)) {
    return cloneValue(fallback);
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return cloneValue(fallback);
  }
}

export async function writeJsonFile<T>(filename: string, value: T): Promise<void> {
  if (!stateTransaction.getStore()?.keys.has(getNamespacedFilename(filename))) {
    return withJsonFileTransaction(filename, () => writeJsonFile(filename, value));
  }
  const storageKey = getNamespacedFilename(filename);

  if (getDataStoreMode() === "memory") {
    getMemoryStore().set(storageKey, JSON.stringify(value));
    return;
  }

  if (getDataStoreMode() === "supabase") {
    await ensureSupabaseStateTable();
    const sql = stateTransaction.getStore()?.sql ?? getSupabaseSql();
    await sql`
      insert into public.app_state (key, payload, updated_at)
      values (${storageKey}, ${sql.json(value as postgres.JSONValue)}::jsonb, timezone('utc', now()))
      on conflict (key)
      do update set
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `;
    return;
  }

  if (getDataStoreMode() === "remote") {
    await remoteDataRequest<{ ok: boolean }>("/value", {
      method: "PUT",
      body: { key: storageKey, value },
    });
    return;
  }

  const filePath = path.join(ensureDataDirectory(), filename);
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function incrementCheckoutClickCounter(month: string, field: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
    !/^20\d{2}-\d{2}-\d{2}:[a-z_]+$/.test(field) || !field.startsWith(`${month}-`)) {
    throw new Error("Invalid click counter key.");
  }
  const filename = `checkout-clicks-${month}.json`;
  const storageKey = getNamespacedFilename(filename);
  const mode = getDataStoreMode();
  if (mode === "supabase") {
    await ensureSupabaseStateTable();
    const sql = getSupabaseSql();
    // Increment inside the database: simultaneous visitors must not overwrite counts.
    await sql`
      insert into public.app_state (key, payload, updated_at)
      values (${storageKey}, jsonb_build_object(${field}::text, 1), timezone('utc', now()))
      on conflict (key) do update set
        payload = jsonb_set(app_state.payload, array[${field}]::text[],
          to_jsonb(least(coalesce((app_state.payload ->> ${field})::bigint, 0) + 1, 2147483647)), true),
        updated_at = excluded.updated_at
    `;
    return;
  }
  if (mode === "remote" || (process.env.NODE_ENV === "production" &&
    (mode === "memory" || Boolean(process.env.VERCEL)))) {
    throw new Error("Click tracking requires an atomic persistent datastore.");
  }
  const filePath = mode === "file" ? path.join(ensureDataDirectory(), filename) : "";
  const raw = mode === "memory" ? getMemoryStore().get(storageKey) :
    existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
  const counts = raw ? JSON.parse(raw) as Record<string, number> : {};
  const old = counts[field];
  counts[field] = Math.min((Number.isSafeInteger(old) && old >= 0 ? old : 0) + 1, 2147483647);
  // No await between read and write in local-only file/memory modes.
  if (mode === "memory") getMemoryStore().set(storageKey, JSON.stringify(counts));
  else writeFileSync(filePath, JSON.stringify(counts), "utf8");
}

export async function getJsonFileVersion(filename: string) {
  const storageKey = getNamespacedFilename(filename);

  if (getDataStoreMode() === "memory") {
    const stored = getMemoryStore().get(storageKey);
    return `${storageKey}:${stored?.length ?? 0}:${stored ?? "missing"}`;
  }

  if (getDataStoreMode() === "supabase") {
    await ensureSupabaseStateTable();
    const sql = getSupabaseSql();
    const rows = await sql<{ updated_at: string; payload_hash: string }[]>`
      select updated_at::text, md5(payload::text) as payload_hash
      from public.app_state
      where key = ${storageKey}
      limit 1
    `;

    if (!rows.length) {
      return `${storageKey}:missing`;
    }

    return `${storageKey}:${rows[0].updated_at}:${rows[0].payload_hash}`;
  }

  if (getDataStoreMode() === "remote") {
    const result = await remoteDataRequest<{ version: string }>(
      `/version?key=${encodeURIComponent(storageKey)}`,
    );
    return `${storageKey}:${result.version}`;
  }

  const filePath = path.join(ensureDataDirectory(), filename);
  if (!existsSync(filePath)) {
    return `${filename}:missing`;
  }

  const stats = statSync(filePath);
  return `${filename}:${stats.mtimeMs}:${stats.size}`;
}

export async function tryReserveDedupeKey(scope: string, key: string) {
  const storageScope = getNamespacedScope(scope);
  const dedupeKey = `${storageScope}:${key}`;

  if (getDataStoreMode() === "memory") {
    const store = getMemoryDedupeStore();
    if (store.has(dedupeKey)) {
      return false;
    }

    store.add(dedupeKey);
    return true;
  }

  if (getDataStoreMode() === "supabase") {
    await ensureSupabaseDedupeTable();
    const sql = getSupabaseSql();
    const rows = await sql<{ key: string }[]>`
      insert into public.app_dedupe_keys (scope, key)
      values (${storageScope}, ${key})
      on conflict do nothing
      returning key
    `;

    return rows.length > 0;
  }

  if (getDataStoreMode() === "remote") {
    const result = await remoteDataRequest<{ reserved: boolean }>("/dedupe/reserve", {
      method: "POST",
      body: { scope: storageScope, key },
    });
    return result.reserved;
  }

  const ledger = await readJsonFile<{ reserved: Record<string, string> }>(
    "dedupe-keys.json",
    { reserved: {} },
  );

  if (ledger.reserved[dedupeKey]) {
    return false;
  }

  ledger.reserved[dedupeKey] = new Date().toISOString();
  await writeJsonFile("dedupe-keys.json", ledger);
  return true;
}

export async function releaseDedupeKey(scope: string, key: string) {
  const storageScope = getNamespacedScope(scope);
  const dedupeKey = `${storageScope}:${key}`;

  if (getDataStoreMode() === "memory") {
    getMemoryDedupeStore().delete(dedupeKey);
    return;
  }

  if (getDataStoreMode() === "supabase") {
    await ensureSupabaseDedupeTable();
    const sql = getSupabaseSql();
    await sql`
      delete from public.app_dedupe_keys
      where scope = ${storageScope}
        and key = ${key}
    `;
    return;
  }

  if (getDataStoreMode() === "remote") {
    await remoteDataRequest<{ ok: boolean }>("/dedupe/release", {
      method: "POST",
      body: { scope: storageScope, key },
    });
    return;
  }

  const ledger = await readJsonFile<{ reserved: Record<string, string> }>(
    "dedupe-keys.json",
    { reserved: {} },
  );
  delete ledger.reserved[dedupeKey];
  await writeJsonFile("dedupe-keys.json", ledger);
}
