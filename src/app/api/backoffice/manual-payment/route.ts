import { NextResponse } from "next/server";
import {
  getCheckoutInteractionByPaymentId,
  upsertCheckoutInteraction,
} from "@/lib/checkout-interactions";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getEmailValidationMessage,
  getUkMobileValidationMessage,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";
import {
  recordAdminAuditEvent,
  storeManualCardPaymentSession,
} from "@/lib/frasers-plus-merchant-state";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";
import {
  ensureJumptechProjectForOriginalPayment,
  syncWorkflowStateFromCurrentData,
} from "@/lib/workflow-sync";

type ManualAddressInput = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

const CHARGER_NAMES_BY_SLUG: Record<string, string> = {
  "seven-pro-tethered": "Seven Pro Tethered",
  "seven-pro-untethered": "Seven Pro Untethered",
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseAmount(value: string) {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : NaN;
}

function buildManualPaymentId(sourcePaymentId: string) {
  if (sourcePaymentId) {
    return sourcePaymentId;
  }

  return `VCHRGD-MANUAL-${Date.now()}`;
}

function requireAddress(address: ManualAddressInput) {
  return Boolean(address.line1 && address.city && address.postalCode && address.country);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  const formData = await request.formData();
  const returnTo = clean(formData.get("returnTo"));
  const sourcePaymentId = clean(formData.get("sourcePaymentId"));
  const sourceInteraction = sourcePaymentId
    ? await getCheckoutInteractionByPaymentId(sourcePaymentId)
    : undefined;

  const firstName = clean(formData.get("customerFirstName")) || sourceInteraction?.customerFirstName || "";
  const lastName = clean(formData.get("customerLastName")) || sourceInteraction?.customerLastName || "";
  const customerName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const customerEmail = normaliseEmailInput(
    clean(formData.get("customerEmail")) || sourceInteraction?.customerEmail,
  );
  const customerPhone = normaliseUkMobileInput(
    clean(formData.get("customerPhone")) || sourceInteraction?.customerPhone,
  );
  const chargerSlug = clean(formData.get("chargerSlug")) || sourceInteraction?.selectedSlug || "";
  const chargerName =
    clean(formData.get("chargerName")) ||
    sourceInteraction?.chargerName ||
    CHARGER_NAMES_BY_SLUG[chargerSlug] ||
    "";
  const amount = parseAmount(clean(formData.get("amount")) || String(sourceInteraction?.total ?? ""));
  const paymentId = buildManualPaymentId(sourcePaymentId || clean(formData.get("paymentId")));
  const providerPaymentReference =
    clean(formData.get("manualReference")) || `manual:${paymentId}`;
  const billingAddress: ManualAddressInput = {
    line1: clean(formData.get("billingLine1")) || sourceInteraction?.billingLine1 || "",
    line2: clean(formData.get("billingLine2")) || sourceInteraction?.billingLine2 || "",
    city: clean(formData.get("billingCity")) || sourceInteraction?.billingCity || "",
    postalCode: clean(formData.get("billingPostalCode")) || sourceInteraction?.billingPostalCode || "",
    country: clean(formData.get("billingCountry")) || sourceInteraction?.billingCountry || "GB",
  };

  const emailError = getEmailValidationMessage(customerEmail);
  const phoneError = getUkMobileValidationMessage(customerPhone);
  const errors = [
    !customerName ? "Customer name is required." : "",
    emailError,
    phoneError,
    !chargerName ? "Selected charger is required." : "",
    !Number.isFinite(amount) || amount <= 0 ? "Paid amount must be greater than zero." : "",
    !requireAddress(billingAddress) ? "Installation address, town/city, postcode and country are required." : "",
  ].filter(Boolean);

  if (errors.length) {
    const url = getSafeInternalRedirect(request, returnTo, "/backoffice?tab=journey");
    url.searchParams.set("manualPaymentError", errors.join(" "));
    return NextResponse.redirect(url, 303);
  }

  await storeManualCardPaymentSession({
    paymentId,
    providerPaymentReference,
    customerName,
    customerEmail,
    customerPhone,
    chargerName,
    chargerSlug,
    amount,
    currency: "GBP",
    propertyType: clean(formData.get("propertyType")) || sourceInteraction?.propertyType || undefined,
    parkingType: clean(formData.get("parkingType")) || sourceInteraction?.parkingType || undefined,
    fuseBoxDistance: clean(formData.get("fuseBoxDistance")) || sourceInteraction?.fuseBoxDistance || undefined,
    billingAddress,
    deliveryAddress: billingAddress,
    actor: "backoffice-admin",
  });

  await upsertCheckoutInteraction({
    paymentId,
    lastStep: Math.max(sourceInteraction?.lastStep ?? 6, 6),
    selectedSlug: chargerSlug || null,
    chargerName,
    paymentChoice: "card",
    propertyType: clean(formData.get("propertyType")) || sourceInteraction?.propertyType || null,
    parkingType: clean(formData.get("parkingType")) || sourceInteraction?.parkingType || null,
    fuseBoxDistance: clean(formData.get("fuseBoxDistance")) || sourceInteraction?.fuseBoxDistance || null,
    customerFirstName: firstName || null,
    customerLastName: lastName || null,
    customerEmail,
    customerPhone,
    billingLine1: billingAddress.line1,
    billingLine2: billingAddress.line2 || null,
    billingCity: billingAddress.city,
    billingPostalCode: billingAddress.postalCode,
    billingCountry: billingAddress.country,
    total: amount,
    status: "PAYMENT_COMPLETED",
    reason: `Manual payment recorded by back office (${providerPaymentReference}).`,
    detailsSubmitted: true,
  });

  await syncWorkflowStateFromCurrentData();
  await ensureJumptechProjectForOriginalPayment(paymentId);
  await recordAdminAuditEvent({
    action: "backoffice.manual_payment.completed",
    actor: "backoffice-admin",
    detail: `Manual paid customer ${customerName} recorded against ${paymentId}.`,
  });

  return NextResponse.redirect(
    getSafeInternalRedirect(request, returnTo, "/backoffice?tab=journey"),
    303,
  );
}
