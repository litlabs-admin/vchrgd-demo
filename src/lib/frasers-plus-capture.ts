import {
  frasersPlusRequest,
  getFrasersPlusConfig,
  type UpdatePayload,
} from "@/lib/frasers-plus";
import {
  getPaymentSessionByUpr,
  updateFrasersPlusPaymentState,
  type PaymentSession,
} from "@/lib/frasers-plus-merchant-state";

type CaptureResult = {
  ok: boolean;
  status: number;
  data: unknown;
  session?: PaymentSession;
  alreadyCaptured?: boolean;
};

type ProviderPayment = {
  type?: string;
  currentType?: string;
  status?: string;
};

const globalCaptureState = globalThis as typeof globalThis & {
  __vchrgdFrasersCapturePromises?: Map<string, Promise<CaptureResult>>;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function readProviderPayment(data: unknown): ProviderPayment {
  return data && typeof data === "object" ? (data as ProviderPayment) : {};
}

function isCapturedPayment(data: unknown) {
  const payment = readProviderPayment(data);
  const type = payment.type ?? payment.currentType;
  return type === "CAPTURE" && payment.status === "COMPLETED";
}

export function buildFrasersPlusCaptureBasket(session: PaymentSession) {
  const total = roundMoney(Math.max(Number(session.amount ?? 0), 0));
  const discount = roundMoney(Math.max(Number(session.discountAmount ?? 0), 0));
  const grossBeforeDiscount = roundMoney(
    Math.max(Number(session.totalBeforeDiscount ?? total + discount), total),
  );
  const subtotal = roundMoney(total / 1.2);
  const tax = roundMoney(total - subtotal);
  const productId = cleanIdentifier(session.chargerSlug || session.chargerName || "vchrgd-installation");
  const productName = session.chargerName || "VCHRGD charger installed package";

  return {
    affiliation: "VCHRGD D2C",
    ...(session.discountCode ? { coupon: session.discountCode } : {}),
    discount,
    internalOrderId: session.paymentId,
    orderId: session.paymentId,
    orderStatus: "UNFULLFILLED",
    paymentMethods: ["FRASERSPLUSCREDIT"],
    basketItems: {
      discount,
      products: [
        {
          brand: "VCHRGD",
          category: "EV charger installation",
          categoryId: "EV-CHARGER-INSTALLATION",
          isFullPrice: discount === 0,
          name: productName,
          price: grossBeforeDiscount,
          priceExcl: roundMoney(grossBeforeDiscount / 1.2),
          discount,
          id: productId,
          quantity: 1,
          sku: productId,
          subtotal,
          tax,
          total,
        },
      ],
    },
    shipping: {
      price: 0,
      discount: 0,
      method: "Installation",
      tax: 0,
    },
    shopCode: process.env.FRASERS_PLUS_SHOP_CODE || "VCHRGD-D2C",
    subtotal,
    tax,
    total,
    currency: session.currency || "GBP",
  };
}

export function buildFrasersPlusCreditBasket(
  session: PaymentSession,
  refundAmount: number,
) {
  const total = roundMoney(Math.max(refundAmount, 0));
  const originalPaidTotal = roundMoney(Math.max(Number(session.amount ?? total), 0));
  const originalDiscount = roundMoney(Math.max(Number(session.discountAmount ?? 0), 0));
  const refundRatio = originalPaidTotal > 0 ? Math.min(total / originalPaidTotal, 1) : 1;
  const discount = roundMoney(originalDiscount * refundRatio);
  const grossBeforeDiscount = roundMoney(total + discount);
  const subtotal = roundMoney(total / 1.2);
  const tax = roundMoney(total - subtotal);
  const productId = cleanIdentifier(
    session.chargerSlug || session.chargerName || "vchrgd-installation",
  );

  return {
    ...(session.discountCode ? { coupon: session.discountCode } : {}),
    discount,
    orderStatus: "UNFULLFILLED",
    type: "CREDIT",
    basketItems: {
      discount,
      products: [
        {
          price: grossBeforeDiscount,
          priceExcl: roundMoney(grossBeforeDiscount / 1.2),
          discount,
          id: productId,
          quantity: 1,
          sku: productId,
          subtotal,
          tax,
          total,
          reason: "Customer order cancelled",
          reasonCode: "ORDER_CANCELLED",
        },
      ],
    },
    shipping: {
      price: 0,
      discount: 0,
      method: "Installation",
      tax: 0,
    },
    returnLocationCode: process.env.FRASERS_PLUS_RETURN_LOCATION_CODE || "999",
    subtotal,
    tax,
    total,
    currency: session.currency || "GBP",
  };
}

async function providerRequest(
  origin: string,
  upr: string,
  method: "GET" | "PUT",
  payload?: UpdatePayload,
) {
  const { useMock } = getFrasersPlusConfig();

  if (useMock) {
    const response = await fetch(
      `${origin}/api/mock-tymit/payment/${encodeURIComponent(upr)}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-api-token",
        },
        body: payload ? JSON.stringify(payload) : undefined,
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => null);
    return { response, data };
  }

  return frasersPlusRequest(`/v1/payment/${encodeURIComponent(upr)}`, {
    method,
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

async function performCapture(
  origin: string,
  upr: string,
  knownSession?: PaymentSession,
): Promise<CaptureResult> {
  const session = knownSession ?? (await getPaymentSessionByUpr(upr));
  if (session && ["CREDIT", "REVERSAL"].includes(session.latestStatus?.currentType ?? "")) {
    return { ok: false, status: 409, data: { error: "Refunded or reversed payments cannot be captured." }, session };
  }
  if (!session || !Number.isFinite(session.amount) || !session.amount || session.amount <= 0) {
    return {
      ok: false,
      status: 422,
      data: { error: "Payment session or capture amount is unavailable." },
      session,
    };
  }

  if (
    session.latestStatus?.currentType === "CAPTURE" &&
    session.latestStatus.status === "COMPLETED"
  ) {
    return {
      ok: true,
      status: 200,
      data: {
        type: "CAPTURE",
        status: "COMPLETED",
      },
      session,
      alreadyCaptured: true,
    };
  }

  const payload: UpdatePayload = {
    type: "CAPTURE",
    paymentAmount: {
      amount: roundMoney(session.amount),
      currency: session.currency || "GBP",
    },
    basket: buildFrasersPlusCaptureBasket(session),
    metadata: {
      paymentId: session.paymentId,
      vchrgdPaymentId: session.paymentId,
    },
  };
  const { response, data } = await providerRequest(origin, upr, "PUT", payload);

  if (response.ok && isCapturedPayment(data)) {
    const nextSession =
      (await updateFrasersPlusPaymentState({
        uniquePaymentReference: upr,
        paymentId: session.paymentId,
        currentType: "CAPTURE",
        status: "COMPLETED",
      })) ?? session;
    return { ok: true, status: response.status, data, session: nextSession };
  }

  // A 2xx response may only acknowledge a pending operation. Confirm the actual
  // captured state; also reconcile conflicts caused by concurrent callbacks.
  if (response.ok || response.status === 409) {
    const reconciled = await providerRequest(origin, upr, "GET");
    if (reconciled.response.ok && isCapturedPayment(reconciled.data)) {
      const nextSession =
        (await updateFrasersPlusPaymentState({
          uniquePaymentReference: upr,
          paymentId: session.paymentId,
          currentType: "CAPTURE",
          status: "COMPLETED",
        })) ?? session;
      return {
        ok: true,
        status: reconciled.response.status,
        data: reconciled.data,
        session: nextSession,
        alreadyCaptured: true,
      };
    }
  }

  return { ok: false, status: response.status, data, session };
}

export async function captureFrasersPlusAuthorization(
  origin: string,
  upr: string,
  session?: PaymentSession,
) {
  const captures =
    globalCaptureState.__vchrgdFrasersCapturePromises ??
    (globalCaptureState.__vchrgdFrasersCapturePromises = new Map());
  const existing = captures.get(upr);
  if (existing) {
    return existing;
  }

  const capture = performCapture(origin, upr, session).finally(() => {
    captures.delete(upr);
  });
  captures.set(upr, capture);
  return capture;
}
