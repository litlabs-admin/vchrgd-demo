import { NextResponse } from "next/server";
import { getCheckoutInteractionByPaymentId, upsertCheckoutInteraction } from "@/lib/checkout-interactions";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { isSameOriginMutationRequest } from "@/lib/request-guards";
import { checkoutErrorResponse, CheckoutRequestError, limitCheckoutRequests, readCheckoutJson, requireCheckoutAccess } from "@/lib/checkout-request";
import { getCheckoutQuote } from "@/lib/checkout-pricing";
import {
  getEmailValidationMessage,
  getUkMobileValidationMessage,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutationRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const payload = await readCheckoutJson<{
      checkoutToken?: string;
      discountCode?: string;
      paymentId?: string;
      lastStep?: number;
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
      status?: "ACTIVE" | "PAYMENT_PENDING" | "PAYMENT_COMPLETED" | "EXITED_SURVEY_LATER" | "ABANDONED";
      reason?: string;
      detailsSubmitted?: boolean;
    }>(request);
    requireCheckoutAccess(request, payload.paymentId, payload.checkoutToken);
    limitCheckoutRequests(`interaction:${payload.paymentId}`);

    if (!payload.paymentId || !Number.isInteger(payload.lastStep) || payload.lastStep! < 1 || payload.lastStep! > 6) {
      return NextResponse.json(
        { error: "Missing paymentId or lastStep for checkout interaction tracking." },
        { status: 400 },
      );
    }

    if (payload.status && !["ACTIVE", "PAYMENT_PENDING", "EXITED_SURVEY_LATER", "ABANDONED"].includes(payload.status)) throw new CheckoutRequestError("Invalid checkout status.");
    for (const [key, value] of Object.entries(payload)) {
      if (key === "checkoutToken") continue;
      if (!["lastStep", "total", "detailsSubmitted"].includes(key) && value !== null && value !== undefined && typeof value !== "string") throw new CheckoutRequestError("Invalid checkout details.");
      if (value !== null && value !== undefined && (typeof value === "object" || (typeof value === "string" && value.length > 1024))) throw new CheckoutRequestError("Invalid checkout details.");
    }
    if (payload.detailsSubmitted !== undefined && typeof payload.detailsSubmitted !== "boolean") throw new CheckoutRequestError("Invalid details flag.");
    const [session, existing] = await Promise.all([getPaymentSessionByPaymentId(payload.paymentId), getCheckoutInteractionByPaymentId(payload.paymentId)]);
    if (existing?.status === "PAYMENT_COMPLETED") return NextResponse.json({ ok: true, id: existing.id, status: existing.status });
    if (session) {
      const paid = ["COMPLETED", "CAPTURED", "AUTHORISED", "AUTHORIZED", "APPROVED"].includes(session.latestStatus?.status?.toUpperCase() || "");
      const interaction = await upsertCheckoutInteraction({
        paymentId: session.paymentId, lastStep: 6,
        status: paid ? "PAYMENT_COMPLETED" : payload.status || "PAYMENT_PENDING",
        reason: paid ? "Payment confirmed by the payment provider." : "Customer updated their checkout progress.",
        customerEmail: session.customerEmail, customerPhone: session.customerPhone,
        chargerName: session.chargerName, selectedSlug: session.chargerSlug,
        total: session.amount,
      });
      return NextResponse.json({ ok: true, id: interaction.id, status: interaction.status });
    }
    const quote = payload.selectedSlug ? await getCheckoutQuote(payload.selectedSlug, payload.discountCode) : null;

    const normalizedEmail = normaliseEmailInput(payload.customerEmail);
    const emailValidationMessage = payload.detailsSubmitted || normalizedEmail
      ? getEmailValidationMessage(normalizedEmail)
      : "";
    const normalizedPhone = normaliseUkMobileInput(payload.customerPhone);
    const phoneValidationMessage = payload.detailsSubmitted || normalizedPhone
      ? getUkMobileValidationMessage(normalizedPhone)
      : "";

    if (payload.detailsSubmitted && emailValidationMessage) {
      return NextResponse.json({ error: emailValidationMessage }, { status: 400 });
    }

    if (payload.detailsSubmitted && phoneValidationMessage) {
      return NextResponse.json({ error: phoneValidationMessage }, { status: 400 });
    }

    const interaction = await upsertCheckoutInteraction({
      paymentId: payload.paymentId,
      lastStep: payload.lastStep!,
      selectedSlug: payload.selectedSlug,
      chargerName: payload.chargerName,
      paymentChoice: payload.paymentChoice,
      propertyType: payload.propertyType,
      parkingType: payload.parkingType,
      fuseBoxDistance: payload.fuseBoxDistance,
      customerFirstName: payload.customerFirstName,
      customerLastName: payload.customerLastName,
      customerEmail: emailValidationMessage ? null : normalizedEmail || null,
      customerPhone: phoneValidationMessage ? null : normalizedPhone || null,
      billingLine1: payload.billingLine1,
      billingLine2: payload.billingLine2,
      billingCity: payload.billingCity,
      billingPostalCode: payload.billingPostalCode,
      billingCountry: payload.billingCountry,
      total: quote?.total,
      status: payload.status,
      reason: payload.status === "ABANDONED" ? "Customer left the checkout before completion." : "Customer updated their checkout progress.",
      detailsSubmitted: payload.detailsSubmitted,
    });

    return NextResponse.json({ ok: true, id: interaction.id, status: interaction.status });
  } catch (error) { return checkoutErrorResponse(error); }
}
