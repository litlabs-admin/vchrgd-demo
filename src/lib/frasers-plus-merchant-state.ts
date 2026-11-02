import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

type PaymentAmount = {
  amount: number;
  currency: string;
};

export type MerchantAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
  state?: string;
  region?: string;
};

type AuthorizationWebhookEvent = {
  uniquePaymentReference: string;
  type: string;
  status: string;
  paymentAmount?: PaymentAmount;
  actionDate?: string;
  metadata?: Record<string, string>;
  receivedAt: string;
  raw: unknown;
};

type PaymentProvider = "FRASERS_PLUS" | "CARD";
type CardProcessor = "REVOLUT" | "SQUARE" | "MOCK" | "MANUAL";

type PaymentSnapshot = {
  currentType?: string;
  status: string;
  source: "checkout" | "reconciliation" | "webhook" | "card-return" | "manual";
  updatedAt: string;
};

type PaymentSession = {
  paymentId: string;
  provider: PaymentProvider;
  cardProcessor?: CardProcessor;
  uniquePaymentReference?: string;
  providerPaymentReference?: string;
  // Legacy alias kept for existing local persisted data.
  stripeSessionId?: string;
  redirectUrl?: string;
  createdAt: string;
  updatedAt: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  amount?: number;
  currency?: string;
  hardwarePrice?: number;
  installPrice?: number;
  surveyAdjustment?: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: MerchantAddress;
  deliveryAddress?: MerchantAddress;
  latestStatus?: PaymentSnapshot;
  latestAuthorizationWebhook?: AuthorizationWebhookEvent;
};

type AuditEvent = {
  id: string;
  createdAt: string;
  action: string;
  actor: string;
  target: "AUTH" | "PAYMENT" | "ADMIN" | "WEBHOOK" | "CARD";
  paymentId?: string;
  provider?: PaymentProvider;
  detail: string;
};

type MerchantStateFile = {
  sessions: PaymentSession[];
  auditEvents: AuditEvent[];
};

const MERCHANT_STATE_FILE = "merchant-state.json";
const MAX_AUDIT_EVENTS = 500;

async function readMerchantState() {
  return readJsonFile<MerchantStateFile>(MERCHANT_STATE_FILE, {
    sessions: [],
    auditEvents: [],
  });
}

async function writeMerchantState(state: MerchantStateFile) {
  await writeJsonFile(MERCHANT_STATE_FILE, state);
}

async function appendAuditEvent(event: Omit<AuditEvent, "id" | "createdAt">) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const state = await readMerchantState();
  state.auditEvents.unshift({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  });
  state.auditEvents = state.auditEvents.slice(0, MAX_AUDIT_EVENTS);
  await writeMerchantState(state);

  });
}

function resolveProviderPaymentReference(
  session: Pick<PaymentSession, "providerPaymentReference" | "stripeSessionId"> | undefined,
) {
  return session?.providerPaymentReference ?? session?.stripeSessionId;
}

function indexOfSession(
  sessions: PaymentSession[],
  lookup: { paymentId?: string; uniquePaymentReference?: string; providerPaymentReference?: string },
) {
  return sessions.findIndex(
    (session) =>
      (lookup.paymentId && session.paymentId === lookup.paymentId) ||
      (lookup.uniquePaymentReference &&
        session.uniquePaymentReference === lookup.uniquePaymentReference) ||
      (lookup.providerPaymentReference &&
        resolveProviderPaymentReference(session) === lookup.providerPaymentReference),
  );
}

function mergeSession(
  existing: PaymentSession | undefined,
  next: Partial<PaymentSession> & Pick<PaymentSession, "paymentId" | "provider">,
) {
  const timestamp = new Date().toISOString();
  const providerPaymentReference =
    next.providerPaymentReference ??
    next.stripeSessionId ??
    existing?.providerPaymentReference ??
    existing?.stripeSessionId;

  return {
    paymentId: next.paymentId,
    provider: next.provider,
    cardProcessor: next.cardProcessor ?? existing?.cardProcessor,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    uniquePaymentReference: next.uniquePaymentReference ?? existing?.uniquePaymentReference,
    providerPaymentReference,
    stripeSessionId: providerPaymentReference,
    redirectUrl: next.redirectUrl ?? existing?.redirectUrl,
    customerId: next.customerId ?? existing?.customerId,
    customerName: next.customerName ?? existing?.customerName,
    customerEmail: next.customerEmail ?? existing?.customerEmail,
    customerPhone: next.customerPhone ?? existing?.customerPhone,
    chargerName: next.chargerName ?? existing?.chargerName,
    chargerSlug: next.chargerSlug ?? existing?.chargerSlug,
    amount: next.amount ?? existing?.amount,
    currency: next.currency ?? existing?.currency,
    hardwarePrice: next.hardwarePrice ?? existing?.hardwarePrice,
    installPrice: next.installPrice ?? existing?.installPrice,
    surveyAdjustment: next.surveyAdjustment ?? existing?.surveyAdjustment,
    discountAmount: next.discountAmount ?? existing?.discountAmount,
    discountCode: next.discountCode ?? existing?.discountCode,
    discountLabel: next.discountLabel ?? existing?.discountLabel,
    totalBeforeDiscount: next.totalBeforeDiscount ?? existing?.totalBeforeDiscount,
    propertyType: next.propertyType ?? existing?.propertyType,
    parkingType: next.parkingType ?? existing?.parkingType,
    fuseBoxDistance: next.fuseBoxDistance ?? existing?.fuseBoxDistance,
    billingAddress: next.billingAddress ?? existing?.billingAddress,
    deliveryAddress: next.deliveryAddress ?? existing?.deliveryAddress,
    latestStatus: next.latestStatus ?? existing?.latestStatus,
    latestAuthorizationWebhook:
      next.latestAuthorizationWebhook ?? existing?.latestAuthorizationWebhook,
  } satisfies PaymentSession;
}

async function upsertSession(
  lookup: { paymentId?: string; uniquePaymentReference?: string; providerPaymentReference?: string },
  next: PaymentSession,
) {
  const state = await readMerchantState();
  const index = indexOfSession(state.sessions, lookup);
  if (index >= 0) {
    state.sessions[index] = next;
  } else {
    state.sessions.unshift(next);
  }
  await writeMerchantState(state);
  return next;
}

export async function storeFrasersPlusPaymentSession(session: {
  paymentId: string;
  uniquePaymentReference: string;
  redirectUrl: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  amount?: number;
  currency?: string;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: MerchantAddress;
  deliveryAddress?: MerchantAddress;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const existing = await getPaymentSessionByPaymentId(session.paymentId);

  const nextSession = mergeSession(existing, {
    ...session,
    provider: "FRASERS_PLUS",
    latestStatus: {
      currentType: "AUTHORIZATION",
      status: existing?.latestStatus?.status ?? "PENDING",
      source: "checkout",
      updatedAt: new Date().toISOString(),
    },
  });

  await appendAuditEvent({
    action: "frasers_plus.authorization_created",
    actor: "system",
    target: "PAYMENT",
    paymentId: session.paymentId,
    provider: "FRASERS_PLUS",
    detail: `Authorization created for ${session.customerName ?? "customer"}`,
  });

  return await upsertSession(
    {
      paymentId: session.paymentId,
      uniquePaymentReference: session.uniquePaymentReference,
    },
    nextSession,
  );

  });
}

export async function storeCardCheckoutSession(session: {
  paymentId: string;
  cardProcessor?: CardProcessor;
  providerPaymentReference: string;
  redirectUrl: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  amount?: number;
  currency?: string;
  hardwarePrice?: number;
  installPrice?: number;
  surveyAdjustment?: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: MerchantAddress;
  deliveryAddress?: MerchantAddress;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const existing = await getPaymentSessionByPaymentId(session.paymentId);

  const nextSession = mergeSession(existing, {
    ...session,
    provider: "CARD",
    latestStatus: {
      currentType: "CARD",
      status: "CHECKOUT_CREATED",
      source: "checkout",
      updatedAt: new Date().toISOString(),
    },
  });

  await appendAuditEvent({
    action: "card.checkout_created",
    actor: "system",
    target: "CARD",
    paymentId: session.paymentId,
    provider: "CARD",
    detail: `${session.cardProcessor ?? "REVOLUT"} card checkout created for ${session.customerName ?? "customer"}`,
  });

  return await upsertSession(
    {
      paymentId: session.paymentId,
      providerPaymentReference: session.providerPaymentReference,
    },
    nextSession,
  );

  });
}

export async function updateFrasersPlusPaymentState(payload: {
  uniquePaymentReference: string;
  paymentId?: string;
  currentType?: string;
  status: string;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const existing =
    (await getPaymentSessionByUpr(payload.uniquePaymentReference)) ??
    (payload.paymentId ? await getPaymentSessionByPaymentId(payload.paymentId) : undefined);

  if (!existing) {
    return null;
  }

  if (["CREDIT", "REVERSAL"].includes(existing.latestStatus?.currentType ?? "") &&
      ["AUTHORIZATION", "CAPTURE"].includes(payload.currentType ?? "")) return existing;

  const nextSession = mergeSession(existing, {
    paymentId: existing.paymentId,
    provider: existing.provider,
    uniquePaymentReference: existing.uniquePaymentReference,
    latestStatus: {
      currentType: payload.currentType,
      status: payload.status,
      source: "reconciliation",
      updatedAt: new Date().toISOString(),
    },
  });

  if (existing.latestStatus?.status !== payload.status) {
    await appendAuditEvent({
      action: "frasers_plus.status_updated",
      actor: "system",
      target: "PAYMENT",
      paymentId: existing.paymentId,
      provider: "FRASERS_PLUS",
      detail: `${payload.currentType ?? "AUTHORIZATION"} moved to ${payload.status}`,
    });
  }

  return await upsertSession(
    {
      paymentId: existing.paymentId,
      uniquePaymentReference: existing.uniquePaymentReference,
    },
    nextSession,
  );

  });
}

export async function updateCardCheckoutStatus(payload: {
  paymentId: string;
  providerPaymentReference?: string;
  status: string;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const existing =
    (await getPaymentSessionByPaymentId(payload.paymentId)) ??
    (payload.providerPaymentReference
      ? await getPaymentSessionByProviderPaymentReference(payload.providerPaymentReference)
      : undefined);

  if (!existing) {
    return null;
  }

  const existingStatus = existing.latestStatus?.status?.toUpperCase();
  const nextStatus = payload.status.toUpperCase();
  if (existingStatus === "REFUNDED") return existing;
  const isExistingSuccessful =
    existingStatus === "AUTHORISED" ||
    existingStatus === "AUTHORIZED" ||
    existingStatus === "APPROVED" ||
    existingStatus === "COMPLETED";
  const isNextSuccessful =
    nextStatus === "AUTHORISED" ||
    nextStatus === "AUTHORIZED" ||
    nextStatus === "APPROVED" ||
    nextStatus === "COMPLETED";

  if (isExistingSuccessful && !isNextSuccessful && nextStatus !== "REFUNDED") {
    return existing;
  }

  const nextSession = mergeSession(existing, {
    paymentId: existing.paymentId,
    provider: existing.provider,
    providerPaymentReference:
      payload.providerPaymentReference ?? resolveProviderPaymentReference(existing),
    latestStatus: {
      currentType: "CARD",
      status: payload.status,
      source: "card-return",
      updatedAt: new Date().toISOString(),
    },
  });

  if (existing.latestStatus?.status !== payload.status) {
    await appendAuditEvent({
      action: "card.status_updated",
      actor: "system",
      target: "CARD",
      paymentId: existing.paymentId,
      provider: "CARD",
      detail: `Card flow moved to ${payload.status}`,
    });
  }

  return await upsertSession(
    {
      paymentId: existing.paymentId,
      providerPaymentReference: resolveProviderPaymentReference(nextSession),
    },
    nextSession,
  );

  });
}

export async function storeManualCardPaymentSession(session: {
  paymentId: string;
  providerPaymentReference?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  amount?: number;
  currency?: string;
  hardwarePrice?: number;
  installPrice?: number;
  surveyAdjustment?: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: MerchantAddress;
  deliveryAddress?: MerchantAddress;
  actor?: string;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const existing = await getPaymentSessionByPaymentId(session.paymentId);
  const providerPaymentReference =
    session.providerPaymentReference?.trim() ||
    `manual:${session.paymentId}`;

  const nextSession = mergeSession(existing, {
    ...session,
    provider: "CARD",
    cardProcessor: "MANUAL",
    providerPaymentReference,
    redirectUrl: existing?.redirectUrl,
    latestStatus: {
      currentType: "CARD",
      status: "COMPLETED",
      source: "manual",
      updatedAt: new Date().toISOString(),
    },
  });

  await appendAuditEvent({
    action: "card.manual_payment_recorded",
    actor: session.actor ?? "backoffice-admin",
    target: "CARD",
    paymentId: session.paymentId,
    provider: "CARD",
    detail: `Manual card payment recorded for ${session.customerName ?? "customer"} (${providerPaymentReference}).`,
  });

  return await upsertSession(
    {
      paymentId: session.paymentId,
      providerPaymentReference,
    },
    nextSession,
  );

  });
}

export async function getPaymentSessionByPaymentId(paymentId: string) {
  return (await readMerchantState()).sessions.find((session) => session.paymentId === paymentId);
}

export async function getPaymentSessionByUpr(uniquePaymentReference: string) {
  return (await readMerchantState()).sessions.find(
    (session) => session.uniquePaymentReference === uniquePaymentReference,
  );
}

export async function getPaymentSessionByProviderPaymentReference(providerPaymentReference: string) {
  return (await readMerchantState()).sessions.find(
    (session) => resolveProviderPaymentReference(session) === providerPaymentReference,
  );
}

export async function getPaymentSessionByStripeSessionId(stripeSessionId: string) {
  return await getPaymentSessionByProviderPaymentReference(stripeSessionId);
}

export async function listPaymentSessions() {
  return [...(await readMerchantState()).sessions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export async function getMerchantDashboardState(auditLimit = 50) {
  const state = await readMerchantState();
  return {
    payments: [...state.sessions].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
    auditEvents: state.auditEvents.slice(0, auditLimit),
  };
}

export async function deletePaymentSessionsForPaymentIds(paymentIds: string[]) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const ids = new Set(paymentIds.filter(Boolean));
  if (!ids.size) {
    return 0;
  }

  const state = await readMerchantState();
  const retained = state.sessions.filter((session) => !ids.has(session.paymentId));
  await writeMerchantState({
    ...state,
    sessions: retained,
  });

  return state.sessions.length - retained.length;

  });
}

export async function listAuditEvents(limit = 50) {
  return (await readMerchantState()).auditEvents.slice(0, limit);
}

export async function recordAdminAuditEvent(event: {
  action: string;
  actor: string;
  detail: string;
}) {
  try {
    await appendAuditEvent({
      ...event,
      target: "ADMIN",
    });
  } catch (error) {
    console.error("Failed to persist admin audit event", {
      action: event.action,
      actor: event.actor,
      error,
    });
  }
}

export async function storeAuthorizationWebhookEvent(payload: {
  uniquePaymentReference: string;
  type: string;
  status: string;
  paymentAmount?: PaymentAmount;
  actionDate?: string;
  metadata?: Record<string, string>;
  raw: unknown;
}) {
  return withJsonFileTransaction(MERCHANT_STATE_FILE, async () => {
  const receivedAt = new Date().toISOString();
  const webhookEvent: AuthorizationWebhookEvent = {
    uniquePaymentReference: payload.uniquePaymentReference,
    type: payload.type,
    status: payload.status,
    paymentAmount: payload.paymentAmount,
    actionDate: payload.actionDate,
    metadata: payload.metadata,
    receivedAt,
    raw: payload.raw,
  };

  const paymentId = payload.metadata?.paymentId;
  const session =
    (await getPaymentSessionByUpr(payload.uniquePaymentReference)) ??
    (paymentId ? await getPaymentSessionByPaymentId(paymentId) : undefined);
  const resolvedPaymentId = session?.paymentId || paymentId || payload.uniquePaymentReference;

  // A delayed authorisation callback must not rewind a completed capture/refund.
  // Keep the callback in the audit trail without reopening the payment.
  const previousStatus = session?.latestStatus;
  const preserveCompletedState =
    (previousStatus?.status === "COMPLETED" || (previousStatus?.currentType === "REVERSAL" && previousStatus.status === "CANCELLED")) &&
    ((payload.type === "AUTHORIZATION" &&
      ["CAPTURE", "CREDIT", "REVERSAL"].includes(previousStatus.currentType ?? "")) ||
      (payload.type === "CAPTURE" &&
        ["CREDIT", "REVERSAL"].includes(previousStatus.currentType ?? "")));

  const nextSession = mergeSession(session, {
    paymentId: resolvedPaymentId,
    provider: session?.provider ?? "FRASERS_PLUS",
    uniquePaymentReference: payload.uniquePaymentReference,
    latestAuthorizationWebhook: webhookEvent,
    latestStatus: preserveCompletedState ? previousStatus : {
      currentType: payload.type,
      status: payload.status,
      source: "webhook",
      updatedAt: receivedAt,
    },
  });

  await appendAuditEvent({
    action: "frasers_plus.webhook_received",
    actor: "frasers-plus",
    target: "WEBHOOK",
    paymentId: resolvedPaymentId,
    provider: "FRASERS_PLUS",
    detail: `${payload.type} webhook received with status ${payload.status}`,
  });

  return await upsertSession(
    {
      paymentId: resolvedPaymentId,
      uniquePaymentReference: payload.uniquePaymentReference,
    },
    nextSession,
  );

  });
}

export type { AuditEvent, AuthorizationWebhookEvent, CardProcessor, PaymentSession };
