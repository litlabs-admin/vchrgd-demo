"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerStatusLinkPanel } from "@/components/customer-status-link-panel";
import { PaymentPopupReturnBridge } from "@/components/payment-popup-return-bridge";
import { PreferredInstallationDatesPanel } from "@/components/preferred-installation-dates-panel";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";

type ReturnClientProps = {
  upr: string;
  paymentId: string;
  paymentResult: string;
  returnToken: string;
  session?: PaymentSession;
  isTopUpReturn?: boolean;
  originalAmount?: number;
  revisedAmount?: number;
  topUpAmount?: number;
  customerStatusHref?: string | null;
  preferredDateToken?: string | null;
  preferredDateWindowStart?: string | null;
  preferredInstallationDates?: string[];
};

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function resolveInitialFrasersStatus(paymentResult: string, session?: PaymentSession) {
  const sessionStatus = session?.latestStatus?.status;
  if (sessionStatus === "APPROVED" || sessionStatus === "COMPLETED" || sessionStatus === "DECLINED") {
    return sessionStatus;
  }

  if (paymentResult === "COMPLETED") {
    return "APPROVED";
  }

  if (paymentResult === "DECLINED") {
    return "DECLINED";
  }

  return "PENDING";
}

function getFrasersStatusMessage(status: string, isTopUpReturn: boolean) {
  if (isTopUpReturn) {
    return status === "APPROVED" || status === "COMPLETED"
      ? "The separate Frasers Plus top-up has been authorised for the amended installation amount. Your order can now move back into booking."
      : status === "DECLINED"
        ? "This Frasers Plus top-up was not approved. Your order has not moved forward. Return to your order overview to try again, choose card, or request cancellation."
        : "Your Frasers Plus top-up is still awaiting confirmation. Your order will stay on hold until the balance is approved.";
  }

  return status === "APPROVED" || status === "COMPLETED"
    ? "The transaction you have made via Frasers Plus has been approved. Please return your digital survey within 3 days so installation review can begin. If the survey is not returned in time, the order may be cancelled and the transaction made via Frasers Plus will be refunded."
    : status === "DECLINED"
      ? "The Frasers Plus application was not approved on this attempt."
      : "Your Frasers Plus request is still awaiting confirmation.";
}

function getReturnHeading(status: string, isTopUpReturn: boolean) {
  if (isTopUpReturn) {
    return status === "APPROVED" || status === "COMPLETED"
      ? "Your Frasers Plus top-up has been authorised."
      : status === "DECLINED"
        ? "Your Frasers Plus top-up was not approved."
        : "Your Frasers Plus top-up is still awaiting approval.";
  }

  return status === "APPROVED" || status === "COMPLETED"
    ? "Your Frasers Plus transaction has been approved."
    : status === "DECLINED"
      ? "Your Frasers Plus application was not approved."
      : "Your Frasers Plus request is still awaiting confirmation.";
}

export function ReturnClient({
  upr,
  paymentId,
  paymentResult,
  returnToken,
  session,
  isTopUpReturn = false,
  originalAmount,
  revisedAmount,
  topUpAmount,
  customerStatusHref,
  preferredDateToken,
  preferredDateWindowStart,
  preferredInstallationDates = [],
}: ReturnClientProps) {
  const initialResolvedStatus = resolveInitialFrasersStatus(paymentResult, session);
  const [status, setStatus] = useState(
    getFrasersStatusMessage(initialResolvedStatus, isTopUpReturn),
  );
  const [resolvedStatus, setResolvedStatus] = useState(initialResolvedStatus);
  const paymentChoiceHref = paymentId
    ? `/?resume=payment&paymentId=${encodeURIComponent(paymentId)}&rt=${encodeURIComponent(returnToken)}`
    : "/";

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function reconcile() {
      attempts += 1;
      const currentUpr = upr;

      if (!returnToken) {
        const standaloneStatus =
          paymentResult === "COMPLETED"
            ? "APPROVED"
            : paymentResult === "DECLINED"
              ? "DECLINED"
              : "PENDING";
        if (active) {
          setResolvedStatus(standaloneStatus);
          setStatus(getFrasersStatusMessage(standaloneStatus, isTopUpReturn));
        }
        return;
      }

      if (!currentUpr) {
        if (active) {
          setStatus("Waiting for payment confirmation.");
        }
        return;
      }

      try {
        const result = await fetch(
          `/api/frasers-plus/payment/${currentUpr}?paymentId=${encodeURIComponent(paymentId)}&rt=${encodeURIComponent(returnToken)}`,
          {
            headers: {
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
        );
        const data = await result.json();

        if (!active) {
          return;
        }

        const nextStatus = typeof data?.status === "string" ? data.status : "PENDING";
        setResolvedStatus(nextStatus);
        setStatus(getFrasersStatusMessage(nextStatus, isTopUpReturn));

        const shouldRetry = attempts < 5 && (nextStatus === "PENDING" || !data?.latestAuthorizationWebhook);
        if (shouldRetry) {
          retryTimer = setTimeout(() => {
            void reconcile();
          }, 2500);
        }
      } catch {
        if (active) {
          setStatus("We could not reconcile the Frasers Plus payment state just yet.");
        }
      }
    }

    void reconcile();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isTopUpReturn, paymentId, paymentResult, returnToken, upr]);

  const success = resolvedStatus === "APPROVED" || resolvedStatus === "COMPLETED";
  const declined = resolvedStatus === "DECLINED";

  return (
    <main className="fp-page px-4 py-6 text-slate-950 sm:py-10">
      <PaymentPopupReturnBridge paymentId={paymentId} status={resolvedStatus} />
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="fp-shell-card rounded-[24px] p-5 sm:rounded-[32px] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
              {success
                ? isTopUpReturn
                  ? "Additional payment confirmed"
                  : "Frasers Plus confirmation"
                : declined
                  ? isTopUpReturn
                    ? "Additional payment update"
                    : "Frasers Plus update"
                  : isTopUpReturn
                    ? "Additional payment status"
                    : "Frasers Plus status"}
            </p>
            <Image
              src="/content/frasersplus-stacked.png"
              alt="Frasers Plus"
              width={88}
              height={88}
              className="h-auto w-[88px] object-contain"
            />
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-[-0.05em] text-slate-950">
            {getReturnHeading(resolvedStatus, isTopUpReturn)}
          </h1>
          <p className="fp-text-muted mt-4 max-w-3xl text-base leading-7">{status}</p>

          <div className="fp-soft-card mt-8 rounded-[20px] p-5 sm:rounded-[24px] sm:p-6">
            <p className="text-sm text-slate-500">Order reference</p>
            <strong className="mt-3 block break-all text-[clamp(2rem,5vw,3.6rem)] font-bold leading-none tracking-[-0.06em] text-slate-950">
              {paymentId || "Waiting for order reference"}
            </strong>
          </div>

          <div className="fp-brand-card mt-8 rounded-[20px] border p-4 sm:rounded-[24px] sm:p-5">
            <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
              Important information
            </p>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-200">
              {success ? (
                <>
                  {isTopUpReturn ? (
                    <>
                      <li>The original quote was only an estimate and the final amount was updated after the digital survey review.</li>
                      <li>This extra amount is treated as a separate Frasers Plus transaction and requires its own approval.</li>
                      <li>If you no longer wish to proceed, return to your status page to cancel the order and request a refund of the original transaction.</li>
                    </>
                  ) : (
                    <>
                      <li>The transaction you have made via Frasers Plus has been approved.</li>
                      <li>If the digital survey is not received within 3 days, the order may be cancelled and the transaction made via Frasers Plus will be refunded.</li>
                      <li>Installation cost may still change if the digital survey shows that the site is non-standard or different to the answers provided.</li>
                      <li>If the final installation scope changes, VCHRGD will contact you with the revised total before proceeding.</li>
                    </>
                  )}
                </>
              ) : declined ? (
                <>
                  {isTopUpReturn ? (
                    <>
                      <li>This top-up attempt did not change your order or booking status.</li>
                      <li>Return to your order overview to try Frasers Plus again, pay the balance by card, or request cancellation.</li>
                      <li>Approval of the original amount does not guarantee approval of any top-up amount.</li>
                    </>
                  ) : (
                    <>
                      <li>This Frasers Plus application was not approved on this attempt.</li>
                      <li>You can return to VCHRGD and choose another payment option if you still want to proceed.</li>
                      <li>Your digital survey answers remain in place if you want to continue with a different payment route.</li>
                    </>
                  )}
                </>
              ) : (
                <>
                  {isTopUpReturn ? (
                    <>
                      <li>This top-up has not changed your order or booking status yet.</li>
                      <li>Return to your order overview if you want to try the payment again or choose another payment route.</li>
                      <li>The order will only move back into booking once the separate top-up is approved.</li>
                    </>
                  ) : (
                    <>
                      <li>Your Frasers Plus request is still awaiting confirmation.</li>
                      <li>You may need to complete the hosted Frasers Plus flow before VCHRGD can see a final authorisation outcome.</li>
                      <li>If the transaction is later authorised, the order will still remain subject to survey completion and review.</li>
                    </>
                  )}
                </>
              )}
            </ul>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={
                customerStatusHref && isTopUpReturn
                  ? customerStatusHref
                  : success
                    ? customerStatusHref ?? "https://www.vchrgd.com"
                    : paymentChoiceHref
              }
              className="fp-primary-btn inline-flex min-h-12 w-full items-center justify-center rounded-full px-6 text-sm font-semibold !text-white no-underline transition sm:w-auto"
            >
              <span className="whitespace-nowrap">
                {isTopUpReturn
                  ? success
                    ? "Return to your status page"
                    : "Return to order overview"
                  : success
                    ? customerStatusHref
                      ? "View your order status"
                      : "Return to VCHRGD"
                    : "Choose another payment option"}
              </span>
            </Link>
          </div>

          {success && !isTopUpReturn && preferredDateToken && preferredDateWindowStart ? (
            <PreferredInstallationDatesPanel
              token={preferredDateToken}
              minimumDate={preferredDateWindowStart}
              initialDates={preferredInstallationDates}
              tone="dark"
            />
          ) : null}

          {customerStatusHref ? (
            <CustomerStatusLinkPanel href={customerStatusHref} tone="dark" />
          ) : null}
        </section>

        <aside className="fp-shell-card rounded-[24px] p-5 text-slate-950 sm:rounded-[32px] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
              Order summary
            </p>
            <Image
              src="/content/frasersplus-stacked.png"
              alt="Frasers Plus"
              width={88}
              height={88}
              className="h-auto w-[88px] object-contain"
            />
          </div>
          <div className="mt-5 grid gap-4">
            <Summary label="Customer" value={session?.customerName || "Not available"} />
            <Summary label="Email" value={session?.customerEmail || "Not available"} />
            <Summary label="Product" value={session?.chargerName || "Not available"} />
            {isTopUpReturn ? (
              <>
                <Summary label="Original estimate" value={money.format(originalAmount ?? 0)} />
                <Summary label="Revised total" value={money.format(revisedAmount ?? originalAmount ?? 0)} />
                <Summary label="Additional amount" value={money.format(topUpAmount ?? 0)} strong />
              </>
            ) : (
              <Summary label="Total estimate" value={money.format(session?.amount ?? 0)} strong />
            )}
            <Summary
              label="Payment status"
              value={
                success
                  ? "Approved"
                  : declined
                    ? "Not approved"
                    : "Awaiting confirmation"
              }
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function Summary({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="fp-summary-row grid gap-1 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`m-0 text-sm sm:text-right ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"}`}>
        {value}
      </dd>
    </div>
  );
}
