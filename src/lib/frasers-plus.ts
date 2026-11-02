import { createFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";

type MerchantAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
  state?: string;
  region?: string;
};

type AuthorizationPayload = {
  paymentId: string;
  type: "AUTHORIZATION";
  method: string;
  mcc: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    billingAddress: MerchantAddress;
    deliveryAddress: MerchantAddress;
  };
  merchant: {
    id: string;
    name: string;
    redirectUrl: string;
    metadata?: Record<string, string>;
  };
  avs: boolean;
  description: string;
  paymentAmount: {
    amount: number;
    currency: string;
  };
  expiresAt?: string;
  basketTimestamp?: string;
  metadata?: Record<string, string>;
};

type UpdatePayload = {
  type: "CAPTURE" | "REVERSAL" | "CREDIT";
  paymentAmount: {
    amount: number;
    currency: string;
  };
  basket?: Record<string, unknown>;
  metadata?: Record<string, string>;
};

function isPlaceholderValue(value: string | undefined) {
  return !value || value.startsWith("replace-with-");
}

function isLocalLikeHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

export function getFrasersPlusConfig() {
  const apiBaseUrl = normaliseFrasersPlusApiBaseUrl(
    process.env.FRASERS_PLUS_API_BASE_URL || "https://merchant-api.staging.tymit.com",
  );
  const apiKey = process.env.FRASERS_PLUS_API_KEY || "test-api-token";
  const merchantId =
    process.env.FRASERS_PLUS_MERCHANT_ID || "frasers-plus-demo-store";
  const merchantName = process.env.FRASERS_PLUS_MERCHANT_NAME || "VCHRGD";
  const redirectUrl =
    process.env.FRASERS_PLUS_REDIRECT_URL || "http://localhost:3000/frasers-plus/return";
  const webhookAuthValue = process.env.FRASERS_PLUS_WEBHOOK_AUTH_VALUE || "";
  const useMock =
    process.env.FRASERS_PLUS_USE_MOCK === "true" ||
    isPlaceholderValue(process.env.FRASERS_PLUS_API_KEY) ||
    isPlaceholderValue(process.env.FRASERS_PLUS_MERCHANT_ID);

  const liveValidation = process.env.FRASERS_PLUS_LIVE_VALIDATION === "true";
  const liveProduction = process.env.FRASERS_PLUS_LIVE_PRODUCTION === "true";
  if (liveValidation || liveProduction) {
    const expectedHost = liveProduction ? "payments.vchrgd.app" : "staging.vchrgd.app";
    const returnTokenSecret = liveProduction
      ? process.env.FRASERS_PLUS_LIVE_RETURN_TOKEN_SECRET || process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET
      : process.env.FRASERS_PLUS_RETURN_TOKEN_SECRET;
    const invalidSettings = [
      liveValidation && liveProduction ? "FRASERS_PLUS_LIVE_VALIDATION/FRASERS_PLUS_LIVE_PRODUCTION" : null,
      useMock ? "FRASERS_PLUS_USE_MOCK/API_KEY/MERCHANT_ID" : null,
      apiKey === "test-api-token" ? "FRASERS_PLUS_API_KEY" : null,
      merchantId === "frasers-plus-demo-store" ? "FRASERS_PLUS_MERCHANT_ID" : null,
      apiBaseUrl !== "https://frasers-proxy.payments.vchrgd.app/live" ? "FRASERS_PLUS_API_BASE_URL" : null,
      redirectUrl !== `https://${expectedHost}/frasers-plus/return` ? "FRASERS_PLUS_REDIRECT_URL" : null,
      !/^Bearer \S+$/.test(webhookAuthValue.trim()) ? "FRASERS_PLUS_WEBHOOK_AUTH_VALUE" : null,
      isPlaceholderValue(returnTokenSecret) ? "FRASERS_PLUS_RETURN_TOKEN_SECRET" : null,
    ].filter(Boolean);
    if (invalidSettings.length) {
      // Setting names only: never include credential values in server logs.
      throw new Error(`Frasers Plus live configuration invalid: ${invalidSettings.join(", ")}.`);
    }
  }

  return {
    useMock,
    apiBaseUrl,
    apiKey,
    merchantId,
    merchantName,
    redirectUrl,
    webhookAuthValue,
  };
}

function normaliseFrasersPlusApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export function buildMerchantDefaults() {
  const { merchantId, merchantName, redirectUrl } = getFrasersPlusConfig();
  return { merchantId, merchantName, redirectUrl };
}

export function buildMerchantRedirectUrl(
  baseRedirectUrl: string,
  paymentId: string,
  returnToPath?: string,
) {
  const url = new URL(baseRedirectUrl);
  url.searchParams.set("paymentId", paymentId);
  url.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  if (returnToPath?.startsWith("/") && !returnToPath.startsWith("//")) {
    url.searchParams.set("returnTo", returnToPath);
  }
  return url.toString();
}

export function resolveMerchantRedirectBase(requestOrigin: string) {
  const { redirectUrl } = getFrasersPlusConfig();
  const fallbackUrl = new URL("/frasers-plus/return", requestOrigin);

  if (isPlaceholderValue(redirectUrl)) {
    return fallbackUrl.toString();
  }

  try {
    const configuredUrl = new URL(redirectUrl);
    const requestUrl = new URL(requestOrigin);

    if (
      !process.env.VERCEL &&
      isLocalLikeHostname(requestUrl.hostname) &&
      configuredUrl.origin !== requestUrl.origin
    ) {
      return fallbackUrl.toString();
    }

    if (
      isLocalLikeHostname(configuredUrl.hostname) &&
      configuredUrl.origin !== requestUrl.origin
    ) {
      configuredUrl.protocol = requestUrl.protocol;
      configuredUrl.host = requestUrl.host;
    }

    return configuredUrl.toString();
  } catch {
    return fallbackUrl.toString();
  }
}

export async function frasersPlusRequest(
  path: string,
  init?: RequestInit,
) {
  const { apiBaseUrl, apiKey } = getFrasersPlusConfig();
  const debugEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.FRASERS_PLUS_DEBUG === "true";
  const requestUrl = `${apiBaseUrl}${path}`;

  if (debugEnabled) {
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // Keep non-JSON request bodies as text for local diagnostics.
      }
    }
    console.info(
      "[Frasers Plus request]",
      JSON.stringify(
        {
          method: init?.method ?? "GET",
          url: requestUrl,
          body,
        },
        null,
        2,
      ),
    );
  }

  const response = await fetch(requestUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
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

  if (debugEnabled) {
    console.info(
      "[Frasers Plus response]",
      JSON.stringify(
        {
          method: init?.method ?? "GET",
          url: requestUrl,
          status: response.status,
          statusText: response.statusText,
          data,
        },
        null,
        2,
      ),
    );
  }

  return { response, data };
}

export type { AuthorizationPayload, UpdatePayload };
