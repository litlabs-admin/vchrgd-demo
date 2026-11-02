import { randomBytes, randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

type ChargerSlug = "seven-pro-tethered" | "seven-pro-untethered";
type DiscountKind = "SPECIAL_OFFER" | "VOUCHER";
type DiscountAppliesTo = ChargerSlug | "all";

type ProductChargerSetting = {
  slug: ChargerSlug;
  name: string;
  unitPrice: number;
  installedPrice: number;
};

type InstallationAdjustmentSetting = {
  key: string;
  label: string;
  amount: number;
  guidanceText?: string;
};

type ProductDiscount = {
  id: string;
  kind: DiscountKind;
  label: string;
  code?: string;
  bannerContent?: string;
  disclaimerContent?: string;
  amount: number;
  appliesTo: DiscountAppliesTo;
  startsAt?: string;
  expiresAt?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProductSettings = {
  chargers: ProductChargerSetting[];
  adjustments: {
    longCableRun: InstallationAdjustmentSetting;
    cableRun10To20: InstallationAdjustmentSetting;
    cableRunOver20: InstallationAdjustmentSetting;
    streetParking: InstallationAdjustmentSetting;
    flatApartment: InstallationAdjustmentSetting;
  };
  discounts: ProductDiscount[];
  updatedAt: string;
};

const PRODUCT_SETTINGS_FILE = "product-settings.json";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DEFAULT_PRODUCT_SETTINGS: ProductSettings = {
  chargers: [
    {
      slug: "seven-pro-tethered",
      name: "Seven Pro Tethered",
      unitPrice: 550,
      installedPrice: 935,
    },
    {
      slug: "seven-pro-untethered",
      name: "Seven Pro Untethered",
      unitPrice: 500,
      installedPrice: 895,
    },
  ],
  adjustments: {
    longCableRun: {
      key: "longCableRun",
      label: "Cable run above 10m",
      amount: 150,
      guidanceText:
        "Your standard installation includes up to 10m of cable. Longer cable runs may need additional work, which will be confirmed after your digital survey before any extra payment is requested.",
    },
    cableRun10To20: {
      key: "cableRun10To20",
      label: "Cable run 10m to 20m",
      amount: 150,
      guidanceText:
        "Your standard installation includes up to 10m of cable. If your installation needs a 10m to 20m cable run, we will confirm any additional cost after the digital survey has been reviewed.",
    },
    cableRunOver20: {
      key: "cableRunOver20",
      label: "Cable run over 20m",
      amount: 150,
      guidanceText:
        "Your standard installation includes up to 10m of cable. Cable runs over 20m may need additional work and will be reviewed after your digital survey before any extra payment is requested.",
    },
    streetParking: {
      key: "streetParking",
      label: "Street parking installation complexity",
      amount: 250,
      guidanceText:
        "Street parking or shared parking can need additional routing, permissions, or installation work. We will review this after your survey and confirm any extra cost before proceeding.",
    },
    flatApartment: {
      key: "flatApartment",
      label: "Flat / apartment installation complexity",
      amount: 180,
      guidanceText:
        "Flats, apartments, and properties with shared access can need additional permissions or installation work. We will review this after your survey and confirm any extra cost before proceeding.",
    },
  },
  discounts: [],
  updatedAt: new Date(0).toISOString(),
};

function normaliseAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
}

function normaliseGuidanceText(value: unknown, fallback: string | undefined) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normaliseDateOnly(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function normaliseAppliesTo(value: unknown): DiscountAppliesTo {
  return value === "seven-pro-tethered" || value === "seven-pro-untethered"
    ? value
    : "all";
}

function normaliseCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function mergeSettings(input: ProductSettings): ProductSettings {
  const chargerBySlug = new Map(input.chargers?.map((charger) => [charger.slug, charger]));
  const legacyLongCableRunAmount =
    input.adjustments?.longCableRun?.amount ??
    DEFAULT_PRODUCT_SETTINGS.adjustments.longCableRun.amount;

  return {
    chargers: DEFAULT_PRODUCT_SETTINGS.chargers.map((defaultCharger) => {
      const stored = chargerBySlug.get(defaultCharger.slug);
      return {
        ...defaultCharger,
        ...stored,
        unitPrice: normaliseAmount(stored?.unitPrice ?? defaultCharger.unitPrice),
        installedPrice: normaliseAmount(stored?.installedPrice ?? defaultCharger.installedPrice),
      };
    }),
    adjustments: {
      longCableRun: {
        ...DEFAULT_PRODUCT_SETTINGS.adjustments.longCableRun,
        ...input.adjustments?.longCableRun,
        amount: normaliseAmount(
          legacyLongCableRunAmount,
        ),
        guidanceText: normaliseGuidanceText(
          input.adjustments?.longCableRun?.guidanceText,
          DEFAULT_PRODUCT_SETTINGS.adjustments.longCableRun.guidanceText,
        ),
      },
      cableRun10To20: {
        ...DEFAULT_PRODUCT_SETTINGS.adjustments.cableRun10To20,
        ...input.adjustments?.cableRun10To20,
        amount: normaliseAmount(
          input.adjustments?.cableRun10To20?.amount ?? legacyLongCableRunAmount,
        ),
        guidanceText: normaliseGuidanceText(
          input.adjustments?.cableRun10To20?.guidanceText,
          DEFAULT_PRODUCT_SETTINGS.adjustments.cableRun10To20.guidanceText,
        ),
      },
      cableRunOver20: {
        ...DEFAULT_PRODUCT_SETTINGS.adjustments.cableRunOver20,
        ...input.adjustments?.cableRunOver20,
        amount: normaliseAmount(
          input.adjustments?.cableRunOver20?.amount ?? legacyLongCableRunAmount,
        ),
        guidanceText: normaliseGuidanceText(
          input.adjustments?.cableRunOver20?.guidanceText,
          DEFAULT_PRODUCT_SETTINGS.adjustments.cableRunOver20.guidanceText,
        ),
      },
      streetParking: {
        ...DEFAULT_PRODUCT_SETTINGS.adjustments.streetParking,
        ...input.adjustments?.streetParking,
        amount: normaliseAmount(
          input.adjustments?.streetParking?.amount ??
            DEFAULT_PRODUCT_SETTINGS.adjustments.streetParking.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.adjustments?.streetParking?.guidanceText,
          DEFAULT_PRODUCT_SETTINGS.adjustments.streetParking.guidanceText,
        ),
      },
      flatApartment: {
        ...DEFAULT_PRODUCT_SETTINGS.adjustments.flatApartment,
        ...input.adjustments?.flatApartment,
        amount: normaliseAmount(
          input.adjustments?.flatApartment?.amount ??
            DEFAULT_PRODUCT_SETTINGS.adjustments.flatApartment.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.adjustments?.flatApartment?.guidanceText,
          DEFAULT_PRODUCT_SETTINGS.adjustments.flatApartment.guidanceText,
        ),
      },
    },
    discounts: (input.discounts ?? []).map((discount) => ({
      ...discount,
      label: discount.label || discount.code || "Discount",
      code: discount.code ? normaliseCode(discount.code) : undefined,
      bannerContent: typeof discount.bannerContent === "string" ? discount.bannerContent : undefined,
      disclaimerContent:
        typeof discount.disclaimerContent === "string" ? discount.disclaimerContent : undefined,
      amount: normaliseAmount(discount.amount),
      appliesTo: normaliseAppliesTo(discount.appliesTo),
      startsAt: normaliseDateOnly(discount.startsAt),
      expiresAt: normaliseDateOnly(discount.expiresAt),
      enabled: discount.enabled !== false,
    })),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export async function getProductSettings() {
  const settings = await readJsonFile<ProductSettings>(
    PRODUCT_SETTINGS_FILE,
    DEFAULT_PRODUCT_SETTINGS,
  );
  return mergeSettings(settings);
}

async function writeProductSettings(settings: ProductSettings) {
  await writeJsonFile(PRODUCT_SETTINGS_FILE, {
    ...settings,
    updatedAt: new Date().toISOString(),
  });
}

export function generateVoucherCode(prefix = "VCHRGD") {
  const bytes = randomBytes(4);
  const suffix = Array.from(bytes)
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join("");
  return `${normaliseCode(prefix) || "VCHRGD"}-${suffix}`;
}

export async function updateProductPricing(input: {
  tetheredInstalledPrice: number;
  untetheredInstalledPrice: number;
  cableRun10To20Amount?: number;
  cableRun10To20GuidanceText: string;
  cableRunOver20Amount?: number;
  cableRunOver20GuidanceText: string;
  streetParkingAmount?: number;
  streetParkingGuidanceText: string;
  flatApartmentAmount?: number;
  flatApartmentGuidanceText: string;
}) {
  return withJsonFileTransaction(PRODUCT_SETTINGS_FILE, async () => {
  const settings = await getProductSettings();
  const nextSettings: ProductSettings = {
    ...settings,
    chargers: settings.chargers.map((charger) => ({
      ...charger,
      installedPrice:
        charger.slug === "seven-pro-tethered"
          ? normaliseAmount(input.tetheredInstalledPrice)
          : normaliseAmount(input.untetheredInstalledPrice),
    })),
    adjustments: {
      longCableRun: {
        ...settings.adjustments.longCableRun,
        amount: normaliseAmount(
          input.cableRun10To20Amount ?? settings.adjustments.longCableRun.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.cableRun10To20GuidanceText,
          settings.adjustments.longCableRun.guidanceText,
        ),
      },
      cableRun10To20: {
        ...settings.adjustments.cableRun10To20,
        amount: normaliseAmount(
          input.cableRun10To20Amount ?? settings.adjustments.cableRun10To20.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.cableRun10To20GuidanceText,
          settings.adjustments.cableRun10To20.guidanceText,
        ),
      },
      cableRunOver20: {
        ...settings.adjustments.cableRunOver20,
        amount: normaliseAmount(
          input.cableRunOver20Amount ?? settings.adjustments.cableRunOver20.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.cableRunOver20GuidanceText,
          settings.adjustments.cableRunOver20.guidanceText,
        ),
      },
      streetParking: {
        ...settings.adjustments.streetParking,
        amount: normaliseAmount(
          input.streetParkingAmount ?? settings.adjustments.streetParking.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.streetParkingGuidanceText,
          settings.adjustments.streetParking.guidanceText,
        ),
      },
      flatApartment: {
        ...settings.adjustments.flatApartment,
        amount: normaliseAmount(
          input.flatApartmentAmount ?? settings.adjustments.flatApartment.amount,
        ),
        guidanceText: normaliseGuidanceText(
          input.flatApartmentGuidanceText,
          settings.adjustments.flatApartment.guidanceText,
        ),
      },
    },
  };
  await writeProductSettings(nextSettings);
  return nextSettings;

  });
}

export async function createProductDiscount(input: {
  kind: DiscountKind;
  label: string;
  code?: string;
  bannerContent?: string;
  disclaimerContent?: string;
  amount: number;
  appliesTo: DiscountAppliesTo;
  startsAt?: string;
  expiresAt?: string;
  enabled?: boolean;
}) {
  return withJsonFileTransaction(PRODUCT_SETTINGS_FILE, async () => {
  const settings = await getProductSettings();
  const now = new Date().toISOString();
  const code = input.kind === "VOUCHER" ? normaliseCode(input.code || generateVoucherCode()) : undefined;

  if (input.kind === "VOUCHER" && !code) {
    throw new Error("Voucher code is required.");
  }

  if (
    code &&
    settings.discounts.some((discount) => discount.code && normaliseCode(discount.code) === code)
  ) {
    throw new Error("A voucher with that code already exists.");
  }

  const discount: ProductDiscount = {
    id: randomUUID(),
    kind: input.kind,
    label: input.label.trim() || (code ? `Voucher ${code}` : "Special offer"),
    code,
    bannerContent: input.bannerContent?.trim() || undefined,
    disclaimerContent: input.disclaimerContent?.trim() || undefined,
    amount: normaliseAmount(input.amount),
    appliesTo: normaliseAppliesTo(input.appliesTo),
    startsAt: normaliseDateOnly(input.startsAt),
    expiresAt: normaliseDateOnly(input.expiresAt),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };

  await writeProductSettings({
    ...settings,
    discounts: [discount, ...settings.discounts],
  });
  return discount;

  });
}

export async function updateProductDiscount(input: {
  id: string;
  label?: string;
  code?: string;
  bannerContent?: string;
  disclaimerContent?: string;
  amount?: number;
  appliesTo?: DiscountAppliesTo;
  startsAt?: string;
  expiresAt?: string;
  enabled?: boolean;
  delete?: boolean;
}) {
  return withJsonFileTransaction(PRODUCT_SETTINGS_FILE, async () => {
  const settings = await getProductSettings();
  const nextCode = input.code ? normaliseCode(input.code) : undefined;
  if (
    nextCode &&
    settings.discounts.some(
      (discount) =>
        discount.id !== input.id &&
        discount.code &&
        normaliseCode(discount.code) === nextCode,
    )
  ) {
    throw new Error("A voucher with that code already exists.");
  }

  const discounts = input.delete
    ? settings.discounts.filter((discount) => discount.id !== input.id)
    : settings.discounts.map((discount) =>
        discount.id === input.id
          ? {
              ...discount,
              label: input.label !== undefined ? input.label.trim() || discount.label : discount.label,
              code:
                discount.kind === "VOUCHER"
                  ? nextCode ?? (input.code === "" ? undefined : discount.code)
                  : undefined,
              bannerContent:
                input.bannerContent !== undefined
                  ? input.bannerContent.trim() || undefined
                  : discount.bannerContent,
              disclaimerContent:
                input.disclaimerContent !== undefined
                  ? input.disclaimerContent.trim() || undefined
                  : discount.disclaimerContent,
              amount: input.amount !== undefined ? normaliseAmount(input.amount) : discount.amount,
              appliesTo: input.appliesTo !== undefined ? normaliseAppliesTo(input.appliesTo) : discount.appliesTo,
              startsAt: input.startsAt !== undefined ? normaliseDateOnly(input.startsAt) : discount.startsAt,
              expiresAt: input.expiresAt !== undefined ? normaliseDateOnly(input.expiresAt) : discount.expiresAt,
              enabled: input.enabled ?? discount.enabled,
              updatedAt: new Date().toISOString(),
            }
          : discount,
      );

  await writeProductSettings({
    ...settings,
    discounts,
  });

  });
}

export type {
  ChargerSlug,
  DiscountAppliesTo,
  DiscountKind,
  ProductChargerSetting,
  ProductDiscount,
  ProductSettings,
};
