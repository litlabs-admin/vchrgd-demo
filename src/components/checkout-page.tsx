import { IntegrationShowcase } from "@/components/integration-showcase";
import { PaymentPopupReturnBridge } from "@/components/payment-popup-return-bridge";
import Image from "next/image";
import { CheckoutHero } from "@/components/checkout-hero";
import { Lock, Phone } from "lucide-react";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getCheckoutInteractionByPaymentId,
  type CheckoutInteraction,
} from "@/lib/checkout-interactions";
import { getFrasersPlusConfig } from "@/lib/frasers-plus";
import { getPaymentSessionByPaymentId, type PaymentSession } from "@/lib/frasers-plus-merchant-state";
import { getProductSettings } from "@/lib/product-settings";
import { createCheckoutAccess, checkoutResumePath, hasCheckoutResumeAccess } from "@/lib/checkout-access";
import { publicProductSettings } from "@/lib/checkout-pricing";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import { redirect } from "next/navigation";
import { preferredDatesEnabledForNewOrder, preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";
import { getPostSurveyWorkflowByPaymentId } from "@/lib/post-survey-workflows";

export type CheckoutSearchParams = Promise<{
    card_payment?: string | string[];
    paymentId?: string | string[];
    recovered?: string | string[];
    retry?: string | string[];
    resume?: string | string[];
    session_id?: string | string[];
    order_id?: string | string[];
    ct?: string;
    rt?: string;
    recovery?: string;
  }>;

function mapCheckoutInteractionToPaymentSession(
  interaction: CheckoutInteraction | null | undefined,
): PaymentSession | null {
  if (!interaction) {
    return null;
  }

  return {
    paymentId: interaction.paymentId,
    provider: interaction.paymentChoice === "frasers-plus" ? "FRASERS_PLUS" : "CARD",
    cardProcessor: interaction.paymentChoice === "card" ? "REVOLUT" : undefined,
    createdAt: interaction.startedAt,
    updatedAt: interaction.updatedAt,
    customerName:
      [interaction.customerFirstName, interaction.customerLastName].filter(Boolean).join(" ") ||
      undefined,
    customerEmail: interaction.customerEmail ?? undefined,
    customerPhone: interaction.customerPhone ?? undefined,
    chargerName: interaction.chargerName ?? undefined,
    chargerSlug: interaction.selectedSlug ?? undefined,
    amount: interaction.total,
    currency: "GBP",
    propertyType: interaction.propertyType ?? undefined,
    parkingType: interaction.parkingType ?? undefined,
    fuseBoxDistance: interaction.fuseBoxDistance ?? undefined,
    billingAddress: interaction.billingLine1
      ? {
          line1: interaction.billingLine1,
          line2: interaction.billingLine2 ?? undefined,
          city: interaction.billingCity ?? "",
          postalCode: interaction.billingPostalCode ?? "",
          country: interaction.billingCountry ?? "GB",
        }
      : undefined,
    latestStatus: {
      currentType: "CHECKOUT",
      status: interaction.status,
      source: "checkout",
      updatedAt: interaction.updatedAt,
    },
  };
}

// Shared by "/" and "/hero". The optional hero sits above an identical checkout.
export async function CheckoutPage({
  searchParams,
  hero = false,
}: {
  searchParams: CheckoutSearchParams;
  hero?: boolean;
}) {
  const params = await searchParams;
  const cardPaymentState = Array.isArray(params.card_payment)
    ? params.card_payment[0]
    : params.card_payment;
  const paymentId = Array.isArray(params.paymentId) ? params.paymentId[0] : params.paymentId;
  const recovered = Array.isArray(params.recovered) ? params.recovered[0] : params.recovered;
  const resume = Array.isArray(params.resume) ? params.resume[0] : params.resume;
  const retry = Array.isArray(params.retry) ? params.retry[0] : params.retry;
  const providerPaymentId = Array.isArray(params.order_id)
    ? params.order_id[0]
    : typeof params.order_id === "string"
      ? params.order_id
      : Array.isArray(params.session_id)
        ? params.session_id[0]
        : params.session_id;
  const showDemoControls =
    process.env.SHOW_DEMO_CONTROLS === "true" ||
    process.env.NEXT_PUBLIC_SHOW_DEMO_CONTROLS === "true";
  const showMerchantControls =
    showDemoControls &&
    (process.env.NODE_ENV !== "production" || (await isAdminAuthenticated()));
  const enableFrasersPlus =
    process.env.NEXT_PUBLIC_ENABLE_FRASERS_PLUS === "true" ||
    process.env.ENABLE_FRASERS_PLUS === "true";
  const showSandboxOutcomeTabs =
    showDemoControls && enableFrasersPlus && getFrasersPlusConfig().useMock;
  const productSettings = publicProductSettings(await getProductSettings());
  const canResume = Boolean(resume === "payment" && paymentId && (
    hasCheckoutResumeAccess(paymentId, {
      ct: typeof params.ct === "string" ? params.ct : undefined,
      rt: typeof params.rt === "string" ? params.rt : undefined,
      recovery: typeof params.recovery === "string" ? params.recovery : undefined,
    }) || await isAdminAuthenticated()
  ));
  // Legacy provider returns must use the verified return handler, never URL-asserted status.
  if (paymentId && cardPaymentState && typeof params.rt === "string" && verifyFrasersPlusReturnToken(paymentId, params.rt)) {
    const query = new URLSearchParams({ paymentId, rt: params.rt, card_payment: cardPaymentState });
    if (providerPaymentId) query.set("order_id", providerPaymentId);
    redirect(`/card/return?${query}`);
  }
  const resumePaymentSession =
    canResume && paymentId
      ? ((await getPaymentSessionByPaymentId(paymentId)) ??
        mapCheckoutInteractionToPaymentSession(
          await getCheckoutInteractionByPaymentId(paymentId),
        ))
      : null;
  const checkoutAccess = createCheckoutAccess(canResume && paymentId ? paymentId : undefined);
  const resumePaymentHref = canResume ? checkoutResumePath(checkoutAccess) : null;
  const resumeWorkflow = resumePaymentSession
    ? await getPostSurveyWorkflowByPaymentId(resumePaymentSession.paymentId)
    : null;
  const preferredDatesEnabled = resumeWorkflow
    ? preferredDatesEnabledForWorkflow(resumeWorkflow)
    : preferredDatesEnabledForNewOrder(resumePaymentSession?.createdAt);

  return (
    <main className="ck-root flex min-h-screen w-full flex-col bg-page">
      {hero ? (
        <CheckoutHero
          fromPrice={Math.min(...productSettings.chargers.map((item) => item.installedPrice))}
        />
      ) : (
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between gap-4 px-4 sm:h-16 sm:px-6 lg:px-8">
          <a href="https://www.vchrgd.com" className="flex items-center" aria-label="VCHRGD home">
            <Image
              src="/home-charging/assets/logo.png"
              alt="VCHRGD"
              width={146}
              height={32}
              priority
              className="h-6 w-auto invert"
            />
          </a>
          <p className="hidden items-center gap-2 text-sm text-muted sm:flex">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Secure checkout
          </p>
          <a
            href="tel:+441494370525"
            className="ck-press inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink hover:bg-tonal"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Need help?</span>
            <span className="ck-num">01494 370525</span>
          </a>
        </div>
      </header>
      )}

      <div className={`mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-4 pb-32 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16 ${hero ? "sm:pt-12" : ""}`}>
        {canResume && paymentId ? (
          <PaymentPopupReturnBridge
            paymentId={paymentId}
            status="CANCELLED"
            nextUrl={resumePaymentHref}
          />
        ) : null}
        {resume === "payment" && !canResume ? (
          <div className="mb-6 rounded-[20px] bg-white px-5 py-4 text-sm leading-6 text-ink-soft">
            To protect your details, please use the secure link in your email to reopen an existing order.
            You can start a new checkout below. Contact sales@vchrgd.com if you need help.
          </div>
        ) : null}
        <div id="checkout" className="scroll-mt-4">
        <IntegrationShowcase
          initialCheckoutAccess={checkoutAccess}
          preferredDatesEnabled={preferredDatesEnabled}
          showMerchantControls={showMerchantControls}
          enableFrasersPlus={enableFrasersPlus}
          showSandboxOutcomeTabs={showSandboxOutcomeTabs}
          resumePaymentSession={resumePaymentSession}
          resumePaymentId={canResume ? paymentId ?? null : null}
          forceFreshPaymentAttempt={
            canResume && (recovered === "1" || retry === "1")
          }
          productSettings={productSettings}
        />
        </div>
      </div>

      <footer className="border-t border-line bg-page pb-24 lg:pb-0">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 px-4 py-6 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>VCHRGD Technologies Limited. Payments are processed securely by Revolut or Frasers Plus.</p>
          <nav className="flex gap-4" aria-label="Legal">
            <a className="underline-offset-2 hover:underline" href="https://www.vchrgd.com/privacy-policy">Privacy policy</a>
            <a className="underline-offset-2 hover:underline" href="https://www.vchrgd.com/contact">Contact us</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
