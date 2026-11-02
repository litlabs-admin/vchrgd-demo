import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { CancelOrderRequestDialog } from "@/components/cancel-order-request-dialog";
import { PaymentPopupSubmitBridge } from "@/components/payment-popup-submit-bridge";
import {
  canCustomerRequestCancellation,
  canPayWorkflowBalance,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByToken,
  getResolvedWorkflowAmount,
  isSurveyReviewLinkExpired,
} from "@/lib/post-survey-workflows";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export default async function SurveyBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const workflow = await getPostSurveyWorkflowByToken(token);

  if (!workflow) {
    notFound();
  }

  const expired = isSurveyReviewLinkExpired(workflow);
  if (expired) {
    return <ClosedPaymentLinkPage />;
  }

  if (!canPayWorkflowBalance(workflow)) {
    redirect(`/survey-review/${encodeURIComponent(token)}`);
  }

  const canRequestCancellation = canCustomerRequestCancellation(workflow);
  const amountDue = getOutstandingWorkflowBalance(workflow);
  const finalAmount = getResolvedWorkflowAmount(workflow);
  const canUseFrasersPlus =
    workflow.provider === "FRASERS_PLUS" || workflow.paymentChoice === "frasers-plus";
  const originalPaymentLabel = canUseFrasersPlus ? "Already allocated" : "Already paid";
  const originalPaymentRouteLabel = canUseFrasersPlus ? "Frasers Plus" : "card payment";
  const state = typeof query.state === "string" ? query.state : "";
  const failedMethod = typeof query.method === "string" ? query.method : "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-10 text-slate-950">
      <PaymentPopupSubmitBridge />
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Revised installation total
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
            Review and pay the additional amount.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Your original quote was an estimate based on the first set of answers. After
            reviewing the detailed survey, the final installation total is higher. Only the
remaining balance is being requested below. Your existing installation arrangements remain unchanged.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <AmountCard label="Revised total" value={money.format(finalAmount)} />
            <AmountCard label={originalPaymentLabel} value={money.format(workflow.originalAmount)} />
            <AmountCard label="Balance left to pay" value={money.format(amountDue)} strong />
          </div>

          {expired ? (
            <Banner
              tone="warning"
              title="This payment link has expired."
              detail="Please contact VCHRGD and we will send you a fresh confirmation link."
            />
          ) : null}

          {state === "error" ? (
            <Banner
              tone="warning"
              title={`We could not start the ${failedMethod === "frasers-plus" ? "Frasers Plus" : "card"} top-up.`}
              detail="Please try again or contact VCHRGD if the issue continues."
            />
          ) : null}

          {workflow.topUpPaymentStatus === "FAILED" ? (
            <Banner
              tone="warning"
              title="Your previous top-up was not approved."
              detail={
                workflow.topUpFailureReason ||
                "You can choose another payment route below or cancel the order and request a refund."
              }
            />
          ) : null}

          {workflow.topUpPaymentStatus === "CANCELLED" ? (
            <Banner
              tone="muted"
              title="Your previous top-up was cancelled."
              detail="You can restart the payment below or cancel the order and request a refund."
            />
          ) : null}

          <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
              Your options
            </p>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              <li>The amount below is only for the remaining balance due on this order.</li>
              <li>Approval of the original amount does not guarantee approval of any Frasers Plus top-up amount.</li>
              <li>If you do not want to proceed, you can ask VCHRGD to cancel the order and review a refund or reversal of the full original amount instead.</li>
            </ul>
          </div>

          {!expired ? (
            <div className="mt-8 grid gap-4">
              {canUseFrasersPlus ? (
              <PaymentOptionCard
                title="Pay the additional amount with Frasers Plus"
                detail="Start a separate Frasers Plus top-up transaction for the balance only. This requires its own approval."
              >
                <form action="/api/survey-review/balance/complete" method="post" data-payment-popup-form="true">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="method" value="frasers-plus" />
                    <button
                      type="submit"
                      className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold text-white transition hover:bg-[#0f1116]"
                    >
                      Continue with Frasers Plus
                    </button>
                  </form>
                </PaymentOptionCard>
              ) : null}

              <PaymentOptionCard
                title="Pay the additional amount by card"
                detail="Continue to secure card checkout to pay only the outstanding balance now."
              >
                <form action="/api/survey-review/balance/complete" method="post" data-payment-popup-form="true">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="method" value="card" />
                  <button
                    type="submit"
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                  >
                    Review and pay by card
                  </button>
                </form>
              </PaymentOptionCard>

              {canRequestCancellation ? <PaymentOptionCard
                title="Cancel the order and request a refund"
                detail={`Ask VCHRGD to review a refund or reversal of the full original ${originalPaymentRouteLabel} amount instead of collecting the balance.`}
              >
                <CancelOrderRequestDialog
                  token={token}
                  originalAmount={workflow.originalAmount}
                  paymentRouteLabel={originalPaymentRouteLabel}
                  reason="Customer requested cancellation after survey review instead of paying the outstanding amended balance."
                />
              </PaymentOptionCard> : null}
            </div>
          ) : null}
        </section>

        <aside className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Updated summary
          </p>
          <div className="mt-5 grid gap-4">
            <Summary label="Customer" value={workflow.customerName || "Not available"} />
            <Summary label="Product" value={workflow.chargerName || "Not available"} />
            <Summary label="Original payment route" value={canUseFrasersPlus ? "Frasers Plus" : "Card"} />
            <Summary label="Revised total" value={money.format(finalAmount)} />
            <Summary label={originalPaymentLabel} value={money.format(workflow.originalAmount)} />
            <Summary label="Balance left to pay" value={money.format(amountDue)} strong />
            <Summary
              label="Top-up status"
              value={
                workflow.topUpPaymentStatus === "NONE"
                  ? "Waiting for payment choice"
                  : workflow.topUpPaymentStatus.replaceAll("_", " ")
              }
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function ClosedPaymentLinkPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto max-w-2xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
          Payment link closed
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
          This payment link is no longer active.
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The installation has been confirmed as complete, so payment and order actions are closed.
          If you need support, contact VCHRGD on{" "}
          <a className="font-semibold text-slate-950" href="tel:+441494370525">
            +44 1494 370525
          </a>{" "}
          or email{" "}
          <a className="font-semibold text-slate-950" href="mailto:sales@vchrgd.com">
            sales@vchrgd.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}

function AmountCard({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <strong
        className={`mt-3 block text-[clamp(1.75rem,4vw,2.6rem)] leading-none tracking-[-0.05em] ${
          strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}

function PaymentOptionCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5">
      <p className="text-lg font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-7 text-slate-600">{detail}</p>
      <div className="mt-5">{children}</div>
    </div>
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`m-0 text-right text-sm ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"}`}>
        {value}
      </dd>
    </div>
  );
}

function Banner({
  tone,
  title,
  detail,
}: {
  tone: "warning" | "muted";
  title: string;
  detail: string;
}) {
  return (
    <div
      className={`mt-6 rounded-[24px] border p-5 ${
        tone === "warning"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-7 text-slate-600">{detail}</p>
    </div>
  );
}
