import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import type { CardCheckoutPayload } from "@/lib/revolut";

type SquarePaymentLink = {
  id?: string;
  order_id?: string;
  url?: string;
  long_url?: string;
};

type SquareCreatePaymentLinkResponse = {
  payment_link?: SquarePaymentLink;
  errors?: Array<{ detail?: string; code?: string; category?: string }>;
};

type SquarePaymentLinkPayload = ReturnType<typeof buildSquarePaymentLinkPayload>;

type SquareTender = {
  id?: string;
  payment_id?: string;
  type?: string;
  card_details?: {
    status?: string;
  };
};

type SquareOrder = {
  id?: string;
  state?: string;
  tenders?: SquareTender[];
};

type SquarePayment = {
  id?: string;
  status?: string;
  order_id?: string;
};

function isPlaceholderValue(value: string | undefined) {
  return !value || value.startsWith("replace-with-");
}

function normaliseEnvironment(value: string | undefined) {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function toMinorUnit(amount: number) {
  return Math.round(Math.max(amount, 0) * 100);
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

function readTruthyFlag(value: string | undefined) {
  const normalised = value?.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes" || normalised === "on";
}

export function getSquareConfig() {
  const environment = normaliseEnvironment(process.env.SQUARE_ENVIRONMENT);
  const apiBaseUrl =
    process.env.SQUARE_API_BASE_URL ||
    (environment === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com");

  return {
    environment,
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    applicationId: process.env.SQUARE_APPLICATION_ID || "",
    accessToken: process.env.SQUARE_ACCESS_TOKEN || "",
    locationId: process.env.SQUARE_LOCATION_ID || "",
    currency: (process.env.SQUARE_CURRENCY || "GBP").toUpperCase(),
    redirectUrl: process.env.SQUARE_REDIRECT_URL || "http://localhost:3000/card/return",
    apiVersion: process.env.SQUARE_API_VERSION || "2026-05-20",
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "",
    webhookNotificationUrl:
      process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || process.env.SQUARE_WEBHOOK_URL || "",
  };
}

export function isSquareCheckoutConfigured() {
  const { accessToken, locationId } = getSquareConfig();
  return Boolean(!isPlaceholderValue(accessToken) && !isPlaceholderValue(locationId));
}

export function isSquareWebPaymentsConfigured() {
  const { accessToken, applicationId, locationId } = getSquareConfig();
  return Boolean(
    !isPlaceholderValue(accessToken) &&
      !isPlaceholderValue(applicationId) &&
      !isPlaceholderValue(locationId),
  );
}

export function shouldUseSquareCardCheckout() {
  const configuredProvider = process.env.CARD_PAYMENT_PROVIDER?.trim().toLowerCase();

  if (configuredProvider === "square") {
    return true;
  }

  if (configuredProvider === "revolut" || configuredProvider === "mock") {
    return false;
  }

  return isSquareCheckoutConfigured() || readTruthyFlag(process.env.SQUARE_CARD_CHECKOUT_ENABLED);
}

export function resolveSquareReturnUrl(origin: string, paymentId: string) {
  const fallback = new URL("/card/return", origin);
  const configured = toUrlOrNull(getSquareConfig().redirectUrl) ?? fallback;
  const originUrl = new URL(origin);

  if (configured.hostname === "localhost" || configured.hostname === "127.0.0.1") {
    configured.protocol = originUrl.protocol;
    configured.host = originUrl.host;
  }

  if (
    configured.host !== originUrl.host &&
    process.env.SQUARE_USE_CONFIGURED_REDIRECT_HOST !== "true"
  ) {
    configured.protocol = originUrl.protocol;
    configured.host = originUrl.host;
  }

  configured.searchParams.set("paymentId", paymentId);
  configured.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  return configured.toString();
}

export function buildSquareWebPaymentsUrl(origin: string, paymentId: string) {
  const url = new URL("/card/square", origin);
  url.searchParams.set("paymentId", paymentId);
  url.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  return url.toString();
}

export function getSquareWebPaymentsScriptUrl() {
  return getSquareConfig().environment === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

export function buildSquarePaymentLinkPayload(
  payload: CardCheckoutPayload,
  origin: string,
) {
  const { currency, locationId } = getSquareConfig();
  const itemName = `${payload.charger.name} installed package`;
  const prePopulatedData = buildSquarePrePopulatedData(payload);

  return {
    idempotency_key: payload.paymentId,
    description: itemName,
    quick_pay: {
      name: itemName,
      price_money: {
        amount: toMinorUnit(payload.total),
        currency,
      },
      location_id: locationId,
    },
    checkout_options: {
      redirect_url: resolveSquareReturnUrl(origin, payload.paymentId),
      merchant_support_email: "sales@vchrgd.com",
      allow_tipping: false,
      ask_for_shipping_address: false,
      accepted_payment_methods: {
        apple_pay: true,
        google_pay: true,
        cash_app_pay: false,
        afterpay_clearpay: false,
      },
      enable_coupon: false,
      enable_loyalty: false,
    },
    ...(prePopulatedData ? { pre_populated_data: prePopulatedData } : {}),
  };
}

function cleanSquareText(value: string | undefined) {
  return value?.trim() || undefined;
}

function cleanSquareCountryCode(value: string | undefined) {
  const countryCode = value?.trim().toUpperCase();
  return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined;
}

function cleanSquareEmail(value: string | undefined) {
  const email = value?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return undefined;
  }

  return email;
}

function cleanSquarePhoneNumber(value: string | undefined) {
  const phone = value?.trim();
  if (!phone) {
    return undefined;
  }

  const normalised = phone.startsWith("+")
    ? `+${phone.slice(1).replace(/\D/g, "")}`
    : phone.replace(/\D/g, "");

  return /^\+[1-9]\d{7,14}$/.test(normalised) ? normalised : undefined;
}

function buildSquarePrePopulatedData(payload: CardCheckoutPayload) {
  const buyerAddress = {
    first_name: cleanSquareText(payload.firstName),
    last_name: cleanSquareText(payload.lastName),
    address_line_1: cleanSquareText(payload.billingAddress.line1),
    address_line_2: cleanSquareText(payload.billingAddress.line2),
    locality: cleanSquareText(payload.billingAddress.city),
    postal_code: cleanSquareText(payload.billingAddress.postalCode),
    country: cleanSquareCountryCode(payload.billingAddress.country),
  };
  const filteredAddress = Object.fromEntries(
    Object.entries(buyerAddress).filter(([, value]) => Boolean(value)),
  );
  const prePopulatedData = {
    buyer_email: cleanSquareEmail(payload.email),
    buyer_phone_number: cleanSquarePhoneNumber(payload.phone),
    ...(Object.keys(filteredAddress).length ? { buyer_address: filteredAddress } : {}),
  };

  return Object.keys(prePopulatedData).some(
    (key) => Boolean(prePopulatedData[key as keyof typeof prePopulatedData]),
  )
    ? prePopulatedData
    : undefined;
}

export async function squareRequest(
  path: string,
  init?: RequestInit,
) {
  const { apiBaseUrl, accessToken, apiVersion } = getSquareConfig();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Square-Version": apiVersion,
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

export async function createSquarePaymentLink(payload: SquarePaymentLinkPayload) {
  const result = await squareRequest("/v2/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (
    result.response.ok ||
    !("pre_populated_data" in payload) ||
    !isSquarePrefillValidationError(result.data)
  ) {
    return result;
  }

  const fallbackPayload = {
    ...payload,
    idempotency_key: `${payload.idempotency_key}-basic`,
  };
  delete (fallbackPayload as Partial<SquarePaymentLinkPayload>).pre_populated_data;

  return squareRequest("/v2/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify(fallbackPayload),
  });
}

export function buildSquarePaymentIdempotencyKey(paymentId: string) {
  return createHash("sha256").update(`square-payment:${paymentId}`).digest("hex").slice(0, 45);
}

export async function createSquarePayment(payload: {
  sourceId: string;
  paymentId: string;
  amount: number;
  currency: string;
  customerEmail?: string;
  note?: string;
  verificationToken?: string;
}) {
  const { locationId } = getSquareConfig();

  return squareRequest("/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      source_id: payload.sourceId,
      idempotency_key: buildSquarePaymentIdempotencyKey(payload.paymentId),
      amount_money: {
        amount: toMinorUnit(payload.amount),
        currency: payload.currency.toUpperCase(),
      },
      autocomplete: true,
      location_id: locationId,
      reference_id: payload.paymentId,
      buyer_email_address: cleanSquareEmail(payload.customerEmail),
      note: payload.note,
      ...(payload.verificationToken ? { verification_token: payload.verificationToken } : {}),
    }),
  });
}

export async function retrieveSquareOrder(orderId: string) {
  return squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

export async function retrieveSquarePayment(paymentId: string) {
  return squareRequest(`/v2/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
  });
}

export async function refundSquarePayment(
  paymentId: string,
  amount: number,
  currency: string,
  reference: string,
) {
  return squareRequest("/v2/refunds", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: reference,
      payment_id: paymentId,
      amount_money: {
        amount: toMinorUnit(amount),
        currency: currency.toUpperCase(),
      },
      reason: "Customer refund requested",
    }),
  });
}

export function parseSquarePaymentLinkResponse(data: unknown) {
  const payload = data as SquareCreatePaymentLinkResponse | null;
  const link = payload?.payment_link;

  const checkoutUrl = link?.long_url || link?.url;

  if (!checkoutUrl || !link?.order_id) {
    return null;
  }

  return {
    id: link.id,
    orderId: link.order_id,
    shortUrl: link.url,
    url: checkoutUrl,
  };
}

function mapSquareStatus(status: string | undefined) {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
    case "CAPTURED":
      return "COMPLETED";
    case "APPROVED":
    case "AUTHORIZED":
      return "AUTHORISED";
    case "CANCELED":
    case "CANCELLED":
    case "VOIDED":
      return "CANCELLED";
    case "FAILED":
      return "FAILED";
    case "PENDING":
      return "PENDING";
    default:
      return "PENDING";
  }
}

function unwrapSquareOrder(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("order" in value && value.order && typeof value.order === "object") {
    return value.order as SquareOrder;
  }

  return value as SquareOrder;
}

function unwrapSquarePayment(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("payment" in value && value.payment && typeof value.payment === "object") {
    return value.payment as SquarePayment;
  }

  return value as SquarePayment;
}

export function getSquarePaymentIdFromOrder(order: unknown) {
  const squareOrder = unwrapSquareOrder(order);
  const tender = squareOrder?.tenders?.find((item) => item.payment_id || item.id);
  return tender?.payment_id || tender?.id || "";
}

export function deriveSquareOrderStatus(order: unknown) {
  const squareOrder = unwrapSquareOrder(order);
  const tender = squareOrder?.tenders?.find((item) => item.payment_id || item.card_details?.status);

  if (tender?.card_details?.status) {
    return mapSquareStatus(tender.card_details.status);
  }

  return mapSquareStatus(squareOrder?.state);
}

export function deriveSquarePaymentStatus(payment: unknown) {
  const squarePayment = unwrapSquarePayment(payment);
  return mapSquareStatus(squarePayment?.status);
}

export async function resolveSquareOrderPaymentStatus(orderId: string) {
  const orderResult = await retrieveSquareOrder(orderId);

  if (!orderResult.response.ok) {
    const paymentResult = await retrieveSquarePayment(orderId);
    if (paymentResult.response.ok) {
      return {
        response: paymentResult.response,
        data: paymentResult.data,
        status: deriveSquarePaymentStatus(paymentResult.data),
        paymentId: orderId,
      };
    }

    return {
      response: orderResult.response,
      data: orderResult.data,
      status: "PENDING",
      paymentId: "",
    };
  }

  const paymentId = getSquarePaymentIdFromOrder(orderResult.data);
  if (!paymentId) {
    return {
      response: orderResult.response,
      data: orderResult.data,
      status: deriveSquareOrderStatus(orderResult.data),
      paymentId: "",
    };
  }

  const paymentResult = await retrieveSquarePayment(paymentId);
  return {
    response: paymentResult.response,
    data: paymentResult.data,
    status: paymentResult.response.ok
      ? deriveSquarePaymentStatus(paymentResult.data)
      : deriveSquareOrderStatus(orderResult.data),
    paymentId,
  };
}

export async function resolveSquarePaymentOrderId(paymentId: string) {
  const paymentResult = await retrieveSquarePayment(paymentId);
  const payment = unwrapSquarePayment(paymentResult.data);

  return {
    response: paymentResult.response,
    data: paymentResult.data,
    orderId: payment?.order_id || "",
    status: paymentResult.response.ok ? deriveSquarePaymentStatus(paymentResult.data) : "PENDING",
  };
}

export function getSquareErrorMessage(data: unknown, fallback: string) {
  const errors = (data as SquareCreatePaymentLinkResponse | null)?.errors;
  const detail = errors?.find((error) => error.detail || error.code);
  return detail?.detail || detail?.code || fallback;
}

function isSquarePrefillValidationError(data: unknown) {
  const message = getSquareErrorMessage(data, "").toLowerCase();
  return (
    message.includes("invalid email") ||
    message.includes("invalid phone") ||
    message.includes("invalid address") ||
    message.includes("pre_populated")
  );
}

export function verifySquareWebhookSignature(
  rawPayload: string,
  signatureHeader: string,
  notificationUrl: string,
) {
  const { webhookSignatureKey } = getSquareConfig();

  if (!webhookSignatureKey || !signatureHeader || !notificationUrl) {
    return false;
  }

  const expected = createHmac("sha256", webhookSignatureKey)
    .update(`${notificationUrl}${rawPayload}`)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signatureHeader);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function normaliseSquareWebhookEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = payload as {
    type?: string;
    data?: {
      id?: string;
      object?: {
        payment?: SquarePayment;
        order?: SquareOrder;
      };
    };
  };
  const payment = event.data?.object?.payment;
  const order = event.data?.object?.order;

  return {
    type: event.type || "",
    paymentId: payment?.id || "",
    orderId: payment?.order_id || order?.id || "",
    status: payment?.status ? mapSquareStatus(payment.status) : deriveSquareOrderStatus(order),
  };
}
