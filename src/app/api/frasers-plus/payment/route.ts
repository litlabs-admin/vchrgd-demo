import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildMerchantRedirectUrl,
  buildMerchantDefaults,
  frasersPlusRequest,
  getFrasersPlusConfig,
  resolveMerchantRedirectBase,
  type AuthorizationPayload,
} from "@/lib/frasers-plus";
import { getPaymentSessionByPaymentId, storeFrasersPlusPaymentSession } from "@/lib/frasers-plus-merchant-state";
import { getCheckoutQuote, requireExpectedTotal } from "@/lib/checkout-pricing";
import { checkoutErrorResponse, CheckoutRequestError, limitCheckoutRequests, readCheckoutJson, requireCheckoutAccess } from "@/lib/checkout-request";
import { tryReserveDedupeKey, releaseDedupeKey } from "@/lib/server-data";
import { createCheckoutAccess, checkoutResumePath } from "@/lib/checkout-access";
import {
  getEmailValidationMessage,
  getUkMobileValidationMessage,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";
import {
  buildHistoryEntry,
  setStoredMockPayment,
  type MockApprovalOutcome,
  type MockPaymentRecord,
} from "@/lib/mock-tymit";
import { isSameOriginMutationRequest } from "@/lib/request-guards";

const PENDING_RETURN_COOKIE = "vchrgd_fp_pending_return";

function attachPendingReturnContext(
  response: NextResponse,
  request: Request,
  paymentId: string,
  returnTo: string,
  merchantRedirectUrl: string,
) {
  const returnToken = new URL(merchantRedirectUrl).searchParams.get("rt") ?? "";
  const value = Buffer.from(
    JSON.stringify({
      paymentId,
      returnTo,
      returnToken,
    }),
  ).toString("base64url");

  response.cookies.set(PENDING_RETURN_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}

export async function POST(request: Request) {
  let reservedPaymentId: string | undefined;
  try {
  if (
    process.env.ENABLE_FRASERS_PLUS !== "true" &&
    process.env.NEXT_PUBLIC_ENABLE_FRASERS_PLUS !== "true"
  ) {
    return NextResponse.json({ error: "Frasers Plus is not currently available." }, { status: 404 });
  }

  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await readCheckoutJson<AuthorizationPayload>(request);
  requireCheckoutAccess(request, payload.paymentId);
  limitCheckoutRequests(`payment:${payload.paymentId}`, 12);
  const normalizedEmail = normaliseEmailInput(payload.customer?.email);
  const emailValidationMessage = getEmailValidationMessage(normalizedEmail);
  const normalizedPhone = normaliseUkMobileInput(payload.customer?.phone);
  const phoneValidationMessage = getUkMobileValidationMessage(normalizedPhone);

  if (emailValidationMessage) {
    return NextResponse.json({ error: emailValidationMessage }, { status: 400 });
  }

  if (phoneValidationMessage) {
    return NextResponse.json({ error: phoneValidationMessage }, { status: 400 });
  }

  payload.customer.email = normalizedEmail;
  payload.customer.phone = normalizedPhone;

  const quote = await getCheckoutQuote(payload.metadata?.chargerSlug, payload.metadata?.discountCode);
  if (quote.invalidVoucher) throw new CheckoutRequestError("This voucher is not valid for this order.", 409);
  requireExpectedTotal(quote.total, payload.paymentAmount?.amount);
  if (payload.paymentAmount.currency !== "GBP") throw new CheckoutRequestError("Unsupported currency.");
  payload.paymentAmount = { amount: quote.total, currency: "GBP" };
  payload.description = `${quote.charger.name} installation`;
  payload.type = "AUTHORIZATION";
  payload.method = "ONLINE";
  payload.mcc = "5552";
  payload.metadata = { ...payload.metadata, chargerSlug: quote.charger.slug, discountAmount: String(quote.discountAmount), discountCode: quote.discountCode, discountLabel: quote.discountLabel, totalBeforeDiscount: String(quote.totalBeforeDiscount) };
  if (!await tryReserveDedupeKey("checkout-creation", payload.paymentId)) throw new CheckoutRequestError("Your checkout is already being prepared. Please wait a moment.", 409);
  reservedPaymentId = payload.paymentId;
  const requestedReturnPath = `${checkoutResumePath(createCheckoutAccess(payload.paymentId))}&retry=1`;
  const redirectUrl = buildMerchantRedirectUrl(
    resolveMerchantRedirectBase(new URL(request.url).origin),
    payload.paymentId,
    requestedReturnPath,
  );
  const existing = await getPaymentSessionByPaymentId(payload.paymentId);
  if (existing) {
    if (existing.provider === "FRASERS_PLUS" && ["PENDING", "CREATED", "NEW"].includes(existing.latestStatus?.status?.toUpperCase() || "PENDING") && existing.redirectUrl && existing.amount === quote.total) {
      return attachPendingReturnContext(
        NextResponse.json({ uniquePaymentReference: existing.uniquePaymentReference, redirectUrl: existing.redirectUrl, status: "PENDING" }),
        request, payload.paymentId, requestedReturnPath, redirectUrl,
      );
    }
    throw new CheckoutRequestError("This payment attempt is already recorded. Please reopen your secure order link or start a fresh attempt.", 409);
  }

  const { useMock } = getFrasersPlusConfig();
  const merchantDefaults = buildMerchantDefaults();
  const normalizedPayload: AuthorizationPayload = {
    ...payload,
    metadata: {
      ...payload.metadata,
      paymentId: payload.paymentId,
      vchrgdPaymentId: payload.paymentId,
    },
    merchant: {
      ...payload.merchant,
      id: merchantDefaults.merchantId,
      name: merchantDefaults.merchantName,
      redirectUrl,
    },
  };

  if (useMock) {
    const requestedOutcome = String(payload.metadata?.scenario ?? "approved");
    const mockOutcome: MockApprovalOutcome =
      requestedOutcome === "pending" || requestedOutcome === "declined"
        ? requestedOutcome
        : "approved";
    const mockSessionUpr = randomUUID();
    const customerName =
      `${payload.customer.firstName} ${payload.customer.lastName}`.trim() || "VCHRGD customer";
    const amount = Number(payload.paymentAmount.amount ?? 0);
    const currency = String(payload.paymentAmount.currency ?? "GBP");
    const merchantReturnUrl = new URL(redirectUrl);
    const mockHostedUrl = new URL("/mock-hpp", request.url);
    mockHostedUrl.searchParams.set("upr", mockSessionUpr);
    mockHostedUrl.searchParams.set("redirect", merchantReturnUrl.toString());
    mockHostedUrl.searchParams.set("scenario", mockOutcome);
    mockHostedUrl.searchParams.set(
      "profile",
      String(payload.metadata?.sandboxProfile ?? "fast-track"),
    );
    mockHostedUrl.searchParams.set("paymentId", payload.paymentId);
    mockHostedUrl.searchParams.set("customerName", customerName);
    mockHostedUrl.searchParams.set("customerEmail", payload.customer.email);
    mockHostedUrl.searchParams.set("customerPhone", payload.customer.phone);
    mockHostedUrl.searchParams.set("chargerName", payload.description);
    mockHostedUrl.searchParams.set("amount", String(amount));
    if (typeof payload.metadata?.orderOverviewPath === "string" && payload.metadata.orderOverviewPath) {
      mockHostedUrl.searchParams.set("orderOverview", payload.metadata.orderOverviewPath);
    }
    const redirectTargetUrl = mockHostedUrl.toString();
    const initialStatus = "PENDING";

    const mockRecord: MockPaymentRecord = {
      uniquePaymentReference: mockSessionUpr,
      paymentId: payload.paymentId,
      redirectUrl: redirectTargetUrl,
      merchantRedirectUrl: redirectUrl,
      amount,
      currency,
      customerName,
      customerEmail: payload.customer.email,
      customerPhone: payload.customer.phone,
      charger: payload.description,
      scenario: mockOutcome,
      sandboxProfile: String(payload.metadata?.sandboxProfile ?? "fast-track"),
      status: initialStatus,
      currentType: "AUTHORIZATION",
      pollCount: 0,
      authorizationMethod: payload.method,
      mcc: payload.mcc,
      basketTimestamp: payload.basketTimestamp,
      expiresAt: payload.expiresAt,
      metadata: payload.metadata,
      history: [buildHistoryEntry("AUTHORIZATION", initialStatus, amount, currency)],
    };

    await storeFrasersPlusPaymentSession({
      paymentId: payload.paymentId,
      uniquePaymentReference: mockSessionUpr,
      redirectUrl: redirectTargetUrl,
      customerId: payload.customer.id,
      customerName,
      customerEmail: payload.customer.email,
      customerPhone: payload.customer.phone,
      chargerName: payload.description,
      amount,
      currency,
      discountAmount: Number(payload.metadata?.discountAmount ?? 0),
      discountCode: payload.metadata?.discountCode,
      discountLabel: payload.metadata?.discountLabel,
      totalBeforeDiscount: Number(payload.metadata?.totalBeforeDiscount ?? amount),
      propertyType: payload.metadata?.propertyType,
      parkingType: payload.metadata?.parkingType,
      fuseBoxDistance: payload.metadata?.fuseBoxDistance,
      billingAddress: payload.customer.billingAddress,
      deliveryAddress: payload.customer.deliveryAddress,
    });
    await setStoredMockPayment(mockRecord);

    return attachPendingReturnContext(
      NextResponse.json(
        {
          uniquePaymentReference: mockSessionUpr,
          redirectUrl: redirectTargetUrl,
          status: initialStatus,
        },
        { status: 200 },
      ),
      request,
      payload.paymentId,
      requestedReturnPath,
      redirectUrl,
    );
  }

  const { response, data } = await frasersPlusRequest("/v1/payment", {
    method: "POST",
    body: JSON.stringify(normalizedPayload),
  });

  const result = data as {
    uniquePaymentReference?: string;
    redirectUrl?: string;
  } | null;

  if (response.ok && result?.uniquePaymentReference && result?.redirectUrl) {
    await storeFrasersPlusPaymentSession({
      paymentId: payload.paymentId,
      uniquePaymentReference: result.uniquePaymentReference,
      redirectUrl: result.redirectUrl,
      customerId: payload.customer.id,
      customerName: `${payload.customer.firstName} ${payload.customer.lastName}`.trim(),
      customerEmail: payload.customer.email,
      customerPhone: payload.customer.phone,
      chargerName: payload.description,
      amount: payload.paymentAmount.amount,
      currency: payload.paymentAmount.currency,
      discountAmount: Number(payload.metadata?.discountAmount ?? 0),
      discountCode: payload.metadata?.discountCode,
      discountLabel: payload.metadata?.discountLabel,
      totalBeforeDiscount: Number(payload.metadata?.totalBeforeDiscount ?? payload.paymentAmount.amount),
      propertyType: payload.metadata?.propertyType,
      parkingType: payload.metadata?.parkingType,
      fuseBoxDistance: payload.metadata?.fuseBoxDistance,
      billingAddress: payload.customer.billingAddress,
      deliveryAddress: payload.customer.deliveryAddress,
    });
  }

  const apiResponse = NextResponse.json(data, { status: response.status });
  return response.ok && result?.uniquePaymentReference && result?.redirectUrl
    ? attachPendingReturnContext(
        apiResponse,
        request,
        payload.paymentId,
        requestedReturnPath,
        redirectUrl,
      )
    : apiResponse;
  } catch (error) { return checkoutErrorResponse(error); }
  finally { if (reservedPaymentId) await releaseDedupeKey("checkout-creation", reservedPaymentId); }
}
