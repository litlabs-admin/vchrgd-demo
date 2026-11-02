import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

type InstallerRecord = {
  id: string;
  displayName: string;
  legalName: string;
  aliases: string[];
  address: {
    line1: string;
    line2?: string;
    town: string;
    county?: string;
    postcode: string;
    country: string;
  };
  vatNumber?: string;
  email?: string;
  phone?: string;
  defaultNetAmount: number;
  vatRate: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type InstallerDirectory = {
  installers: InstallerRecord[];
  lastPoSequenceYear: number;
  lastPoSequence: number;
  updatedAt: string;
};

type InstallerMatch = {
  installer: InstallerRecord;
  score: number;
  matchedOn: string;
};

const INSTALLERS_FILE = "installers.json";

const DEFAULT_INSTALLER_DIRECTORY: InstallerDirectory = {
  installers: [],
  lastPoSequenceYear: 2026,
  lastPoSequence: 0,
  updatedAt: new Date(0).toISOString(),
};

function normaliseText(value: string | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normaliseAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
}

function normaliseVatRate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Number(parsed.toFixed(2)))) : 20;
}

function normaliseDefaultPoAmount(value: unknown, vatRate: number) {
  const amount = normaliseAmount(value);

  // Earlier imported installer records stored the standard installer PO as net
  // (366.67). The back office now stores and displays this value as VAT-inclusive.
  if (vatRate === 20 && Math.abs(amount - 366.67) <= 0.01) {
    return 440;
  }

  return amount;
}

function splitAliases(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  return (value || "")
    .split(/[\n,|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeDirectory(input: InstallerDirectory): InstallerDirectory {
  return {
    installers: (input.installers ?? []).map((installer) => {
      const vatRate = normaliseVatRate(installer.vatRate);

      return {
        ...installer,
        aliases: installer.aliases ?? [],
        address: {
          line1: installer.address?.line1 || "",
          line2: installer.address?.line2 || undefined,
          town: installer.address?.town || "",
          county: installer.address?.county || undefined,
          postcode: installer.address?.postcode || "",
          country: installer.address?.country || "United Kingdom",
        },
        defaultNetAmount: normaliseDefaultPoAmount(installer.defaultNetAmount, vatRate),
        vatRate,
        enabled: installer.enabled !== false,
      };
    }),
    lastPoSequenceYear: input.lastPoSequenceYear || new Date().getFullYear(),
    lastPoSequence: Number.isFinite(input.lastPoSequence) ? input.lastPoSequence : 0,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

async function writeInstallerDirectory(directory: InstallerDirectory) {
  await writeJsonFile(INSTALLERS_FILE, {
    ...directory,
    updatedAt: new Date().toISOString(),
  });
}

export async function getInstallerDirectory() {
  const directory = await readJsonFile<InstallerDirectory>(
    INSTALLERS_FILE,
    DEFAULT_INSTALLER_DIRECTORY,
  );
  return mergeDirectory(directory);
}

export function matchInstallerByNameInDirectory(
  directory: InstallerDirectory,
  name: string | undefined,
): InstallerMatch | null {
  const enabled = mergeDirectory(directory).installers.filter((installer) => installer.enabled);
  const candidates = enabled.flatMap((installer) => [
    { installer, name: installer.displayName },
    { installer, name: installer.legalName },
    ...installer.aliases.map((alias) => ({ installer, name: alias })),
  ]);

  const best = candidates
    .map((candidate) => ({
      installer: candidate.installer,
      matchedOn: candidate.name,
      score: scoreCandidate(name || "", candidate.name),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score >= 0.72 ? best : null;
}

export async function upsertInstaller(input: {
  id?: string;
  displayName: string;
  legalName: string;
  aliases?: string | string[];
  addressLine1: string;
  addressLine2?: string;
  town: string;
  county?: string;
  postcode: string;
  country?: string;
  vatNumber?: string;
  email?: string;
  phone?: string;
  defaultNetAmount?: number;
  vatRate?: number;
  enabled?: boolean;
}) {
  return withJsonFileTransaction(INSTALLERS_FILE, async () => {
  const directory = await getInstallerDirectory();
  const now = new Date().toISOString();
  const id = input.id || randomUUID();
  const existing = directory.installers.find((installer) => installer.id === id);
  const installer: InstallerRecord = {
    id,
    displayName: input.displayName.trim() || input.legalName.trim(),
    legalName: input.legalName.trim() || input.displayName.trim(),
    aliases: splitAliases(input.aliases),
    address: {
      line1: input.addressLine1.trim(),
      line2: input.addressLine2?.trim() || undefined,
      town: input.town.trim(),
      county: input.county?.trim() || undefined,
      postcode: input.postcode.trim(),
      country: input.country?.trim() || "United Kingdom",
    },
    vatNumber: input.vatNumber?.trim() || undefined,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    defaultNetAmount: normaliseDefaultPoAmount(
      input.defaultNetAmount ?? existing?.defaultNetAmount ?? 0,
      normaliseVatRate(input.vatRate ?? existing?.vatRate ?? 20),
    ),
    vatRate: normaliseVatRate(input.vatRate ?? existing?.vatRate ?? 20),
    enabled: input.enabled !== false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const installers = existing
    ? directory.installers.map((entry) => (entry.id === id ? installer : entry))
    : [installer, ...directory.installers];

  await writeInstallerDirectory({
    ...directory,
    installers,
  });
  return installer;

  });
}

export async function updateInstallerState(input: {
  id: string;
  enabled?: boolean;
  delete?: boolean;
}) {
  return withJsonFileTransaction(INSTALLERS_FILE, async () => {
  const directory = await getInstallerDirectory();
  const installers = input.delete
    ? directory.installers.filter((installer) => installer.id !== input.id)
    : directory.installers.map((installer) =>
        installer.id === input.id
          ? {
              ...installer,
              enabled: input.enabled ?? installer.enabled,
              updatedAt: new Date().toISOString(),
            }
          : installer,
      );

  await writeInstallerDirectory({
    ...directory,
    installers,
  });

  });
}

function scoreCandidate(input: string, candidate: string) {
  const left = normaliseText(input);
  const right = normaliseText(candidate);
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.86;
  }

  const leftParts = new Set(left.split(" "));
  const rightParts = new Set(right.split(" "));
  const shared = [...leftParts].filter((part) => rightParts.has(part)).length;
  return shared / Math.max(leftParts.size, rightParts.size);
}

export async function matchInstallerByName(name: string | undefined): Promise<InstallerMatch | null> {
  const directory = await getInstallerDirectory();
  return matchInstallerByNameInDirectory(directory, name);
}

export async function getInstallerById(id: string) {
  const directory = await getInstallerDirectory();
  return directory.installers.find((installer) => installer.id === id) ?? null;
}

export async function reservePurchaseOrderNumber() {
  return withJsonFileTransaction(INSTALLERS_FILE, async () => {
  const directory = await getInstallerDirectory();
  const year = new Date().getFullYear();
  const nextSequence =
    directory.lastPoSequenceYear === year ? directory.lastPoSequence + 1 : 1;

  await writeInstallerDirectory({
    ...directory,
    lastPoSequenceYear: year,
    lastPoSequence: nextSequence,
  });

  return `VD2C${String(year).slice(-2)}_${String(nextSequence).padStart(4, "0")}`;

  });
}

export type { InstallerRecord, InstallerDirectory, InstallerMatch };
