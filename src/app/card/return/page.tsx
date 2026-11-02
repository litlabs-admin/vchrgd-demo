import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { CustomerStatusLinkPanel } from "@/components/customer-status-link-panel";
import { PaymentPopupReturnBridge } from "@/components/payment-popup-return-bridge";
import { PreferredInstallationDatesPanel } from "@/components/preferred-installation-dates-panel";
import { preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import {
  completeSurveyWorkflowTopUp,
  failSurveyWorkflowTopUp,
  getPostSurveyWorkflowByPaymentId,
  getOutstandingWorkflowBalance,
  getPreferredInstallationWindowStart,
} from "@/lib/post-survey-workflows";
import { updateCardCheckoutStatus } from "@/lib/frasers-plus-merchant-state";
import {
  deriveRevolutCardStatus,
  retrieveRevolutOrder,
  shouldUseMockRevolutCheckout,
} from "@/lib/revolut";
import { resolveSquareOrderPaymentStatus } from "@/lib/square";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import {
  ensureJumptechProjectForOriginalPayment,
  markJumptechQuoteApprovedForWorkflow,
  syncWorkflowStateFromCurrentData,
} from "@/lib/workflow-sync";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function runAfterResponse(taskName: string, task: () => Promise<void>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.warn(
        error instanceof Error
          ? `${taskName} failed: ${error.message}`
          : `${taskName} failed.`,
      );
    }
  });
}

function isSuccessfulCardStatus(status: string) {
  return status === "AUTHORISED" || status === "COMPLETED";
}

function isPendingCardStatus(status: string) {
  return status === "PROCESSING" || status === "PENDING" || status === "RETURNED";
}

function getSquareReturnInteractionStatus(status: string) {
  if (isSuccessfulCardStatus(status)) {
    return "PAYMENT_COMPLETED";
  }

  if (status === "CANCELLED" || status === "EXPIRED") {
    return "ABANDONED";
  }

  // Square hosted checkout can report a failed card attempt while the customer
  // can still retry within the same checkout order.
  return "PAYMENT_PENDING";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSquareOrderPaymentStatusForReturn(
  providerPaymentReference: string,
) {
  let result = await resolveSquareOrderPaymentStatus(providerPaymentReference);

  for (const delay of [750, 1500, 2500] as const) {
    if (result.response.ok && !isPendingCardStatus(result.status)) {
      return result;
    }

    await wait(delay);
    result = await resolveSquareOrderPaymentStatus(providerPaymentReference);
  }

  return result;
}

async function resolveRevolutOrderForReturn(providerPaymentReference: string) {
  let result = await retrieveRevolutOrder(providerPaymentReference);

  for (const delay of [750, 1500, 2500] as const) {
    const status =
      result.response.ok && result.data && typeof result.data === "object"
        ? deriveRevolutCardStatus(result.data)
        : "PENDING";

    if (result.response.ok && status !== "AUTHORISED" && !isPendingCardStatus(status)) {
      return { ...result, status };
    }

    await wait(delay);
    result = await retrieveRevolutOrder(providerPaymentReference);
  }

  return {
    ...result,
    status:
      result.response.ok && result.data && typeof result.data === "object"
        ? deriveRevolutCardStatus(result.data)
        : "PENDING",
  };
}

export default async function CardReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const paymentId = typeof params.paymentId === "string" ? params.paymentId : "";
  const cardPaymentState = typeof params.card_payment === "string" ? params.card_payment : "success";
  const orderId =
    typeof params.order_id === "string"
      ? params.order_id
      : typeof params.payment_id === "string"
        ? params.payment_id
      : typeof params.orderId === "string"
        ? params.orderId
      : typeof params.session_id === "string"
        ? params.session_id
      : "";
  const returnToken = typeof params.rt === "string" ? params.rt : "";

  if (!paymentId) {
    redirect("/");
  }

  const session = await getPaymentSessionByPaymentId(paymentId);
  if (!session) {
    redirect("/");
  }

  if (
    process.env.NODE_ENV === "production" &&
    !verifyFrasersPlusReturnToken(paymentId, returnToken)
  ) {
    redirect("/");
  }

  if (
    returnToken &&
    !verifyFrasersPlusReturnToken(paymentId, returnToken)
  ) {
    redirect("/");
  }

  let resolvedStatus: string = "PENDING";
  if (session.latestStatus?.status === "REFUNDED") {
    const refundedWorkflow = await getPostSurveyWorkflowByPaymentId(paymentId);
    redirect(refundedWorkflow?.reviewToken ? `/survey-review/${encodeURIComponent(refundedWorkflow.reviewToken)}` : "/");
  }
  const cardProcessor =
    session.cardProcessor ??
    (shouldUseMockRevolutCheckout() ? "MOCK" : "REVOLUT");

  if (cardPaymentState === "cancelled") {
    resolvedStatus = "CANCELLED";
    await updateCardCheckoutStatus({
      paymentId,
      providerPaymentReference:
        orderId || session.providerPaymentReference || session.stripeSessionId,
      status: resolvedStatus,
    });
    await updateCheckoutInteractionStatus(
      paymentId,
      "ABANDONED",
      "Customer cancelled the secure card checkout before authorisation completed.",
    );
  } else if (cardProcessor === "SQUARE" && (session.providerPaymentReference || orderId)) {
    try {
      const providerPaymentReference =
        session.providerPaymentReference || orderId;
      if (!providerPaymentReference) {
        redirect("/");
      }
      const result = await resolveSquareOrderPaymentStatusForReturn(providerPaymentReference);
      resolvedStatus = result.response.ok ? result.status : "RETURNED";
      await updateCardCheckoutStatus({
        paymentId,
        // Preserve the Square order ID as the stable session reference. Square
        // can emit separate payment IDs for failed/retried card attempts.
        providerPaymentReference,
        status: resolvedStatus,
      });
      await updateCheckoutInteractionStatus(
        paymentId,
        getSquareReturnInteractionStatus(resolvedStatus),
        isSuccessfulCardStatus(resolvedStatus)
          ? "Customer completed the secure card checkout flow."
          : isPendingCardStatus(resolvedStatus)
            ? "Customer returned from secure card checkout and payment is pending confirmation."
            : resolvedStatus === "CANCELLED"
              ? "Customer cancelled the secure card checkout before authorisation completed."
              : resolvedStatus === "EXPIRED"
                ? "Secure card checkout expired before authorisation completed."
                : "Secure card checkout reported a failed attempt and remains available for retry.",
      );
    } catch {
      resolvedStatus = "RETURNED";
      await updateCardCheckoutStatus({
        paymentId,
        providerPaymentReference:
          session.providerPaymentReference || session.stripeSessionId || orderId,
        status: resolvedStatus,
      });
      await updateCheckoutInteractionStatus(
        paymentId,
        "PAYMENT_PENDING",
        "Customer returned from secure card checkout and payment is pending confirmation.",
      );
    }
  } else if (cardProcessor === "REVOLUT" && (session.providerPaymentReference || session.stripeSessionId)) {
    try {
      const providerPaymentReference =
        session.providerPaymentReference || session.stripeSessionId;
      if (!providerPaymentReference) {
        redirect("/");
      }
      const { response, status } = await resolveRevolutOrderForReturn(
        providerPaymentReference,
      );
      if (response.ok) {
        resolvedStatus = status;
        await updateCardCheckoutStatus({
          paymentId,
          providerPaymentReference,
          status: resolvedStatus,
        });
        await updateCheckoutInteractionStatus(
          paymentId,
          resolvedStatus === "COMPLETED"
            ? "PAYMENT_COMPLETED"
            : resolvedStatus === "AUTHORISED" ||
                resolvedStatus === "PROCESSING" ||
                resolvedStatus === "PENDING"
              ? "PAYMENT_PENDING"
              : "ABANDONED",
          resolvedStatus === "COMPLETED"
            ? "Revolut confirmed the card payment was captured."
            : resolvedStatus === "AUTHORISED" ||
                resolvedStatus === "PROCESSING" ||
                resolvedStatus === "PENDING"
              ? "Customer returned from secure card checkout and payment capture is pending confirmation."
              : resolvedStatus === "CANCELLED"
                ? "Customer cancelled the secure card checkout before authorisation completed."
                : "Secure card checkout returned a failed or declined payment result.",
        );
      } else {
        resolvedStatus = "RETURNED";
        await updateCardCheckoutStatus({
          paymentId,
          providerPaymentReference,
          status: resolvedStatus,
        });
        await updateCheckoutInteractionStatus(
          paymentId,
          "PAYMENT_PENDING",
          "Customer returned from secure card checkout and authorisation is pending confirmation.",
        );
      }
    } catch {
      resolvedStatus = "RETURNED";
      await updateCardCheckoutStatus({
        paymentId,
        providerPaymentReference:
          session.providerPaymentReference || session.stripeSessionId,
        status: resolvedStatus,
      });
      await updateCheckoutInteractionStatus(
        paymentId,
        "PAYMENT_PENDING",
        "Customer returned from secure card checkout and authorisation is pending confirmation.",
      );
    }
  } else if (cardPaymentState !== "cancelled") {
    resolvedStatus = "AUTHORISED";
    await updateCardCheckoutStatus({
      paymentId,
      providerPaymentReference:
        orderId || session.providerPaymentReference || session.stripeSessionId,
      status: resolvedStatus,
    });
    await updateCheckoutInteractionStatus(
      paymentId,
      "PAYMENT_COMPLETED",
      "Customer completed the secure card checkout flow.",
    );
  }

  const success =
    cardProcessor === "REVOLUT"
      ? resolvedStatus === "COMPLETED"
      : isSuccessfulCardStatus(resolvedStatus);
  const cancelled = resolvedStatus === "CANCELLED";
  const pending = isPendingCardStatus(resolvedStatus);

  let customerStatusHref: string | null = null;
  let preferredDateToken: string | null = null;
  let preferredDateWindowStart: string | null = null;
  let preferredInstallationDates: string[] = [];
  let workflow = await getPostSurveyWorkflowByPaymentId(paymentId);

  if (success || pending) {
    const workflows = await syncWorkflowStateFromCurrentData();
    workflow =
      workflows.find(
        (entry) =>
          entry.sourcePaymentId === paymentId ||
          entry.currentPaymentId === paymentId ||
          entry.topUpPaymentId === paymentId ||
          entry.replacementPaymentId === paymentId,
      ) ??
      workflow ??
      (await getPostSurveyWorkflowByPaymentId(paymentId));
  }

  const isTopUpReturn =
    workflow &&
    (workflow.topUpPaymentId === paymentId ||
      workflow.replacementPaymentId === paymentId ||
      paymentId.startsWith(`${workflow.sourcePaymentId}-topup-`) ||
      paymentId.startsWith(`${workflow.sourcePaymentId}-balance-`));

  if (success && !isTopUpReturn) {
    runAfterResponse("Jumptech project creation", async () => {
      await ensureJumptechProjectForOriginalPayment(paymentId);
    });
  }

  if (workflow?.reviewToken) {
    customerStatusHref = `/survey-review/${encodeURIComponent(workflow.reviewToken)}`;
    preferredDateToken = preferredDatesEnabledForWorkflow(workflow) ? workflow.reviewToken : null;
    preferredDateWindowStart = getPreferredInstallationWindowStart(workflow);
    preferredInstallationDates = workflow.preferredInstallationDates ?? [];
  }

  if (workflow && isTopUpReturn && success && workflow.topUpPaymentStatus !== "COMPLETED") {
    runAfterResponse("Top-up completion processing", async () => {
      await completeSurveyWorkflowTopUp(
        workflow.id,
        "system",
        `Customer completed the additional card payment of ${getOutstandingWorkflowBalance(workflow).toFixed(2)} following survey review.`,
        {
          paymentId,
          completedAt: session.latestStatus?.updatedAt,
        },
      );
      await updateCheckoutInteractionStatus(
        workflow.sourcePaymentId,
        "PAYMENT_COMPLETED",
        "Customer completed the separate card top-up following survey review.",
      );
      await markJumptechQuoteApprovedForWorkflow(workflow.id, "system");
    });
  } else if (workflow && isTopUpReturn && cancelled && workflow.topUpPaymentStatus !== "CANCELLED") {
    runAfterResponse("Top-up cancellation processing", async () => {
      await failSurveyWorkflowTopUp(workflow.id, "system", {
        status: "CANCELLED",
        detail: "The customer cancelled the additional card payment before authorisation completed.",
      });
    });
  } else if (
    workflow &&
    isTopUpReturn &&
    !success &&
    !pending &&
    !cancelled &&
    workflow.topUpPaymentStatus !== "FAILED"
  ) {
    runAfterResponse("Top-up failure processing", async () => {
      await failSurveyWorkflowTopUp(workflow.id, "system", {
        status: "FAILED",
        detail: "The additional card payment was not approved. The customer can choose another payment route or cancel for a refund.",
      });
    });
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f3f6fb_0%,#eef3f8_100%)] px-4 py-6 text-slate-950 sm:py-10">
      <PaymentPopupReturnBridge paymentId={paymentId} status={resolvedStatus} />
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:rounded-[32px] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            {isTopUpReturn
              ? success
                ? "Additional payment confirmed"
                : cancelled
                  ? "Additional payment cancelled"
                  : pending
                    ? "Additional payment pending"
                    : "Additional payment not completed"
              : success
                ? "Order confirmed"
                : cancelled
                  ? "Checkout cancelled"
                  : pending
                    ? "Payment pending"
                    : "Payment not completed"}
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
            {isTopUpReturn
              ? success
                ? "Thank you. Your additional payment has been received."
                : cancelled
                  ? "Your additional card payment was cancelled."
                  : pending
                    ? "Your additional payment is still being confirmed."
                    : "Your additional card payment was not completed."
              : success
                ? "Thank you. Your order is in place."
                : cancelled
                  ? "Your card checkout was cancelled."
                  : pending
                    ? "Your payment is still being confirmed."
                    : "Your card payment was not completed."}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            {isTopUpReturn
              ? success
                ? "We have received the separate top-up payment for the amended installation amount. The order can now move back into booking."
                : cancelled
                  ? "You can return to your status page to choose another payment route for the additional amount, or cancel the order and request a refund."
                  : pending
                    ? "We have received your return from secure card checkout and are waiting for final confirmation of the separate top-up payment."
                    : "The additional card payment was not approved on this attempt. You can return to the status page to choose another payment route or cancel the order for a refund."
              : success
                ? "We have taken payment for your charger order. Please return your digital survey within 3 days so installation review can begin. If the survey is not returned in time, the order may be cancelled and refunded."
                : cancelled
                  ? "You can return to checkout at any time to choose a payment route again after reviewing the survey details."
                  : pending
                    ? "We have received your return from secure card checkout and are waiting for the final payment status to be confirmed. If the payment completes, the digital survey still needs to be returned within 3 days or the order may be cancelled and refunded."
                    : "The payment was not approved on this attempt. You can return to checkout and choose another payment route."}
          </p>

          <div className="mt-8 rounded-[20px] border border-slate-200 bg-slate-50 p-5 sm:rounded-[24px] sm:p-6">
            <p className="text-sm text-slate-500">Order reference</p>
            <strong className="mt-3 block break-all text-[clamp(2rem,5vw,3.6rem)] font-bold leading-none tracking-[-0.06em] text-slate-950">
              {paymentId}
            </strong>
            {orderId ? <p className="mt-3 text-sm leading-6 text-slate-500">Card checkout reference: {orderId}</p> : null}
          </div>

          <div className="mt-8 rounded-[20px] border border-[#d8e0f0] bg-[linear-gradient(135deg,#101827_0%,#162238_100%)] p-4 text-white sm:rounded-[24px] sm:p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/80">
              Important information
            </p>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-100">
              {isTopUpReturn ? (
                <>
                  <li>The original quote was only an estimate and the final amount was updated after the digital survey review.</li>
                  <li>This extra amount is treated as a separate card transaction and does not change the original payment reference.</li>
                  <li>If you do not wish to proceed, return to your status page to cancel the order and request a refund of the original transaction.</li>
                </>
              ) : (
                <>
                  <li>Your card payment is taken before survey review begins.</li>
                  <li>If the digital survey is not received within 3 days, VCHRGD will contact you and may cancel the order and refund the payment.</li>
                  <li>Installation cost may still change if the digital survey shows that the site is non-standard or different to the answers provided.</li>
                  <li>If the final installation scope changes, VCHRGD will contact you with the revised total before proceeding.</li>
                </>
              )}
            </ul>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={
                customerStatusHref && isTopUpReturn
                  ? customerStatusHref
                  : success || pending
                    ? customerStatusHref ?? "https://www.vchrgd.com"
                    : `/?resume=payment&paymentId=${encodeURIComponent(paymentId)}&rt=${encodeURIComponent(returnToken)}`
              }
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold !text-white no-underline transition hover:bg-[#0f1116] sm:w-auto"
            >
              <span className="whitespace-nowrap">
                {isTopUpReturn
                  ? success || pending
                    ? "Return to your status page"
                    : "Review payment options"
                  : success || pending
                    ? customerStatusHref
                      ? "View your order status"
                      : "Return to VCHRGD"
                    : pending
                      ? "Return to VCHRGD"
                      : "Choose another payment option"}
              </span>
            </Link>
          </div>

          {customerStatusHref ? (
            <CustomerStatusLinkPanel href={customerStatusHref} />
          ) : null}

          {success && !isTopUpReturn && preferredDateToken && preferredDateWindowStart ? (
            <PreferredInstallationDatesPanel
              token={preferredDateToken}
              minimumDate={preferredDateWindowStart}
              initialDates={preferredInstallationDates}
            />
          ) : null}
        </section>

        <aside className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:rounded-[32px] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Order summary
          </p>
          <div className="mt-5 grid gap-4">
            <Summary label="Customer" value={session.customerName || "Not available"} />
            <Summary label="Email" value={session.customerEmail || "Not available"} />
            <Summary label="Product" value={session.chargerName || "Not available"} />
            {isTopUpReturn && workflow ? (
              <>
                <Summary label="Original estimate" value={money.format(workflow.originalAmount)} />
                <Summary label="Revised total" value={money.format((workflow.amendedAmount ?? workflow.originalAmount))} />
                <Summary label="Additional amount" value={money.format(Math.max((workflow.amendedAmount ?? workflow.originalAmount) - workflow.originalAmount, 0))} strong />
              </>
            ) : (
              <>
                <Summary label="Installed package" value={money.format(session.installPrice ?? 0)} />
                <Summary label="Survey adjustment" value={money.format(session.surveyAdjustment ?? 0)} />
                <Summary label="Estimated total" value={money.format(session.amount ?? 0)} strong />
              </>
            )}
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
    <div className="grid gap-1 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`m-0 text-sm sm:text-right ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"}`}>
        {value}
      </dd>
    </div>
  );
}
