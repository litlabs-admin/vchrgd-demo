import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

type CheckoutInteractionStatus =
  | "ACTIVE"
  | "PAYMENT_PENDING"
  | "PAYMENT_COMPLETED"
  | "EXITED_SURVEY_LATER"
  | "ABANDONED";

type CheckoutInteractionTrace = {
  id: string;
  at: string;
  type: string;
  label: string;
  detail: string;
};

type CheckoutInteraction = {
  id: string;
  paymentId: string;
  startedAt: string;
  updatedAt: string;
  detailsSubmittedAt?: string | null;
  lastStep: number;
  selectedSlug?: string | null;
  chargerName?: string | null;
  paymentChoice?: string | null;
  propertyType?: string | null;
  parkingType?: string | null;
  fuseBoxDistance?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  total?: number;
  status: CheckoutInteractionStatus;
  lastReason?: string;
  recoveryEmails?: {
    sent24hAt?: string;
    sent72hAt?: string;
  };
  trace: CheckoutInteractionTrace[];
};

type CheckoutInteractionInput = {
  paymentId: string;
  lastStep: number;
  selectedSlug?: string | null;
  chargerName?: string | null;
  paymentChoice?: string | null;
  propertyType?: string | null;
  parkingType?: string | null;
  fuseBoxDistance?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  total?: number;
  status?: CheckoutInteractionStatus;
  reason?: string;
  detailsSubmitted?: boolean;
};

const CHECKOUT_INTERACTIONS_FILE = "checkout-interactions.json";
const MAX_TRACE_ENTRIES = 40;
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

function getStepLabel(step: number) {
  switch (step) {
    case 1:
      return "Selection";
    case 2:
      return "Property";
    case 3:
      return "Parking";
    case 4:
      return "Cable run";
    case 5:
      return "Details";
    case 6:
      return "Payment";
    default:
      return `Step ${step}`;
  }
}

async function readInteractions() {
  return readJsonFile<CheckoutInteraction[]>(CHECKOUT_INTERACTIONS_FILE, []);
}

async function writeInteractions(interactions: CheckoutInteraction[]) {
  await writeJsonFile(CHECKOUT_INTERACTIONS_FILE, interactions);
}

function appendTrace(
  trace: CheckoutInteractionTrace[],
  next: Omit<CheckoutInteractionTrace, "id" | "at">,
) {
  const entry: CheckoutInteractionTrace = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...next,
  };
  return [entry, ...trace].slice(0, MAX_TRACE_ENTRIES);
}

function addDerivedTrace(
  existing: CheckoutInteraction | undefined,
  next: CheckoutInteraction,
  reason?: string,
) {
  let trace = existing?.trace ?? [];

  if (!existing) {
    trace = appendTrace(trace, {
      type: "checkout_started",
      label: "Checkout started",
      detail: "Customer entered the checkout flow.",
    });
  }

  if (existing?.lastStep !== next.lastStep) {
    trace = appendTrace(trace, {
      type: "step_changed",
      label: `Reached ${getStepLabel(next.lastStep)}`,
      detail: `Customer moved to ${getStepLabel(next.lastStep)}.`,
    });
  }

  if (existing?.selectedSlug !== next.selectedSlug && next.chargerName) {
    trace = appendTrace(trace, {
      type: "charger_selected",
      label: "Charger selected",
      detail: next.chargerName,
    });
  }

  if (existing?.paymentChoice !== next.paymentChoice && next.paymentChoice) {
    trace = appendTrace(trace, {
      type: "payment_choice",
      label: "Payment route chosen",
      detail: next.paymentChoice,
    });
  }

  if (existing?.propertyType !== next.propertyType && next.propertyType) {
    trace = appendTrace(trace, {
      type: "property_answer",
      label: "Property answer",
      detail: next.propertyType,
    });
  }

  if (existing?.parkingType !== next.parkingType && next.parkingType) {
    trace = appendTrace(trace, {
      type: "parking_answer",
      label: "Parking answer",
      detail: next.parkingType,
    });
  }

  if (existing?.fuseBoxDistance !== next.fuseBoxDistance && next.fuseBoxDistance) {
    trace = appendTrace(trace, {
      type: "cable_answer",
      label: "Cable run answer",
      detail: next.fuseBoxDistance,
    });
  }

  if (!existing?.detailsSubmittedAt && next.detailsSubmittedAt) {
    trace = appendTrace(trace, {
      type: "details_submitted",
      label: "Customer details submitted",
      detail:
        [next.customerFirstName, next.customerLastName].filter(Boolean).join(" ") ||
        "Customer details carried into payment.",
    });
  }

  if (existing?.status !== next.status) {
    trace = appendTrace(trace, {
      type: "status_changed",
      label: `Status changed to ${next.status}`,
      detail: reason || next.status,
    });
  }

  return trace;
}

export async function upsertCheckoutInteraction(input: CheckoutInteractionInput) {
  return withJsonFileTransaction(CHECKOUT_INTERACTIONS_FILE, async () => {
  const interactions = await readInteractions();
  const existing = interactions.find((interaction) => interaction.paymentId === input.paymentId);
  const now = new Date().toISOString();
  const detailsSubmittedAt =
    input.detailsSubmitted === true
      ? existing?.detailsSubmittedAt ?? now
      : existing?.detailsSubmittedAt ?? null;
  const nextBase: CheckoutInteraction = {
    id: existing?.id ?? randomUUID(),
    paymentId: input.paymentId,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    detailsSubmittedAt,
    lastStep: input.lastStep,
    selectedSlug: input.selectedSlug ?? existing?.selectedSlug ?? null,
    chargerName: input.chargerName ?? existing?.chargerName ?? null,
    paymentChoice: input.paymentChoice ?? existing?.paymentChoice ?? null,
    propertyType: input.propertyType ?? existing?.propertyType ?? null,
    parkingType: input.parkingType ?? existing?.parkingType ?? null,
    fuseBoxDistance: input.fuseBoxDistance ?? existing?.fuseBoxDistance ?? null,
    customerFirstName: input.customerFirstName ?? existing?.customerFirstName ?? null,
    customerLastName: input.customerLastName ?? existing?.customerLastName ?? null,
    customerEmail: input.customerEmail ?? existing?.customerEmail ?? null,
    customerPhone: input.customerPhone ?? existing?.customerPhone ?? null,
    billingLine1: input.billingLine1 ?? existing?.billingLine1 ?? null,
    billingLine2: input.billingLine2 ?? existing?.billingLine2 ?? null,
    billingCity: input.billingCity ?? existing?.billingCity ?? null,
    billingPostalCode: input.billingPostalCode ?? existing?.billingPostalCode ?? null,
    billingCountry: input.billingCountry ?? existing?.billingCountry ?? null,
    total: input.total ?? existing?.total,
    status: input.status ?? existing?.status ?? "ACTIVE",
    lastReason: input.reason ?? existing?.lastReason,
    recoveryEmails: existing?.recoveryEmails,
    trace: existing?.trace ?? [],
  };

  const next: CheckoutInteraction = {
    ...nextBase,
    trace: addDerivedTrace(existing, nextBase, input.reason),
  };

  const index = interactions.findIndex((interaction) => interaction.paymentId === input.paymentId);
  if (index >= 0) {
    interactions[index] = next;
  } else {
    interactions.unshift(next);
  }

  await writeInteractions(interactions);
  return next;

  });
}

export async function listCheckoutInteractions() {
  return (await readInteractions()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function getCheckoutInteractionByPaymentId(paymentId: string) {
  return (await readInteractions()).find((interaction) => interaction.paymentId === paymentId);
}

export async function deleteCheckoutInteractionsForPaymentIds(paymentIds: string[]) {
  return withJsonFileTransaction(CHECKOUT_INTERACTIONS_FILE, async () => {
  const ids = new Set(paymentIds.filter(Boolean));
  if (!ids.size) {
    return 0;
  }

  const interactions = await readInteractions();
  const retained = interactions.filter((interaction) => !ids.has(interaction.paymentId));
  await writeInteractions(retained);
  return interactions.length - retained.length;

  });
}

export async function updateCheckoutInteractionStatus(
  paymentId: string,
  status: CheckoutInteractionStatus,
  reason: string,
) {
  return withJsonFileTransaction(CHECKOUT_INTERACTIONS_FILE, async () => {
  const existing = (await readInteractions()).find(
    (interaction) => interaction.paymentId === paymentId,
  );
  if (!existing) {
    return null;
  }

  return await upsertCheckoutInteraction({
    paymentId,
    lastStep: existing.lastStep,
    selectedSlug: existing.selectedSlug,
    chargerName: existing.chargerName,
    paymentChoice: existing.paymentChoice,
    propertyType: existing.propertyType,
    parkingType: existing.parkingType,
    fuseBoxDistance: existing.fuseBoxDistance,
    customerFirstName: existing.customerFirstName,
    customerLastName: existing.customerLastName,
    customerEmail: existing.customerEmail,
    customerPhone: existing.customerPhone,
    billingLine1: existing.billingLine1,
    billingLine2: existing.billingLine2,
    billingCity: existing.billingCity,
    billingPostalCode: existing.billingPostalCode,
    billingCountry: existing.billingCountry,
    total: existing.total,
    status,
    reason,
    detailsSubmitted: Boolean(existing.detailsSubmittedAt),
  });

  });
}

export function getCheckoutInteractionEffectiveStatus(
  interaction: CheckoutInteraction,
): CheckoutInteractionStatus {
  if (
    interaction.status === "ABANDONED" ||
    interaction.status === "EXITED_SURVEY_LATER" ||
    interaction.status === "PAYMENT_COMPLETED"
  ) {
    return interaction.status;
  }

  const updatedAt = new Date(interaction.updatedAt).getTime();
  if (Date.now() - updatedAt > ABANDONED_AFTER_MS) {
    return "ABANDONED";
  }

  return interaction.status;
}

export function isAbandonedInteraction(interaction: CheckoutInteraction) {
  return (
    getCheckoutInteractionEffectiveStatus(interaction) === "ABANDONED" ||
    getCheckoutInteractionEffectiveStatus(interaction) === "EXITED_SURVEY_LATER"
  );
}

export function getCheckoutInteractionLossPoint(interaction: CheckoutInteraction) {
  const effectiveStatus = getCheckoutInteractionEffectiveStatus(interaction);

  if (effectiveStatus === "EXITED_SURVEY_LATER") {
    return "Exited to complete survey later";
  }

  if (interaction.status === "PAYMENT_PENDING" && effectiveStatus === "ABANDONED") {
    return "Dropped off during secure payment handoff";
  }

  if (interaction.lastStep === 6) {
    return "Dropped off at payment choice";
  }

  return `Dropped off at ${getStepLabel(interaction.lastStep)}`;
}

export function hasSubmittedCheckoutDetails(interaction: CheckoutInteraction) {
  return Boolean(interaction.detailsSubmittedAt);
}

export async function markCheckoutRecoveryEmailSent(
  paymentId: string,
  stage: "24h" | "72h",
  detail: string,
) {
  return withJsonFileTransaction(CHECKOUT_INTERACTIONS_FILE, async () => {
  const interactions = await readInteractions();
  const index = interactions.findIndex((interaction) => interaction.paymentId === paymentId);
  if (index < 0) {
    return null;
  }

  const now = new Date().toISOString();
  const existing = interactions[index];
  const recoveryEmails = {
    ...existing.recoveryEmails,
    ...(stage === "24h" ? { sent24hAt: now } : { sent72hAt: now }),
  };

  const next: CheckoutInteraction = {
    ...existing,
    updatedAt: now,
    recoveryEmails,
    trace: appendTrace(existing.trace, {
      type: "checkout_recovery_email_sent",
      label: `${stage} recovery email sent`,
      detail,
    }),
  };

  interactions[index] = next;
  await writeInteractions(interactions);
  return next;

  });
}

export function mapPaymentStateToCheckoutInteractionStatus(paymentStatus: string) {
  switch (paymentStatus) {
    case "AUTHORISED":
    case "APPROVED":
    case "COMPLETED":
      return "PAYMENT_COMPLETED" satisfies CheckoutInteractionStatus;
    case "PROCESSING":
    case "PENDING":
    case "CHECKOUT_CREATED":
    case "RETURNED":
      return "PAYMENT_PENDING" satisfies CheckoutInteractionStatus;
    case "DECLINED":
    case "FAILED":
    case "CANCELLED":
    case "EXPIRED":
      return "ABANDONED" satisfies CheckoutInteractionStatus;
    default:
      return null;
  }
}

export type { CheckoutInteraction, CheckoutInteractionStatus, CheckoutInteractionTrace };
