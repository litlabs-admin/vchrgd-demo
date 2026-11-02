import { NextResponse } from "next/server";
import { getAdminSession, isSuperAdminUsername } from "@/lib/admin-auth";
import { renderCheckoutRecoveryEmail } from "@/lib/checkout-recovery-email";
import { createCheckoutRecoveryToken } from "@/lib/checkout-recovery-token";
import { isGmailSenderConfigured, sendGmailMessage } from "@/lib/gmail-sender";
import {
  recordAdminAuditEvent,
  storeCardCheckoutSession,
} from "@/lib/frasers-plus-merchant-state";
import { getCustomerAppUrl } from "@/lib/app-url";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";
import { renderAdditionalCostsEmail } from "@/lib/additional-costs-email";

function redirectToPreview(
  request: Request,
  options: {
    template?: string;
    stage?: string;
    state?: string;
    error?: string;
  } = {},
) {
  const fallback = new URL("/backoffice/email-preview", request.url);
  if (options.template === "additional-costs") {
    fallback.searchParams.set("template", "additional-costs");
  } else if (options.stage) {
    fallback.searchParams.set("stage", options.stage);
  }
  if (options.state) {
    fallback.searchParams.set("emailState", options.state);
  }
  if (options.error) {
    fallback.searchParams.set("emailError", options.error);
  }

  return NextResponse.redirect(
    getSafeInternalRedirect(request, null, fallback.pathname + fallback.search),
    303,
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  if (!session) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  if (!(await isSuperAdminUsername(session.sub))) {
    return redirectToPreview(request, {
      error: "Only the super admin can send test emails.",
    });
  }

  const formData = await request.formData();
  const to = String(formData.get("to") || "").trim();
  const stage = String(formData.get("stage") || "") === "72h" ? "72h" : "24h";
  const template =
    String(formData.get("template") || "") === "additional-costs"
      ? "additional-costs"
      : "checkout-recovery";

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return redirectToPreview(request, {
      template,
      stage,
      error: "Enter a valid test recipient email.",
    });
  }

  if (!isGmailSenderConfigured()) {
    return redirectToPreview(request, {
      template,
      stage,
      error: "Gmail sender configuration is incomplete.",
    });
  }

  const samplePaymentId = "VCHRGD-EMAIL-TEST-CHECKOUT";
  const origin = getCustomerAppUrl(request.url);

  let email: ReturnType<typeof renderCheckoutRecoveryEmail>;
  if (template === "additional-costs") {
    const progressLink = `${origin}/survey-review/vchrgd-additional-costs-email-preview`;
    email = renderAdditionalCostsEmail({
      firstName: "Anthony",
      customerName: "Anthony Mumford",
      chargerName: "Seven Pro Tethered",
      installationPostcode: "EH21 8TP",
      orderReference: "VCHRGD-1786530633351-2293",
      originalAmount: 935,
      revisedTotal: 1181,
      alreadyPaid: 935,
      balanceDue: 246,
      additionalCostLines: [
        { label: "Additional labour", amount: 125 },
        { label: "Additional cable", amount: 75 },
        { label: "Sundries", amount: 5 },
        { label: "VAT", amount: 41 },
      ],
      explanation:
        "Your survey shows that the cable route and installation work required are outside the standard installation allowance. The revised cost covers the extra labour, cable and sundries needed to complete the work.",
      progressLink,
      paymentLink: `${progressLink}/pay-balance`,
      brandLogoUrl: `${origin}/content/vchrgd-email-logo.png`,
    });
  } else {
    await storeCardCheckoutSession({
      paymentId: samplePaymentId,
      cardProcessor: "SQUARE",
      providerPaymentReference: "email-preview-dummy-square-order",
      redirectUrl: `${origin}/checkout/recover/${createCheckoutRecoveryToken(samplePaymentId)}`,
      customerId: "email-preview-dummy-customer",
      customerName: "Alexander Watson",
      customerEmail: to,
      customerPhone: "07123456789",
      chargerName: "Seven Pro Untethered",
      chargerSlug: "seven-pro-untethered",
      amount: 875,
      currency: "GBP",
      hardwarePrice: 435,
      installPrice: 440,
      surveyAdjustment: 0,
      discountAmount: 0,
      totalBeforeDiscount: 875,
      propertyType: "House",
      parkingType: "Driveway",
      fuseBoxDistance: "Up to 10m",
      billingAddress: {
        line1: "1A Eghams Court",
        city: "Bourne End",
        postalCode: "SL8 5YS",
        country: "GB",
      },
      deliveryAddress: {
        line1: "1A Eghams Court",
        city: "Bourne End",
        postalCode: "SL8 5YS",
        country: "GB",
      },
    });

    email = renderCheckoutRecoveryEmail({
      stage,
      firstName: "Alexander",
      customerName: "Alexander Watson",
      chargerName: "Seven Pro Untethered",
      totalAmount: "£875.00",
      postcode: "SL8 5YS",
      orderReference: samplePaymentId,
      recoveryLink: `${origin}/checkout/recover/${createCheckoutRecoveryToken(samplePaymentId)}`,
      expiresAtLabel: "Friday 24 July 2026 at 14:30",
      brandLogoUrl: `${origin}/content/vchrgd-email-logo.png`,
    });
  }

  try {
    const oidcToken = request.headers.get("x-vercel-oidc-token");
    const result = await sendGmailMessage({
      to,
      subject: `[TEST] ${email.subject}`,
      html: email.html,
      text: email.text,
      oidcToken,
    });

    await recordAdminAuditEvent({
      action: "email.preview_test_sent",
      actor: session.sub,
      detail: `${template === "additional-costs" ? "Additional costs" : `Checkout recovery ${stage}`} test email sent to ${to}. Gmail message ${result.id || "unknown"}.`,
    });

    return redirectToPreview(request, {
      template,
      stage,
      state: `sent:${template === "additional-costs" ? "additional-costs" : stage}`,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to send the test email.";

    await recordAdminAuditEvent({
      action: "email.preview_test_failed",
      actor: session.sub,
      detail: message,
    });

    return redirectToPreview(request, {
      template,
      stage,
      error: message,
    });
  }
}
