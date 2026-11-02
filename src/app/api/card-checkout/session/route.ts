import { NextResponse } from "next/server";
import {
  buildRevolutOrderPayload,
  createRevolutOrder,
  getRevolutConfig,
  shouldUseMockRevolutCheckout,
  type CardCheckoutPayload,
  type RevolutOrder,
} from "@/lib/revolut";
import { getPaymentSessionByPaymentId, storeCardCheckoutSession } from "@/lib/frasers-plus-merchant-state";
import { getCheckoutQuote, requireExpectedTotal } from "@/lib/checkout-pricing";
import { checkoutErrorResponse, CheckoutRequestError, limitCheckoutRequests, readCheckoutJson, requireCheckoutAccess } from "@/lib/checkout-request";
import { tryReserveDedupeKey, releaseDedupeKey } from "@/lib/server-data";
import { createFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import {
  getEmailValidationMessage,
  getUkMobileValidationMessage,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";
import {
  buildSquarePaymentLinkPayload,
  createSquarePaymentLink,
  getSquareConfig,
  getSquareErrorMessage,
  isSquareCheckoutConfigured,
  parseSquarePaymentLinkResponse,
  shouldUseSquareCardCheckout,
} from "@/lib/square";
import { isSameOriginMutationRequest } from "@/lib/request-guards";

export async function POST(request: Request) {
  let reservedPaymentId: string | undefined;
  try {
    if (!isSameOriginMutationRequest(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await readCheckoutJson<CardCheckoutPayload>(request);
    requireCheckoutAccess(request, payload.paymentId);
    limitCheckoutRequests(`payment:${payload.paymentId}`, 12);
    const normalizedEmail = normaliseEmailInput(payload.email);
    const emailValidationMessage = getEmailValidationMessage(normalizedEmail);
    const normalizedPhone = normaliseUkMobileInput(payload.phone);
    const phoneValidationMessage = getUkMobileValidationMessage(normalizedPhone);

    if (!payload.paymentId || !payload.email || !payload.phone || !payload.charger?.name || payload.total <= 0) {
      return NextResponse.json(
        { error: "Missing the details needed to create card checkout." },
        { status: 400 },
      );
    }

    if (emailValidationMessage) {
      return NextResponse.json({ error: emailValidationMessage }, { status: 400 });
    }

    if (phoneValidationMessage) {
      return NextResponse.json({ error: phoneValidationMessage }, { status: 400 });
    }

    const quote = await getCheckoutQuote(payload.charger?.slug, payload.discountCode);
    if (quote.invalidVoucher) throw new CheckoutRequestError("This voucher is not valid for this order.", 409);
    requireExpectedTotal(quote.total, payload.total);
    payload.charger = { slug: quote.charger.slug, name: quote.charger.name, hardwarePrice: quote.charger.unitPrice, installPrice: quote.charger.installedPrice };
    payload.email = normalizedEmail;
    payload.phone = normalizedPhone;
    payload.surveyAdjustment = 0;
    payload.totalBeforeDiscount = quote.totalBeforeDiscount;
    payload.discountAmount = quote.discountAmount;
    payload.discountCode = quote.discountCode;
    payload.discountLabel = quote.discountLabel;
    payload.total = quote.total;

    if (!await tryReserveDedupeKey("checkout-creation", payload.paymentId)) throw new CheckoutRequestError("Your checkout is already being prepared. Please wait a moment.", 409);
    reservedPaymentId = payload.paymentId;
    const existing = await getPaymentSessionByPaymentId(payload.paymentId);
    if (existing) {
      if (existing.provider === "CARD" && ["PENDING", "CREATED", "NEW"].includes(existing.latestStatus?.status?.toUpperCase() || "PENDING") && existing.redirectUrl && existing.amount === quote.total) {
        return NextResponse.json({ id: existing.providerPaymentReference, url: existing.redirectUrl, status: "Secure card checkout ready." });
      }
      throw new CheckoutRequestError("This payment attempt is already recorded. Please reopen your secure order link or start a fresh attempt.", 409);
    }

    const origin = new URL(request.url).origin;
    const { currency } = getRevolutConfig();
    const useSquare = shouldUseSquareCardCheckout();
    const useMock = !useSquare && shouldUseMockRevolutCheckout();

    if (useSquare) {
      if (!isSquareCheckoutConfigured()) {
        return NextResponse.json(
          { error: "Square checkout is selected but Square credentials are not configured." },
          { status: 500 },
        );
      }

      const { response, data } = await createSquarePaymentLink(
        buildSquarePaymentLinkPayload(payload, origin),
      );

      if (!response.ok) {
        return NextResponse.json(
          {
            error: getSquareErrorMessage(
              data,
              "Unable to create the Square-hosted checkout page.",
            ),
          },
          { status: response.status || 500 },
        );
      }

      const checkout = parseSquarePaymentLinkResponse(data);
      if (!checkout) {
        return NextResponse.json(
          { error: "Square did not return a hosted checkout URL." },
          { status: 502 },
        );
      }

      await storeCardCheckoutSession({
        paymentId: payload.paymentId,
        cardProcessor: "SQUARE",
        providerPaymentReference: checkout.orderId,
        redirectUrl: checkout.url,
        customerId: payload.customerId,
        customerName: `${payload.firstName} ${payload.lastName}`.trim(),
        customerEmail: payload.email,
        customerPhone: payload.phone,
        chargerName: payload.charger.name,
        chargerSlug: payload.charger.slug,
        amount: payload.total,
        currency: getSquareConfig().currency,
        hardwarePrice: payload.charger.hardwarePrice,
        installPrice: payload.charger.installPrice,
        surveyAdjustment: payload.surveyAdjustment,
        discountAmount: payload.discountAmount,
        discountCode: payload.discountCode,
        discountLabel: payload.discountLabel,
        totalBeforeDiscount: payload.totalBeforeDiscount,
        propertyType: payload.propertyType ?? undefined,
        parkingType: payload.parkingType ?? undefined,
        fuseBoxDistance: payload.fuseBoxDistance ?? undefined,
        billingAddress: payload.billingAddress,
        deliveryAddress: payload.deliveryAddress,
      });

      return NextResponse.json({
        id: checkout.orderId,
        url: checkout.url,
        status: "Square-hosted checkout ready.",
      });
    }

    if (useMock) {
      const mockOrderId = `mock_revolut_${Date.now()}`;
      const returnToken = createFrasersPlusReturnToken(payload.paymentId);
      const mockUrl = `${origin}/card/return?paymentId=${encodeURIComponent(payload.paymentId)}&order_id=${encodeURIComponent(mockOrderId)}&rt=${encodeURIComponent(returnToken)}&card_payment=success`;

      await storeCardCheckoutSession({
        paymentId: payload.paymentId,
        cardProcessor: "MOCK",
        providerPaymentReference: mockOrderId,
        redirectUrl: mockUrl,
        customerId: payload.customerId,
        customerName: `${payload.firstName} ${payload.lastName}`.trim(),
        customerEmail: payload.email,
        customerPhone: payload.phone,
        chargerName: payload.charger.name,
        chargerSlug: payload.charger.slug,
        amount: payload.total,
        currency: currency.toUpperCase(),
        hardwarePrice: payload.charger.hardwarePrice,
        installPrice: payload.charger.installPrice,
        surveyAdjustment: payload.surveyAdjustment,
        discountAmount: payload.discountAmount,
        discountCode: payload.discountCode,
        discountLabel: payload.discountLabel,
        totalBeforeDiscount: payload.totalBeforeDiscount,
        propertyType: payload.propertyType ?? undefined,
        parkingType: payload.parkingType ?? undefined,
        fuseBoxDistance: payload.fuseBoxDistance ?? undefined,
        billingAddress: payload.billingAddress,
        deliveryAddress: payload.deliveryAddress,
      });

      return NextResponse.json({
        id: mockOrderId,
        url: mockUrl,
        status: "Secure card checkout ready.",
      });
    }

    const { response, data } = await createRevolutOrder(
      buildRevolutOrderPayload(payload, origin),
    );

    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to create secure Revolut Business checkout.";

      return NextResponse.json({ error: detail }, { status: response.status || 500 });
    }

    const order = data as RevolutOrder;
    if (!order?.id || !order.checkout_url) {
      return NextResponse.json(
        { error: "Revolut did not return a hosted checkout URL." },
        { status: 502 },
      );
    }

    await storeCardCheckoutSession({
      paymentId: payload.paymentId,
      cardProcessor: "REVOLUT",
      providerPaymentReference: order.id,
      redirectUrl: order.checkout_url,
      customerId: payload.customerId,
      customerName: `${payload.firstName} ${payload.lastName}`.trim(),
      customerEmail: payload.email,
      customerPhone: payload.phone,
      chargerName: payload.charger.name,
      chargerSlug: payload.charger.slug,
      amount: payload.total,
      currency: currency.toUpperCase(),
      hardwarePrice: payload.charger.hardwarePrice,
      installPrice: payload.charger.installPrice,
      surveyAdjustment: payload.surveyAdjustment,
      discountAmount: payload.discountAmount,
      discountCode: payload.discountCode,
      discountLabel: payload.discountLabel,
      totalBeforeDiscount: payload.totalBeforeDiscount,
      propertyType: payload.propertyType ?? undefined,
      parkingType: payload.parkingType ?? undefined,
      fuseBoxDistance: payload.fuseBoxDistance ?? undefined,
      billingAddress: payload.billingAddress,
      deliveryAddress: payload.deliveryAddress,
    });

    return NextResponse.json({
      id: order.id,
      url: order.checkout_url,
      status: "Secure card checkout ready.",
    });
  } catch (error) {
    return checkoutErrorResponse(error);
  } finally {
    if (reservedPaymentId) await releaseDedupeKey("checkout-creation", reservedPaymentId);
  }
}
