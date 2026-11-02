import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

const SAVED_VIEWS_FILE = "backoffice-saved-views.json";
const MAX_VIEWS_PER_AGENT = 12;

export const BACKOFFICE_ORDER_FILTER_KEYS = [
  "orderStage",
  "orderProvider",
  "orderPayment",
  "orderInstaller",
  "orderPo",
  "orderDispatch",
  "orderExtras",
  "orderVisibility",
  "orderSla",
  "orderSortBy",
  "orderSort",
] as const;

type BackofficeOrderFilterKey = (typeof BACKOFFICE_ORDER_FILTER_KEYS)[number];

export type BackofficeSavedView = {
  id: string;
  owner: string;
  name: string;
  filters: Partial<Record<BackofficeOrderFilterKey, string>>;
  createdAt: string;
  updatedAt: string;
};

type BackofficeSavedViewsFile = {
  views: BackofficeSavedView[];
};

function normaliseOwner(owner: string) {
  return owner.trim().toLowerCase();
}

function sanitiseFilters(filters: Record<string, string>) {
  return Object.fromEntries(
    BACKOFFICE_ORDER_FILTER_KEYS.flatMap((key) => {
      const value = filters[key]?.trim();
      return value && value.length <= 80 ? [[key, value]] : [];
    }),
  ) as BackofficeSavedView["filters"];
}

async function readSavedViews() {
  return await readJsonFile<BackofficeSavedViewsFile>(SAVED_VIEWS_FILE, { views: [] });
}

export async function listBackofficeSavedViews(owner: string) {
  const normalisedOwner = normaliseOwner(owner);
  const state = await readSavedViews();
  return state.views
    .filter((view) => view.owner === normalisedOwner)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveBackofficeSavedView(input: {
  owner: string;
  name: string;
  filters: Record<string, string>;
}) {
  return withJsonFileTransaction(SAVED_VIEWS_FILE, async () => {
  const owner = normaliseOwner(input.owner);
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 48);
  if (!owner || !name) {
    throw new Error("A saved view name is required.");
  }

  const state = await readSavedViews();
  const now = new Date().toISOString();
  const existing = state.views.find(
    (view) => view.owner === owner && view.name.toLowerCase() === name.toLowerCase(),
  );
  const nextView: BackofficeSavedView = existing
    ? {
        ...existing,
        name,
        filters: sanitiseFilters(input.filters),
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        owner,
        name,
        filters: sanitiseFilters(input.filters),
        createdAt: now,
        updatedAt: now,
      };

  const otherViews = state.views.filter((view) => view.id !== nextView.id);
  const ownerViews = otherViews.filter((view) => view.owner === owner);
  if (!existing && ownerViews.length >= MAX_VIEWS_PER_AGENT) {
    throw new Error(`Each agent can save up to ${MAX_VIEWS_PER_AGENT} views.`);
  }

  await writeJsonFile(SAVED_VIEWS_FILE, {
    views: [...otherViews, nextView],
  } satisfies BackofficeSavedViewsFile);
  return nextView;

  });
}

export async function deleteBackofficeSavedView(owner: string, viewId: string) {
  return withJsonFileTransaction(SAVED_VIEWS_FILE, async () => {
  const normalisedOwner = normaliseOwner(owner);
  const state = await readSavedViews();
  const nextViews = state.views.filter(
    (view) => view.id !== viewId || view.owner !== normalisedOwner,
  );
  if (nextViews.length === state.views.length) {
    return false;
  }

  await writeJsonFile(SAVED_VIEWS_FILE, { views: nextViews } satisfies BackofficeSavedViewsFile);
  return true;

  });
}
