import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const inputPath = process.argv[2] || "C:\\Users\\Alexa\\Downloads\\Contacts.csv";
const repoRoot = process.cwd();
const installersFile = "installers.json";

function readDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.some((value) => value.trim()))
    .map((dataRow) =>
      Object.fromEntries(headers.map((header, index) => [header.replace(/^\*/, ""), dataRow[index] || ""])),
    );
}

function clean(value) {
  return String(value || "").trim();
}

function normaliseVatNumber(value) {
  const cleaned = clean(value).replace(/^GB/i, "GB").replace(/\s+/g, "");
  return cleaned || undefined;
}

function phone(value) {
  const cleaned = clean(value);
  if (!cleaned || /e\+/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function toInstaller(contact) {
  const displayName = clean(contact.ContactName);
  const legalName = clean(contact.LegalName) || displayName;
  const aliases = [displayName, clean(contact.Website)]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  const vatNumber =
    normaliseVatNumber(contact.TaxNumber) ||
    normaliseVatNumber(clean(contact.AccountsPayableTaxCodeName).includes("20%") ? "" : "");

  return {
    id: crypto.randomUUID(),
    displayName,
    legalName,
    aliases,
    address: {
      line1: clean(contact.POAddressLine1),
      line2: [contact.POAddressLine2, contact.POAddressLine3, contact.POAddressLine4]
        .map(clean)
        .filter(Boolean)
        .join(", ") || undefined,
      town: clean(contact.POCity),
      county: clean(contact.PORegion) || undefined,
      postcode: clean(contact.POPostalCode),
      country: clean(contact.POCountry) || "United Kingdom",
    },
    vatNumber,
    email: clean(contact.EmailAddress) || clean(contact.Person1Email) || undefined,
    phone: phone(contact.PhoneNumber) || phone(contact.MobileNumber) || undefined,
    defaultNetAmount: 440,
    vatRate: vatNumber || clean(contact.AccountsPayableTaxCodeName).includes("20%") ? 20 : 0,
    enabled: Boolean(displayName && clean(contact.POAddressLine1) && clean(contact.POPostalCode)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mergeInstallers(existing, imported) {
  const byName = new Map(
    (existing.installers || []).map((installer) => [
      installer.displayName.toLowerCase(),
      installer,
    ]),
  );

  for (const installer of imported) {
    const key = installer.displayName.toLowerCase();
    const previous = byName.get(key);
    byName.set(key, previous ? { ...previous, ...installer, id: previous.id, createdAt: previous.createdAt } : installer);
  }

  return {
    installers: [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    lastPoSequenceYear: existing.lastPoSequenceYear || new Date().getFullYear(),
    lastPoSequence: existing.lastPoSequence || 0,
    updatedAt: new Date().toISOString(),
  };
}

async function readState() {
  const mode = process.env.APP_DATA_STORE || (process.env.VERCEL ? "memory" : "file");
  if (mode === "supabase") {
    const connectionString =
      process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("APP_DATA_STORE=supabase requires a database URL.");
    }
    const sql = postgres(connectionString, { max: 1, prepare: false });
    await sql`
      create table if not exists public.app_state (
        key text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default timezone('utc', now())
      )
    `;
    const rows = await sql`select payload from public.app_state where key = ${installersFile} limit 1`;
    return { mode, sql, state: rows[0]?.payload || { installers: [] } };
  }

  const filePath = path.join(repoRoot, ".data", installersFile);
  if (!existsSync(filePath)) {
    return { mode: "file", filePath, state: { installers: [] } };
  }
  return { mode: "file", filePath, state: JSON.parse(readFileSync(filePath, "utf8")) };
}

async function writeState(target, state) {
  if (target.mode === "supabase") {
    await target.sql`
      insert into public.app_state (key, payload, updated_at)
      values (${installersFile}, ${target.sql.json(state)}::jsonb, timezone('utc', now()))
      on conflict (key)
      do update set payload = excluded.payload, updated_at = excluded.updated_at
    `;
    await target.sql.end();
    return;
  }

  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(path.dirname(target.filePath), { recursive: true });
  writeFileSync(target.filePath, JSON.stringify(state, null, 2), "utf8");
}

readDotEnvFile(path.join(repoRoot, ".env.local"));
readDotEnvFile(path.join(repoRoot, ".env.production.local"));
readDotEnvFile(path.join(repoRoot, ".env.vercel.production.local"));

if (!existsSync(inputPath)) {
  throw new Error(`CSV not found: ${inputPath}`);
}

const contacts = parseCsv(readFileSync(inputPath, "utf8"));
const installerContacts = contacts.filter((contact) => {
  const values = [
    contact.PurchasesTrackingOption1,
    contact.PurchasesTrackingOption2,
    contact.TrackingName1,
    contact.ContactName,
  ].join(" ");
  return /installer/i.test(values) || clean(contact.POAddressLine1);
});
const imported = installerContacts.map(toInstaller).filter((installer) => installer.displayName);
const target = await readState();
const next = mergeInstallers(target.state, imported);
await writeState(target, next);

console.log(`Imported ${imported.length} installers into ${target.mode} store.`);
console.log(`Directory now has ${next.installers.length} installers.`);
