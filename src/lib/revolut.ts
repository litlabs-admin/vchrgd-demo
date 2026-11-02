import { createHmac, timingSafeEqual } from "node:crypto";
import { createFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";

type CheckoutAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

type CardCheckoutPayload = {
  paymentId: string;
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  charger: {
    slug: string;
    name: string;
    hardwarePrice: number;
    installPrice: number;
  };
  surveyAdjustment: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  total: number;
  propertyType?: string | null;
  parkingType?: string | null;
  fuseBoxDistance?: string | null;
  billingAddress: CheckoutAddress;
  deliveryAddress: CheckoutAddress;
};

type RevolutOrderLineItem = {
  name: string;
  type: "physical" | "service";
  quantity: {
    value: number;
  };
  unit_price_amount: number;
  total_amount: number;
};

type RevolutCreateOrderPayload = {
  amount: number;
  currency: string;
  capture_mode: "automatic" | "manual";
  authorisation_type?: "final" | "pre_authorisation";
  cancel_authorised_after?: string;
  expire_pending_after?: string;
  description?: string;
  redirect_url?: string;
  enforce_challenge?: "automatic" | "forced";
  customer?: {
    id?: string;
    full_name?: string;
    phone?: string;
    email?: string;
  };
  merchant_order_data?: {
    reference?: string;
    url?: string;
  };
  metadata?: Record<string, string>;
  shipping?: {
    address: {
      street_line_1: string;
      street_line_2?: string;
      city: string;
      country_code: string;
      postcode: string;
    };
  };
  line_items?: RevolutOrderLineItem[];
};

type RevolutPayment = {
  id: string;
  state: string;
  amount?: number;
  authorised_amount?: number;
  currency?: string;
  decline_reason?: string;
};

type RevolutOrder = {
  id: string;
  token?: string;
  type?: string;
  state: string;
  created_at?: string;
  updated_at?: string;
  amount?: number;
  outstanding_amount?: number;
  refunded_amount?: number;
  currency?: string;
  description?: string;
  capture_mode?: "automatic" | "manual";
  authorisation_type?: "final" | "pre_authorisation";
  cancel_authorised_after?: string;
  checkout_url?: string;
  redirect_url?: string;
  payments?: RevolutPayment[];
  metadata?: Record<string, string>;
  merchant_order_data?: {
    reference?: string;
    url?: string;
  };
};

type RevolutWebhookEvent = {
  event: string;
  order_id?: string;
  merchant_order_ext_ref?: string;
};

function isPlaceholderValue(value: string | undefined) {
  return !value || value.startsWith("replace-with-");
}

function isTruthyFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes" || normalised === "on";
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  );
}

function toUrlOrNull(value: string | undefined) {
  if (!value || isPlaceholderValue(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toMinorUnit(amount: number) {
  return Math.round(Math.max(amount, 0) * 100);
}

export function getRevolutConfig() {
  const apiBaseUrl =
    process.env.REVOLUT_API_BASE_URL || "https://sandbox-merchant.revolut.com";
  const apiKey = process.env.REVOLUT_API_KEY || "";
  const webhookSigningSecret = process.env.REVOLUT_WEBHOOK_SIGNING_SECRET || "";
  const redirectUrl =
    process.env.REVOLUT_REDIRECT_URL || "http://localhost:3000/card/return";
  const currency = (process.env.REVOLUT_CURRENCY || "GBP").toUpperCase();
  const apiVersion = process.env.REVOLUT_API_VERSION || "2024-05-01";
  // D2C payments are taken at checkout. Manual capture previously allowed
  // authorised payments to expire before fulfilment, so it is intentionally
  // not configurable for this flow.
  const captureMode = "automatic" as const;

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    apiKey,
    webhookSigningSecret,
    redirectUrl,
    currency,
    apiVersion,
    captureMode,
  };
}

export function shouldUseMockRevolutCheckout() {
  if (isTruthyFlag(process.env.REVOLUT_FORCE_LOCAL_DEMO)) {
    return true;
  }

  const { apiKey, redirectUrl } = getRevolutConfig();
  if (isPlaceholderValue(apiKey)) {
    return true;
  }

  const redirect = toUrlOrNull(redirectUrl);
  if (!redirect) {
    return true;
  }

  return isLocalHostname(redirect.hostname);
}

export function resolveRevolutReturnUrl(origin: string, paymentId: string) {
  const { redirectUrl } = getRevolutConfig();
  const fallback = new URL("/card/return", origin);
  const resolved = toUrlOrNull(redirectUrl) ?? fallback;

  if (isLocalHostname(resolved.hostname)) {
    const requestUrl = new URL(origin);
    resolved.protocol = requestUrl.protocol;
    resolved.host = requestUrl.host;
  }

  resolved.searchParams.set("paymentId", paymentId);
  resolved.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  return resolved.toString();
}

export function resolveRevolutMerchantOrderUrl(origin: string, paymentId: string) {
  const url = new URL("/", origin);
  url.searchParams.set("resume", "payment");
  url.searchParams.set("paymentId", paymentId);
  url.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  return url.toString();
}

export function buildRevolutOrderPayload(
  payload: CardCheckoutPayload,
  origin: string,
): RevolutCreateOrderPayload {
  const totalAmount = toMinorUnit(payload.total);
  const installedAmount = toMinorUnit(payload.charger.installPrice);
  const surveyAdjustmentAmount = toMinorUnit(payload.surveyAdjustment);
  const discountAmount = toMinorUnit(payload.discountAmount ?? 0);
  const discountedInstalledAmount = Math.max(installedAmount - discountAmount, 0);
  const shippingAddress = payload.deliveryAddress;
  const config = getRevolutConfig();

  const lineItems: RevolutOrderLineItem[] = [
    {
      name: `${payload.charger.name} installed package`,
      type: "service",
      quantity: { value: 1 },
      unit_price_amount: discountedInstalledAmount,
      total_amount: discountedInstalledAmount,
    },
  ];

  if (surveyAdjustmentAmount > 0) {
    lineItems.push({
      name: "Survey adjustment",
      type: "service",
      quantity: { value: 1 },
      unit_price_amount: surveyAdjustmentAmount,
      total_amount: surveyAdjustmentAmount,
    });
  }

  return {
    amount: totalAmount,
    currency: config.currency,
    capture_mode: config.captureMode,
    expire_pending_after: "P3D",
    description: `${payload.charger.name} installed package`,
    redirect_url: resolveRevolutReturnUrl(origin, payload.paymentId),
    enforce_challenge: "automatic",
    customer: {
      full_name: `${payload.firstName} ${payload.lastName}`.trim(),
      phone: payload.phone,
      email: payload.email,
    },
    merchant_order_data: {
      reference: payload.paymentId,
      url: resolveRevolutMerchantOrderUrl(origin, payload.paymentId),
    },
    metadata: {
      paymentId: payload.paymentId,
      customerId: payload.customerId,
      customerName: `${payload.firstName} ${payload.lastName}`.trim(),
      chargerSlug: payload.charger.slug,
      propertyType: payload.propertyType ?? "",
      parkingType: payload.parkingType ?? "",
      fuseBoxDistance: payload.fuseBoxDistance ?? "",
      discountAmount: String(payload.discountAmount ?? 0),
      discountCode: payload.discountCode ?? "",
      discountLabel: payload.discountLabel ?? "",
      totalBeforeDiscount: String(payload.totalBeforeDiscount ?? payload.total),
      billingPostcode: payload.billingAddress.postalCode,
      installationPostcode: payload.deliveryAddress.postalCode,
    },
    shipping: {
      address: {
        street_line_1: shippingAddress.line1,
        street_line_2: shippingAddress.line2,
        city: shippingAddress.city,
        country_code: shippingAddress.country,
        postcode: shippingAddress.postalCode,
      },
    },
    line_items: lineItems,
  };
}

export async function revolutRequest(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
) {
  const { apiBaseUrl, apiKey, apiVersion } = getRevolutConfig();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Revolut-Api-Version": apiVersion,
      "Content-Type": "application/json",
      ...(init?.idempotencyKey
        ? {
            "Idempotency-Key": init.idempotencyKey,
          }
        : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return { response, data };
}

export async function createRevolutOrder(payload: RevolutCreateOrderPayload) {
  return revolutRequest("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: payload.merchant_order_data?.reference,
  });
}

export async function retrieveRevolutOrder(orderId: string) {
  return revolutRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

export async function cancelRevolutOrder(orderId: string) {
  return revolutRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
  });
}

export async function captureRevolutOrder(
  orderId: string,
  amount?: number,
  currency?: string,
) {
  const body =
    typeof amount === "number" && amount > 0 && currency
      ? JSON.stringify({
          amount: toMinorUnit(amount),
          currency: currency.toUpperCase(),
        })
      : "{}";

  return revolutRequest(`/api/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    body,
  });
}

export async function refundRevolutOrder(
  orderId: string,
  amount: number,
  currency: string,
  reference?: string,
) {
  return revolutRequest(`/api/orders/${encodeURIComponent(orderId)}/refund`, {
    method: "POST",
    idempotencyKey: reference,
    body: JSON.stringify({
      amount: toMinorUnit(amount),
      currency: currency.toUpperCase(),
      merchant_order_data: {
        reference,
      },
      description: "Customer refund requested",
    }),
  });
}

export function mapRevolutOrderStateToCardStatus(state: string | undefined) {
  switch ((state || "").toLowerCase()) {
    case "authorised":
      return "AUTHORISED";
    case "completed":
      return "COMPLETED";
    case "cancelled":
      return "CANCELLED";
    case "failed":
      return "FAILED";
    case "declined":
    case "soft_declined":
      return "DECLINED";
    case "processing":
    case "authorisation_started":
    case "authorisation_passed":
    case "authentication_challenge":
    case "authentication_verified":
      return "PROCESSING";
    default:
      return "PENDING";
  }
}

export function deriveRevolutCardStatus(
  order: Partial<RevolutOrder> | Record<string, unknown> | null | undefined,
) {
  const latestPayment =
    Array.isArray(order?.payments) && order.payments.length > 0
      ? order.payments[order.payments.length - 1]
      : undefined;

  if (latestPayment?.state) {
    switch (latestPayment.state.toLowerCase()) {
      case "authorised":
        return "AUTHORISED";
      case "completed":
        return "COMPLETED";
      case "cancelled":
        return "CANCELLED";
      case "failed":
        return "FAILED";
      case "declined":
      case "soft_declined":
        return "DECLINED";
      case "processing":
      case "created":
      case "pending":
        return "PROCESSING";
      default:
        break;
    }
  }

  const orderState =
    order && typeof order === "object" && "state" in order && typeof order.state === "string"
      ? order.state
      : undefined;

  return mapRevolutOrderStateToCardStatus(orderState);
}

export function mapRevolutOrderStateToCheckoutInteractionStatus(
  state: string | undefined,
) {
  switch (mapRevolutOrderStateToCardStatus(state)) {
    case "AUTHORISED":
    case "COMPLETED":
      return "PAYMENT_COMPLETED";
    case "CANCELLED":
    case "FAILED":
    case "DECLINED":
      return "ABANDONED";
    default:
      return "PAYMENT_PENDING";
  }
}

export function normaliseRevolutWebhookEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = payload as Record<string, unknown>;
  const orderId =
    typeof event.order_id === "string"
      ? event.order_id
      : typeof event.id === "string"
        ? event.id
        : undefined;
  const eventName =
    typeof event.event === "string"
      ? event.event
      : typeof event.type === "string"
        ? event.type
        : undefined;
  const reference =
    typeof event.merchant_order_ext_ref === "string"
      ? event.merchant_order_ext_ref
      : undefined;

  if (!eventName || !orderId) {
    return null;
  }

  return {
    event: eventName,
    order_id: orderId,
    merchant_order_ext_ref: reference,
  } satisfies RevolutWebhookEvent;
}

export function verifyRevolutWebhookSignature(
  rawPayload: string,
  signatureHeader: string,
  timestamp: string,
) {
  const { webhookSigningSecret } = getRevolutConfig();

  if (!webhookSigningSecret || !isRecentRevolutWebhookTimestamp(timestamp)) {
    return false;
  }

  const payloadToSign = `v1.${timestamp}.${rawPayload}`;
  const expected = `v1=${createHmac("sha256", webhookSigningSecret)
    .update(payloadToSign)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const providedSignatures = signatureHeader
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return providedSignatures.some((signature) => {
    const left = Buffer.from(signature);
    return left.length === expectedBuffer.length && timingSafeEqual(left, expectedBuffer);
  });
}

function isRecentRevolutWebhookTimestamp(timestamp: string) {
  const raw = timestamp.trim();
  if (!raw) {
    return false;
  }

  const numeric = Number(raw);
  const parsedTimestamp = Number.isFinite(numeric)
    ? numeric < 10_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(raw);

  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const configuredTolerance = Number(
    process.env.REVOLUT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  );
  const toleranceSeconds =
    Number.isFinite(configuredTolerance) && configuredTolerance > 0
      ? configuredTolerance
      : 300;

  return Math.abs(Date.now() - parsedTimestamp) <= toleranceSeconds * 1000;
}

export type {
  CardCheckoutPayload,
  CheckoutAddress,
  RevolutCreateOrderPayload,
  RevolutOrder,
  RevolutPayment,
};
