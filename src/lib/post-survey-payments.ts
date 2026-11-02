import { randomUUID } from "node:crypto";
import {
  getPaymentSessionByPaymentId,
  storeCardCheckoutSession,
  storeFrasersPlusPaymentSession,
  updateCardCheckoutStatus,
  updateFrasersPlusPaymentState,
} from "@/lib/frasers-plus-merchant-state";
import {
  buildMerchantDefaults,
  buildMerchantRedirectUrl,
  frasersPlusRequest,
  getFrasersPlusConfig,
  type AuthorizationPayload,
  type UpdatePayload,
} from "@/lib/frasers-plus";
import { buildFrasersPlusCreditBasket } from "@/lib/frasers-plus-capture";
import {
  buildRevolutOrderPayload,
  createRevolutOrder,
  getRevolutConfig,
  refundRevolutOrder,
  shouldUseMockRevolutCheckout,
} from "@/lib/revolut";
import {
  buildSquarePaymentLinkPayload,
  createSquarePaymentLink,
  getSquareConfig,
  getSquareErrorMessage,
  getSquarePaymentIdFromOrder,
  parseSquarePaymentLinkResponse,
  refundSquarePayment,
  resolveSquareOrderPaymentStatus,
  shouldUseSquareCardCheckout,
} from "@/lib/square";
import type { SurveyWorkflow } from "@/lib/post-survey-workflows";

function resolveWorkflowAddress(workflow: SurveyWorkflow) {
  const address = workflow.deliveryAddress ?? workflow.billingAddress;

  return {
    city: address?.city || "",
    country: address?.country || "GB",
    line1: address?.line1 || "",
    line2: address?.line2 || "",
    postalCode: address?.postalCode || "",
    state: "",
    region: "",
  };
}

async function mockFrasersRequest(
  origin: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "test-api-token",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);
  return { response, data };
}

async function updateFrasersPayment(
  origin: string,
  upr: string,
  payload: UpdatePayload,
) {
  const { useMock } = getFrasersPlusConfig();

  if (useMock) {
    const { response, data } = await mockFrasersRequest(
      origin,
      `/api/mock-tymit/payment/${encodeURIComponent(upr)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
    return { response, data };
  }

  return frasersPlusRequest(`/v1/payment/${encodeURIComponent(upr)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function reverseFrasersAuthorization(
  origin: string,
  upr: string,
  amount: number,
  currency = "GBP",
) {
  const payload: UpdatePayload = {
    type: "REVERSAL",
    paymentAmount: {
      amount,
      currency,
    },
  };

  const { response, data } = await updateFrasersPayment(origin, upr, payload);
  if (response.ok) {
    await updateFrasersPlusPaymentState({
      uniquePaymentReference: upr,
      currentType: "REVERSAL",
      status: "CANCELLED",
    });
  }

  return { response, data };
}

export async function createFrasersAuthorizationForWorkflow(
  origin: string,
  workflow: SurveyWorkflow,
  amount: number,
  options?: {
    paymentId?: string;
    paymentIdSuffix?: string;
    redirectUrl?: string;
    metadata?: Record<string, string>;
  },
) {
  const { useMock } = getFrasersPlusConfig();
  const merchantDefaults = buildMerchantDefaults();
  const paymentId = options?.paymentId ?? `${workflow.sourcePaymentId}-${options?.paymentIdSuffix ?? "topup"}-${Date.now()}`;
  const address = resolveWorkflowAddress(workflow);
  const session =
    (await getPaymentSessionByPaymentId(workflow.currentPaymentId)) ??
    (await getPaymentSessionByPaymentId(workflow.sourcePaymentId));

  const payload: AuthorizationPayload = {
    paymentId,
    type: "AUTHORIZATION",
    method: "ONLINE",
    mcc: "5552",
    customer: {
      id: session?.customerId ?? workflow.sourcePaymentId ?? randomUUID(),
      firstName: workflow.customerName?.split(" ").slice(0, 1).join(" ") || "VCHRGD",
      lastName: workflow.customerName?.split(" ").slice(1).join(" ") || "Customer",
      phone: workflow.customerPhone || session?.customerPhone || "+440000000000",
      email: workflow.customerEmail || session?.customerEmail || "customer@example.com",
      billingAddress: address,
      deliveryAddress: address,
    },
    merchant: {
      id: merchantDefaults.merchantId,
      name: merchantDefaults.merchantName,
      redirectUrl: buildMerchantRedirectUrl(
        options?.redirectUrl ?? merchantDefaults.redirectUrl,
        paymentId,
        options?.metadata?.orderOverviewPath,
      ),
    },
    avs: false,
    description: workflow.chargerName || "EV charger installation",
    paymentAmount: {
      amount,
      currency: session?.currency || "GBP",
    },
    basketTimestamp: new Date().toISOString(),
    metadata: {
      propertyType: workflow.propertyType || "",
      parkingType: workflow.parkingType || "",
      fuseBoxDistance: workflow.fuseBoxDistance || "",
      sourcePaymentId: workflow.sourcePaymentId,
      postSurveyReview: "true",
      ...(options?.metadata ?? {}),
    },
  };

  const result = useMock
    ? await mockFrasersRequest(origin, "/api/mock-tymit/payment", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    : await frasersPlusRequest("/v1/payment", {
        method: "POST",
        body: JSON.stringify(payload),
      });

  const data = result.data as
    | {
        uniquePaymentReference?: string;
        redirectUrl?: string;
      }
    | null;

  if (result.response.ok && data?.uniquePaymentReference && data?.redirectUrl) {
    await storeFrasersPlusPaymentSession({
      paymentId,
      uniquePaymentReference: data.uniquePaymentReference,
      redirectUrl: data.redirectUrl,
      customerId: payload.customer.id,
      customerName: workflow.customerName,
      customerEmail: workflow.customerEmail,
      customerPhone: workflow.customerPhone,
      chargerName: workflow.chargerName,
      amount,
      currency: payload.paymentAmount.currency,
      propertyType: workflow.propertyType,
      parkingType: workflow.parkingType,
      fuseBoxDistance: workflow.fuseBoxDistance,
      billingAddress: address,
      deliveryAddress: address,
    });

  }

  return {
    paymentId,
    response: result.response,
    data,
  };
}

export async function createCardCheckoutForWorkflow(
  origin: string,
  workflow: SurveyWorkflow,
  amount: number,
  reservedPaymentId?: string,
) {
  const paymentId = reservedPaymentId ?? `${workflow.sourcePaymentId}-topup-card-${Date.now()}`;
  const { currency } = getRevolutConfig();
  const address = resolveWorkflowAddress(workflow);
  const useSquare = shouldUseSquareCardCheckout();
  const useMock = !useSquare && shouldUseMockRevolutCheckout();
  const payload = {
    paymentId,
    customerId: workflow.sourcePaymentId,
    firstName: workflow.customerName?.split(" ").slice(0, 1).join(" ") || "VCHRGD",
    lastName: workflow.customerName?.split(" ").slice(1).join(" ") || "Customer",
    email: workflow.customerEmail || "customer@example.com",
    phone: workflow.customerPhone || "+440000000000",
    charger: {
      slug: workflow.chargerSlug || "ev-installation-topup",
      name: `${workflow.chargerName || "EV charger installation"} additional amount`,
      hardwarePrice: 0,
      installPrice: amount,
    },
    surveyAdjustment: 0,
    total: amount,
    propertyType: workflow.propertyType ?? undefined,
    parkingType: workflow.parkingType ?? undefined,
    fuseBoxDistance: workflow.fuseBoxDistance ?? undefined,
    billingAddress: address,
    deliveryAddress: address,
  };

  if (useSquare) {
    const { response, data } = await createSquarePaymentLink(
      buildSquarePaymentLinkPayload(payload, origin),
    );
    const checkout = response.ok ? parseSquarePaymentLinkResponse(data) : null;

    if (response.ok && checkout) {
      await storeCardCheckoutSession({
        paymentId,
        cardProcessor: "SQUARE",
        providerPaymentReference: checkout.orderId,
        redirectUrl: checkout.url,
        customerId: payload.customerId,
        customerName: workflow.customerName,
        customerEmail: payload.email,
        customerPhone: payload.phone,
        chargerName: workflow.chargerName,
        chargerSlug: workflow.chargerSlug,
        amount,
        currency: getSquareConfig().currency,
        hardwarePrice: 0,
        installPrice: amount,
        surveyAdjustment: 0,
        propertyType: workflow.propertyType,
        parkingType: workflow.parkingType,
        fuseBoxDistance: workflow.fuseBoxDistance,
        billingAddress: address,
        deliveryAddress: address,
      });

      return {
        paymentId,
        providerPaymentReference: checkout.orderId,
        redirectUrl: checkout.url,
        response,
        data,
      };
    }

    return {
      paymentId,
      providerPaymentReference: undefined,
      redirectUrl: undefined,
      response,
      data:
        data ?? {
          error: getSquareErrorMessage(data, "Unable to create the Square-hosted checkout page."),
        },
    };
  }

  if (useMock) {
    const providerPaymentReference = `mock_revolut_topup_${Date.now()}`;
    const redirectUrl = `${origin}/mock-card-checkout?paymentId=${encodeURIComponent(paymentId)}&order_id=${encodeURIComponent(providerPaymentReference)}`;

    await storeCardCheckoutSession({
      paymentId,
      cardProcessor: "MOCK",
      providerPaymentReference,
      redirectUrl,
      customerId: payload.customerId,
      customerName: workflow.customerName,
      customerEmail: payload.email,
      customerPhone: payload.phone,
      chargerName: workflow.chargerName,
      chargerSlug: workflow.chargerSlug,
      amount,
      currency: currency.toUpperCase(),
      hardwarePrice: 0,
      installPrice: amount,
      surveyAdjustment: 0,
      propertyType: workflow.propertyType,
      parkingType: workflow.parkingType,
      fuseBoxDistance: workflow.fuseBoxDistance,
      billingAddress: address,
      deliveryAddress: address,
    });

    return {
      paymentId,
      providerPaymentReference,
      redirectUrl,
      response: new Response(null, { status: 200 }),
      data: { id: providerPaymentReference, url: redirectUrl },
    };
  }

  const { response, data } = await createRevolutOrder(
    buildRevolutOrderPayload(payload, origin),
  );

  const order =
    data && typeof data === "object" && "id" in data && "checkout_url" in data
      ? data
      : null;

  if (
    response.ok &&
    order &&
    typeof order.id === "string" &&
    typeof order.checkout_url === "string"
  ) {
    await storeCardCheckoutSession({
      paymentId,
      cardProcessor: "REVOLUT",
      providerPaymentReference: order.id,
      redirectUrl: order.checkout_url,
      customerId: payload.customerId,
      customerName: workflow.customerName,
      customerEmail: payload.email,
      customerPhone: payload.phone,
      chargerName: workflow.chargerName,
      chargerSlug: workflow.chargerSlug,
      amount,
      currency: currency.toUpperCase(),
      hardwarePrice: 0,
      installPrice: amount,
      surveyAdjustment: 0,
      propertyType: workflow.propertyType,
      parkingType: workflow.parkingType,
      fuseBoxDistance: workflow.fuseBoxDistance,
      billingAddress: address,
      deliveryAddress: address,
    });
  }

  return {
    paymentId,
    providerPaymentReference:
      order && typeof order.id === "string" ? order.id : undefined,
    redirectUrl:
      order && typeof order.checkout_url === "string" ? order.checkout_url : undefined,
    response,
    data,
  };
}

export async function approveRefundForWorkflow(
  origin: string,
  workflow: SurveyWorkflow,
) {
  const session =
    (await getPaymentSessionByPaymentId(workflow.currentPaymentId)) ??
    (await getPaymentSessionByPaymentId(workflow.sourcePaymentId));

  if (workflow.provider === "FRASERS_PLUS") {
    if (!session) {
      return {
        ok: false,
        detail: "Original Frasers Plus payment session was not found.",
        data: null,
        status: undefined,
      };
    }

    if (!session.uniquePaymentReference) {
      return {
        ok: false,
        detail: "Original Frasers Plus payment reference was not found.",
        data: null,
        status: undefined,
      };
    }

    const currentPayment = await frasersPlusRequest(
      `/v1/payment/${encodeURIComponent(session.uniquePaymentReference)}`,
      { method: "GET" },
    );
    if (!currentPayment.response.ok) {
      return {
        ok: false,
        detail: "Could not confirm the current Frasers Plus payment state before refunding.",
        data: currentPayment.data,
        status: currentPayment.response.status,
      };
    }

    const currentData =
      currentPayment.data && typeof currentPayment.data === "object"
        ? (currentPayment.data as Record<string, unknown>)
        : {};
    const history = Array.isArray(currentData.history)
      ? currentData.history.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
        )
      : [];
    const historyTypes = history
      .map((entry) => (typeof entry.type === "string" ? entry.type.toUpperCase() : ""))
      .filter(Boolean);
    const currentType =
      typeof currentData.type === "string" ? currentData.type.toUpperCase() : historyTypes.at(-1);

    if (currentType === "CREDIT" || currentType === "REVERSAL") {
      return {
        ok: true,
        detail: `${currentType}_ALREADY_COMPLETED`,
        data: currentPayment.data,
        status: currentPayment.response.status,
      };
    }

    const refundType = currentType === "CAPTURE" ? "CREDIT" : "REVERSAL";
    const capturedAmount = [...history]
      .reverse()
      .find((entry) => entry.type === "CAPTURE")?.paymentAmount;
    const capturedAmountValue =
      capturedAmount && typeof capturedAmount === "object"
        ? (capturedAmount as Record<string, unknown>).amount
        : undefined;
    const refundAmount =
      typeof capturedAmountValue === "number"
        ? capturedAmountValue
        : session.amount ?? workflow.originalAmount;
    const payload: UpdatePayload = {
      type: refundType,
      paymentAmount: {
        amount: refundAmount,
        currency: session.currency || "GBP",
      },
      ...(refundType === "CREDIT"
        ? { basket: buildFrasersPlusCreditBasket(session, refundAmount) }
        : {}),
      metadata: {
        paymentId: session.paymentId,
        sourcePaymentId: workflow.sourcePaymentId,
      },
    };

    const { response, data } = await updateFrasersPayment(
      origin,
      session.uniquePaymentReference,
      payload,
    );

    if (response.ok) {
      await updateFrasersPlusPaymentState({
        uniquePaymentReference: session.uniquePaymentReference,
        paymentId: session.paymentId,
        currentType: refundType,
        status: refundType === "REVERSAL" ? "CANCELLED" : "COMPLETED",
      });
    }

    return { ok: response.ok, detail: refundType, data, status: response.status };
  }

  if (!session) {
    return {
      ok: false,
      detail: "Original card payment session was not found.",
      data: null,
      status: undefined,
    };
  }

  if (session.cardProcessor === "MOCK" || (!session.cardProcessor && shouldUseMockRevolutCheckout())) {
    await updateCardCheckoutStatus({
      paymentId: session.paymentId,
      providerPaymentReference: session.providerPaymentReference ?? session.stripeSessionId,
      status: "REFUNDED",
    });
    return { ok: true, detail: "Mock Revolut refund completed.", data: null, status: 200 };
  }

  const providerPaymentReference =
    session.providerPaymentReference ?? session.stripeSessionId;

  if (!providerPaymentReference) {
    return {
      ok: false,
      detail: "No card payment reference was available for refund.",
      data: null,
      status: undefined,
    };
  }

  const refundReference = `${session.paymentId}-refund-${Date.now()}`;

  if (session.cardProcessor === "SQUARE") {
    const resolved = await resolveSquareOrderPaymentStatus(providerPaymentReference);
    const squarePaymentId = resolved.paymentId || getSquarePaymentIdFromOrder(resolved.data);

    if (!squarePaymentId) {
      return {
        ok: false,
        detail: "No Square payment reference was available for refund.",
        data: resolved.data,
        status: undefined,
      };
    }

    const { response, data } = await refundSquarePayment(
      squarePaymentId,
      session.amount ?? workflow.originalAmount,
      session.currency || getSquareConfig().currency,
      refundReference,
    );

    if (!response.ok) {
      return { ok: false, detail: "Square refund request was not accepted.", data, status: response.status };
    }

    await updateCardCheckoutStatus({
      paymentId: session.paymentId,
      providerPaymentReference,
      status: "REFUNDED",
    });

    return { ok: true, detail: refundReference, data, status: response.status };
  }

  const { response, data } = await refundRevolutOrder(
    providerPaymentReference,
    session.amount ?? workflow.originalAmount,
    session.currency || "GBP",
    refundReference,
  );

  if (!response.ok) {
    return { ok: false, detail: "Revolut refund request was not accepted.", data, status: response.status };
  }

  await updateCardCheckoutStatus({
    paymentId: session.paymentId,
    providerPaymentReference,
    status: "REFUNDED",
  });

  return { ok: true, detail: refundReference, data, status: response.status };
}

export async function registerMockBalanceCardPayment(workflow: SurveyWorkflow, amount: number) {
  const paymentId = `${workflow.sourcePaymentId}-balance-${Date.now()}`;
  const sessionId = `balance_card_${Date.now()}`;
  const address = resolveWorkflowAddress(workflow);

  await storeCardCheckoutSession({
    paymentId,
    providerPaymentReference: sessionId,
    redirectUrl: "",
    customerId: workflow.sourcePaymentId,
    customerName: workflow.customerName,
    customerEmail: workflow.customerEmail,
    customerPhone: workflow.customerPhone,
    chargerName: workflow.chargerName,
    chargerSlug: workflow.chargerSlug,
    amount,
    currency: "GBP",
    hardwarePrice: 0,
    installPrice: amount,
    surveyAdjustment: 0,
    propertyType: workflow.propertyType,
    parkingType: workflow.parkingType,
    fuseBoxDistance: workflow.fuseBoxDistance,
    billingAddress: address,
    deliveryAddress: address,
  });
  await updateCardCheckoutStatus({
    paymentId,
    providerPaymentReference: sessionId,
    status: "COMPLETED",
  });

  return { paymentId, sessionId };
}
