"use client";

import dynamic from "next/dynamic";
import type { ProductSettings } from "@/lib/product-settings";
import type { CheckoutAccess } from "@/lib/checkout-access";

const IntegrationShowcaseClient = dynamic(
  () =>
    import("@/components/integration-showcase").then((module) => ({
      default: module.IntegrationShowcase,
    })),
  {
    ssr: false,
    loading: () => (
      <section className="grid gap-6 py-6 sm:gap-10 sm:py-10">
        <div className="border-b border-slate-200/80 pb-8">
          <div className="h-7 w-44 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-4 h-12 w-full max-w-[680px] animate-pulse rounded-[24px] bg-slate-100" />
          <div className="mt-3 h-6 w-full max-w-[540px] animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.75fr)_380px]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="h-6 w-32 animate-pulse rounded-full bg-slate-100" />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="h-[280px] animate-pulse rounded-[24px] bg-slate-100" />
              <div className="h-[280px] animate-pulse rounded-[24px] bg-slate-100" />
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="h-6 w-36 animate-pulse rounded-full bg-slate-100" />
            <div className="mt-5 h-[420px] animate-pulse rounded-[24px] bg-slate-100" />
          </div>
        </div>
      </section>
    ),
  },
);

type ResumePaymentSession = {
  paymentId: string;
  uniquePaymentReference?: string;
  redirectUrl?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  amount?: number;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  deliveryAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  latestStatus?: {
    currentType?: string;
    status: string;
  };
};

export function IntegrationShowcaseShell({
  initialCheckoutAccess,
  showMerchantControls = false,
  resumePaymentSession = null,
  forceFreshPaymentAttempt = false,
  productSettings,
}: {
  initialCheckoutAccess: CheckoutAccess;
  showMerchantControls?: boolean;
  resumePaymentSession?: ResumePaymentSession | null;
  forceFreshPaymentAttempt?: boolean;
  productSettings?: ProductSettings;
}) {
  return (
    <IntegrationShowcaseClient
      initialCheckoutAccess={initialCheckoutAccess}
      showMerchantControls={showMerchantControls}
      resumePaymentSession={resumePaymentSession}
      forceFreshPaymentAttempt={forceFreshPaymentAttempt}
      productSettings={productSettings}
    />
  );
}
