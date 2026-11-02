import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const root = process.cwd();
const STATE_KEYS = [
  "checkout-interactions.json",
  "merchant-state.json",
  "mock-tymit-payments.json",
  "post-survey-workflows.json",
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const contents = readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function resolveSupabaseDatabaseUrl() {
  const envSources = [
    process.env,
    parseEnvFile(path.join(root, ".env.local")),
    parseEnvFile(path.join(root, ".env")),
  ];

  for (const source of envSources) {
    const connectionString =
      source.SUPABASE_DB_URL?.trim() ||
      source.DATABASE_URL?.trim() ||
      source.POSTGRES_URL?.trim();

    if (connectionString) {
      return connectionString;
    }
  }

  return "";
}

async function resetSupabaseState() {
  const connectionString = resolveSupabaseDatabaseUrl();
  if (!connectionString) {
    console.log("No Supabase/Postgres connection string found. Skipping remote state reset.");
    return;
  }

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });

  try {
    await sql`
      delete from public.app_state
      where key in ${sql(STATE_KEYS)}
    `;

    console.log(`Cleared remote demo state keys: ${STATE_KEYS.join(", ")}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const targets = [
  path.join(root, ".data"),
  path.join(root, ".next-start-3001.log"),
  path.join(root, ".next-start-3001.err.log"),
];

for (const target of targets) {
  rmSync(target, { force: true, recursive: true });
}

await resetSupabaseState();

console.log("Removed local demo state, cleared persisted back-office demo records, and deleted runtime logs.");
