import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  PackageCheck,
} from "lucide-react";
import { notFound } from "next/navigation";
import { CancelOrderRequestDialog } from "@/components/cancel-order-request-dialog";
import { PaymentPopupSubmitBridge } from "@/components/payment-popup-submit-bridge";
import { PreferredInstallationDatesPanel } from "@/components/preferred-installation-dates-panel";
import { preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";
import {
  canCustomerRequestCancellation,
  canPayWorkflowBalance,
  type SurveyWorkflow,
  getSurveyResponseDeadline,
  getCustomerWorkflowProgress,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByToken,
  getPreferredInstallationWindowStart,
  getResolvedWorkflowAmount,
  hasWorkflowChargerDispatched,
  isSurveyReviewLinkExpired,
  isSurveyOverdue,
} from "@/lib/post-survey-workflows";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function formatTimestamp(value?: string) {
  if (!value) {
    return "Not yet updated";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskReference(reference?: string) {
  if (!reference) {
    return "Waiting for reference";
  }

  if (reference.length <= 8) {
    return reference;
  }

  return `${reference.slice(0, 8)}...${reference.slice(-4)}`;
}

function formatPreferredInstallationDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateOnly(value?: string) {
  if (!value) {
    return "Not yet confirmed";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00`));
}

function buildStatusCopy(workflow: SurveyWorkflow | undefined) {
  if (!workflow) {
    return {
      eyebrow: "Order and installation status",
      title: "Track your charger order.",
      detail:
        "Use this page to follow payment confirmation, survey progress, and installation updates.",
    };
  }

  const paymentRouteDetail =
    workflow.provider === "FRASERS_PLUS"
      ? "Frasers Plus allocated your order when you approved it."
      : workflow.provider === "CARD"
        ? "Your card payment was taken when you placed the order."
        : "Your payment route has already been confirmed for this order.";
  if (workflow.refundStatus === "COMPLETED") {
    return {
      eyebrow: "Refund completed",
      title: "Your order is closed and your refund has been processed.",
      detail: workflow.manualRefund ? `The VCHRGD team has recorded your refund of ${money.format(workflow.manualRefund.amount)} as completed. No further payment is required for this order. Please contact the team if you have any questions.` : "Your payment provider has confirmed the refund or reversal. No further payment is required. Please allow your provider's normal processing time for the funds to appear.",
    };
  }
  const overdueDetail =
    workflow.provider === "FRASERS_PLUS"
      ? "If the survey is not returned, the order may be cancelled and the Frasers Plus allocation reversed."
      : workflow.provider === "CARD"
        ? "If the survey is not returned, the order may be cancelled and the card payment refunded."
        : "If the survey is not returned, the order may be cancelled.";

  if (
    getOutstandingWorkflowBalance(workflow) > 0.01 &&
    workflow.topUpPaymentStatus !== "COMPLETED" &&
    workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
    workflow.surveyStatus !== "INSTALLED" &&
    workflow.surveyStatus !== "DECLINED"
  ) {
    return {
      eyebrow: "Balance confirmation",
      title: "Your additional payment is still required.",
      detail:
        "We are waiting for the separate additional payment to be confirmed before booking can continue.",
    };
  }

  switch (workflow.surveyStatus) {
    case "AWAITING_SURVEY":
      return {
        eyebrow: "Order and installation status",
        title: "Your order has been confirmed.",
        detail:
          isSurveyOverdue(workflow)
            ? `${paymentRouteDetail} We have not received your digital survey within 3 days, so the order now needs manual attention from VCHRGD. ${overdueDetail}`
            : `${paymentRouteDetail} Please return your digital survey within 3 days so the installation can move into review.`,
      };
    case "SURVEY_RECEIVED":
      return {
        eyebrow: "Survey received",
        title: "Your survey is with the operations team.",
        detail:
          `${paymentRouteDetail} We have received your survey details and the team is reviewing the installation requirements.`,
      };
    case "REVIEW_READY":
      return {
        eyebrow: "Survey review ready",
        title:
          getOutstandingWorkflowBalance(workflow) > 0
            ? "Please review your updated installation total."
            : "Please review your installation summary.",
        detail:
          getOutstandingWorkflowBalance(workflow) > 0
            ? "We have reviewed the survey and the final installation amount is higher than the original estimate. Please review the update before booking can move ahead."
            : "We have reviewed the survey and need your confirmation before booking can move ahead.",
      };
    case "BALANCE_PENDING":
      return {
        eyebrow: "Balance confirmation",
        title: "Your additional payment is still required.",
        detail:
          "We have reviewed the survey and are waiting for the separate additional payment to be confirmed before booking can continue.",
      };
    case "READY_FOR_BOOKING":
      return {
        eyebrow: "Ready for booking",
        title: "Your installation is moving into scheduling.",
        detail:
          "Survey review is complete and the order is now in the booking queue.",
      };
    case "BOOKED_FOR_INSTALLATION":
      return {
        eyebrow: "Installation booked",
        title: "Your installation date has been scheduled.",
        detail:
          "Your charger order is now booked in and we have included the latest installer and scheduling details below.",
      };
    case "INSTALLED":
      return {
        eyebrow: "Installation complete",
        title: "Your charger installation is complete.",
        detail:
          "The installation has been marked as complete. The latest installation and installer details are shown below for your records.",
      };
    case "DECLINED":
      return {
        eyebrow: "Order update",
        title: "We've received your order cancellation request.",
        detail:
          "Our team will review the request and confirm with you once the refund or reversal has been processed.",
      };
    default:
      return {
        eyebrow: "Order and installation status",
        title: "Track your charger order.",
        detail:
          "Use this page to follow payment confirmation, survey progress, and installation updates.",
      };
  }
}

export default async function SurveyReviewPage({
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
    return <ClosedStatusLinkPage />;
  }

  const state = typeof query.state === "string" ? query.state : "";
  const finalAmount = getResolvedWorkflowAmount(workflow);
  const additionalAmount = getOutstandingWorkflowBalance(workflow);
  const changed = finalAmount !== workflow.originalAmount;
  const address = workflow.deliveryAddress ?? workflow.billingAddress;
  const reference = workflow.currentPaymentId || workflow.sourcePaymentId;
  const statusCopy = buildStatusCopy(workflow);
  const progressItems = getCustomerWorkflowProgress(workflow);
  const needsCustomerDecision = workflow.surveyStatus === "REVIEW_READY";
  const needsAdditionalPayment = canPayWorkflowBalance(workflow);
  const surveyDeadline = getSurveyResponseDeadline(workflow);
  const surveyOverdue = isSurveyOverdue(workflow);
  const originalPaymentLabel =
    workflow.paymentChoice === "frasers-plus" || workflow.provider === "FRASERS_PLUS"
      ? "Already allocated"
      : "Already paid";
  const originalPaymentRouteLabel =
    workflow.paymentChoice === "frasers-plus" || workflow.provider === "FRASERS_PLUS"
      ? "Frasers Plus"
      : "Card payment";
  const canUseFrasersTopUp =
    workflow.provider === "FRASERS_PLUS" || workflow.paymentChoice === "frasers-plus";
  const canRequestCancellation = canCustomerRequestCancellation(workflow);
  const chargerDispatched = hasWorkflowChargerDispatched(workflow);
  const showCancellationConfirmation =
    workflow.refundStatus === "REQUESTED" || state === "declined";
  const isAmendmentPaymentStep =
    needsAdditionalPayment;
  const showsStandardDecision =
    !expired &&
    needsCustomerDecision &&
    workflow.surveyStatus !== "DECLINED" &&
    !isAmendmentPaymentStep;
  const showsSpecificCancellationAction =
    isAmendmentPaymentStep ||
    showsStandardDecision ||
    (!expired && needsAdditionalPayment && !isAmendmentPaymentStep) ||
    workflow.surveyStatus === "READY_FOR_BOOKING" ||
    workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ||
    workflow.surveyStatus === "INSTALLED";
  const showGeneralCancellationAction =
    canRequestCancellation &&
    !showCancellationConfirmation &&
    !showsSpecificCancellationAction;
  const canEditPreferredDates =
    preferredDatesEnabledForWorkflow(workflow) &&
    workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
    workflow.surveyStatus !== "INSTALLED" &&
    workflow.surveyStatus !== "DECLINED";
  const preferredDateWindowStart = getPreferredInstallationWindowStart(workflow);
  const hasPreferredDates = Boolean(workflow.preferredInstallationDates?.length);
  const hasStartedTopUpPayment = Boolean(
    workflow.topUpPaymentId ||
      workflow.replacementPaymentId ||
      workflow.topUpRequestedAt ||
      workflow.topUpUpr ||
      workflow.replacementUpr,
  );
  const quickActions = [
    needsAdditionalPayment &&
    !showCancellationConfirmation
      ? {
          key: "balance",
          href: `/survey-review/${encodeURIComponent(token)}/pay-balance`,
          label: "Pay outstanding balance",
          detail: money.format(additionalAmount),
          icon: AlertTriangle,
          tone: "warning" as const,
        }
      : null,
    canEditPreferredDates && !hasPreferredDates && !showCancellationConfirmation
      ? {
          key: "preferred-dates",
          href: "#preferred-dates",
          label: "Add preferred dates",
          detail: "Choose up to 3",
          icon: CalendarDays,
          tone: "neutral" as const,
        }
      : null,
    hasStartedTopUpPayment &&
    workflow.topUpPaymentStatus === "PENDING" &&
    !showCancellationConfirmation
      ? {
          key: "top-up-pending",
          href: "#balance-actions",
          label: "Top-up awaiting approval",
          detail: "Payment not confirmed",
          icon: Clock3,
          tone: "neutral" as const,
        }
      : null,
    chargerDispatched && !showCancellationConfirmation
      ? {
          key: "charger-dispatched",
          href: "#charger-dispatch",
          label: "Charger dispatched",
          detail: workflow.chargerExpectedDeliveryDate
            ? formatDateOnly(workflow.chargerExpectedDeliveryDate)
            : "Delivery update",
          icon: PackageCheck,
          tone: "success" as const,
        }
      : null,
    workflow.surveyReviewedAt && !showCancellationConfirmation
      ? {
          key: "survey-reviewed",
          href: "#process-update",
          label: "Survey reviewed",
          detail: formatTimestamp(workflow.surveyReviewedAt),
          icon: CheckCircle2,
          tone: "success" as const,
        }
      : null,
  ].filter((action): action is NonNullable<typeof action> => Boolean(action));

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-3 py-6 text-slate-950 sm:px-4 sm:py-10">
      <PaymentPopupSubmitBridge />
      <div className="mx-auto grid min-w-0 max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="min-w-0 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:max-w-none sm:rounded-[32px] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            {statusCopy.eyebrow}
          </p>
          <h1 className="mt-4 break-words text-3xl font-bold text-slate-950 sm:text-4xl">
            {statusCopy.title}
          </h1>
          <p className="mt-4 max-w-3xl break-words text-base leading-7 text-slate-600">
            {statusCopy.detail}
          </p>

          {quickActions.length ? (
            <nav
              aria-label="Important order updates"
              className="mt-6 grid gap-2 sm:grid-cols-2"
            >
              {quickActions.map(({ key, ...action }) => (
                <QuickActionLink key={key} {...action} />
              ))}
            </nav>
          ) : null}

          <div className="mt-8 rounded-[20px] border border-slate-200 bg-slate-50 p-5 sm:rounded-[24px] sm:p-6">
            <p className="text-sm text-slate-500">Order reference</p>
            <strong className="mt-3 block break-all text-3xl font-bold leading-none text-slate-950 sm:text-[3.6rem]">
              {maskReference(reference)}
            </strong>
            {workflow.jumptech?.projectId ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Jumptech project linked
              </p>
            ) : null}
          </div>

          {showCancellationConfirmation ? (
            <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                What happens next
              </p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
                <p>
                  We have received your request to cancel this order. VCHRGD will review the
                  request and, if approved, arrange a refund or reversal of the original{" "}
                  {originalPaymentRouteLabel.toLowerCase()} amount of{" "}
                  {money.format(workflow.originalAmount)}.
                </p>
                <p>
                  We will confirm with you once the refund has been processed. Refunds and
                  reversals usually appear within 3 working days, although timings can vary by
                  bank or payment provider.
                </p>
                <p>
                  If you need help, please call{" "}
                  <a className="font-semibold text-slate-900" href="tel:+441494370525">
                    +44 1494 370525
                  </a>{" "}
                  or email{" "}
                  <a className="font-semibold text-slate-900" href="mailto:sales@vchrgd.com">
                    sales@vchrgd.com
                  </a>
                  .
                </p>
              </div>
            </div>
          ) : (
            <>
              {chargerDispatched ? (
                <div id="charger-dispatch" className="mt-6 scroll-mt-6 rounded-[24px] border border-[#00eaff]/30 bg-[linear-gradient(135deg,#effcff_0%,#f8fdff_55%,#ffffff_100%)] p-5 shadow-[0_18px_45px_rgba(0,199,239,0.12)] sm:rounded-[28px] sm:p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#009bc2]">
                    Charger dispatched
                  </p>
                  <h2 className="mt-3 text-2xl font-bold text-slate-950">
                    Your charger is on its way.
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                    We have confirmed dispatch to your installation address.
                    {workflow.chargerExpectedDeliveryDate
                      ? ` Expected delivery: ${formatDateOnly(workflow.chargerExpectedDeliveryDate)}.`
                      : " Delivery timing will be updated as soon as it is confirmed."}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    Online cancellation is no longer available once charger dispatch has been confirmed.
                    If you need to cancel, please contact VCHRGD so we can arrange collection
                    of the charger before any refund is issued.
                  </p>
                </div>
              ) : null}

              {expired ? (
                <Banner
                  tone="warning"
                  title="This confirmation window has expired."
                  detail="You can still use this page to track progress, but please contact VCHRGD if you need a fresh confirmation link."
                />
              ) : null}

              {surveyOverdue ? (
                <Banner
                  tone="warning"
                  title="Your survey has not been received within 3 days."
                  detail={
                    workflow.provider === "FRASERS_PLUS"
                      ? `Please contact VCHRGD immediately. If the survey is not returned, the order may be cancelled and the Frasers Plus allocation reversed. Survey deadline: ${formatTimestamp(surveyDeadline)}.`
                      : workflow.provider === "CARD"
                        ? `Please contact VCHRGD immediately. If the survey is not returned, the order may be cancelled and the card payment refunded. Survey deadline: ${formatTimestamp(surveyDeadline)}.`
                        : `Please contact VCHRGD immediately. Survey deadline: ${formatTimestamp(surveyDeadline)}.`
                  }
                />
              ) : null}

              {state === "cancel-unavailable" ? (
                <Banner
                  tone="warning"
                  title="Online cancellation is no longer available."
                  detail="The charger has already been dispatched. Please contact VCHRGD so we can arrange collection of the charger before any refund is issued."
                />
              ) : null}

              {state === "error" ? (
                <Banner
                  tone="warning"
                  title="We could not update the payment route automatically."
                  detail="Please contact VCHRGD and we will complete the amendment manually."
                />
              ) : null}

              {hasStartedTopUpPayment && workflow.topUpPaymentStatus === "PENDING" ? (
                <Banner
                  tone="muted"
                  title="Your additional payment is still awaiting confirmation."
                  detail="This has not changed your order status. You can use the payment options below again when you are ready, choose another payment route, or ask VCHRGD to review a cancellation instead."
                />
              ) : null}

              {hasStartedTopUpPayment && workflow.topUpPaymentStatus === "FAILED" ? (
                <Banner
                  tone="warning"
                  title="Your additional payment was not approved."
                  detail={
                    workflow.topUpFailureReason ||
                    "Please choose another payment route or cancel the order and request a refund."
                  }
                />
              ) : null}

              {hasStartedTopUpPayment && workflow.topUpPaymentStatus === "CANCELLED" ? (
                <Banner
                  tone="muted"
                  title="Your additional payment was cancelled."
                  detail="You can still return to the payment options below or cancel the order and request a refund."
                />
              ) : null}

              <div id="process-update" className="mt-8 scroll-mt-6 rounded-[20px] border border-slate-200 bg-slate-50 p-4 sm:rounded-[24px] sm:p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                  Process update
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {progressItems.map((item) => (
                    <ProgressItem
                      key={item.key}
                      label={item.label}
                      value={item.value}
                      complete={item.complete}
                    />
                  ))}
                </div>
              </div>

              {(workflow.jumptech?.status || workflow.jumptech?.currentStatusLabel || workflow.jumptech?.lastError) ? (
                <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                        Jumptech project status
                      </p>
                      <p className="mt-3 text-lg font-semibold text-slate-950">
                        {workflow.jumptech?.currentStatusLabel ||
                          workflow.jumptech?.status ||
                          "Project created"}
                      </p>
                    </div>
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
                      {workflow.jumptech?.lastWebhookAt
                        ? `Updated ${formatTimestamp(workflow.jumptech.lastWebhookAt)}`
                        : workflow.jumptech?.lastSyncedAt
                          ? `Synced ${formatTimestamp(workflow.jumptech.lastSyncedAt)}`
                          : "Awaiting webhook update"}
                    </span>
                  </div>
                  {workflow.jumptech?.currentStatusDetail ? (
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {workflow.jumptech.currentStatusDetail}
                    </p>
                  ) : null}
                  {workflow.jumptech?.lastError ? (
                    <p className="mt-3 text-sm leading-7 text-amber-700">
                      {workflow.jumptech.lastError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showGeneralCancellationAction ? (
                <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                    Need to cancel?
                  </p>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                    You can ask VCHRGD to review a cancellation and refund request while the
                    order is not yet dispatched.
                  </p>
                  <div className="mt-5">
                    <CancelOrderRequestDialog
                      token={token}
                      originalAmount={workflow.originalAmount}
                      paymentRouteLabel={originalPaymentRouteLabel}
                      reason="Customer requested cancellation from their order status page before charger dispatch."
                      buttonLabel="Cancel order"
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <Panel
                  title="Order details"
                  lines={[
                    workflow.chargerName || "Charger order",
                    `${originalPaymentRouteLabel} route`,
                    changed ? "Revised after survey review" : "Estimate currently unchanged",
                  ]}
                />
                <Panel
                  title="Installation address"
                  lines={[
                    address?.city || "Area not available",
                    address?.postalCode || "",
                    address?.country || "",
                  ].filter(Boolean)}
                />
                {preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length ? (
                  <Panel
                    title="Preferred installation dates"
                    lines={workflow.preferredInstallationDates.map((value) =>
                      formatPreferredInstallationDate(value),
                    )}
                  />
                ) : null}
              </div>

              <div id="installation-total" className="mt-6 scroll-mt-6 rounded-[20px] border border-slate-200 bg-slate-50 p-4 sm:rounded-[24px] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                      Installation total
                    </p>
                    <strong className="mt-3 block text-4xl font-bold text-slate-950">
                      {money.format(finalAmount)}
                    </strong>
                    {changed ? (
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        Previous estimate: {money.format(workflow.originalAmount)}
                      </p>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        The installation total remains unchanged after survey review.
                      </p>
                    )}
                  </div>
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    {originalPaymentRouteLabel}
                  </span>
                </div>

                {workflow.amendmentNotes ? (
                  <div className="mt-5 rounded-[18px] border border-slate-200 bg-white p-4 sm:p-5">
                    <p className="text-sm font-semibold text-slate-950">Installation update</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{workflow.amendmentNotes}</p>
                  </div>
                ) : null}

                {additionalAmount > 0 ? (
                  <div className="mt-5 grid gap-3 min-[430px]:grid-cols-3 md:grid-cols-3">
                    <AmountHighlight
                      label="Revised total"
                      value={money.format(finalAmount)}
                    />
                    <AmountHighlight
                      label={originalPaymentLabel}
                      value={money.format(workflow.originalAmount)}
                    />
                    <AmountHighlight
                      label="Balance left to pay"
                      value={money.format(additionalAmount)}
                      strong
                    />
                  </div>
                ) : null}

                {additionalAmount > 0 ? (
                  <div className="mt-5 rounded-[18px] border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">Outstanding balance</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      Only the remaining {money.format(additionalAmount)} will be requested in the
                      next payment step. If you choose to cancel instead, VCHRGD will review a refund
                      or reversal of the full original {originalPaymentRouteLabel.toLowerCase()} amount
                      of {` ${money.format(workflow.originalAmount)}`}.
                    </p>
                  </div>
                ) : null}
              </div>

              {!changed ? (
                <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                    Before you continue
                  </p>
                  <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
                    <li>Card payments are taken and Frasers Plus allocations are confirmed before survey review begins.</li>
                    <li>The initial quote is only an estimate and may change after the detailed survey is reviewed.</li>
                    <li>If an additional amount is required, it must be approved as a separate transaction and the original approval does not guarantee approval of the top-up amount.</li>
                    <li>You can cancel the order and request a refund or reversal of the original transaction instead of paying the additional amount.</li>
                  </ul>
                </div>
              ) : null}

              {isAmendmentPaymentStep ? (
                <div id="balance-actions" className="mt-8 scroll-mt-6 rounded-[20px] border border-slate-200 bg-slate-50 p-4 sm:rounded-[24px] sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                    Next step
                  </p>
                  <h2 className="mt-4 text-2xl font-bold text-slate-950">
                    Choose how to pay the remaining balance.
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                    The payment options below only collect the outstanding balance of{" "}
                    {money.format(additionalAmount)}. The original {originalPaymentRouteLabel.toLowerCase()}{" "}
                    amount of {money.format(workflow.originalAmount)} remains linked to this order.
                  </p>

                  <div className="mt-6 grid gap-4">
                    {canUseFrasersTopUp ? (
                      <ActionOptionCard
                        title="Pay the balance with Frasers Plus"
                        detail="Start a separate Frasers Plus approval for the balance only. Approval of the original amount does not guarantee approval of this top-up."
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
                      </ActionOptionCard>
                    ) : null}

                    <ActionOptionCard
                      title="Pay the balance by card"
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
                    </ActionOptionCard>

                    <ActionOptionCard
                      title="Cancel the order and request a refund"
                      detail={`Ask VCHRGD to review a refund or reversal of the full original ${originalPaymentRouteLabel.toLowerCase()} amount instead of collecting the outstanding balance.`}
                    >
                      {canRequestCancellation ? (
                        <CancelOrderRequestDialog
                          token={token}
                          originalAmount={workflow.originalAmount}
                          paymentRouteLabel={originalPaymentRouteLabel}
                          reason="Customer requested cancellation after survey review instead of paying the outstanding amended balance."
                        />
                      ) : (
                        <p className="text-sm leading-7 text-slate-600">
Online cancellation is no longer available for this order.
                          Please contact VCHRGD so we can arrange collection of the charger before any refund is issued.
                        </p>
                      )}
                    </ActionOptionCard>
                  </div>
                </div>
              ) : null}

              {showsStandardDecision ? (
                <div className="mt-8 flex flex-wrap gap-3">
                  <form action="/api/survey-review/action" method="post">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="action" value="accept" />
                    <button
                      type="submit"
                      className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                    >
                      Accept and continue
                    </button>
                  </form>
                  {canRequestCancellation ? (
                    <CancelOrderRequestDialog
                      token={token}
                      originalAmount={workflow.originalAmount}
                      paymentRouteLabel={originalPaymentRouteLabel}
                      reason="Customer requested cancellation after survey review."
                      buttonLabel="Cancel order"
                    />
                  ) : null}
                </div>
              ) : null}

              {!expired && needsAdditionalPayment && !isAmendmentPaymentStep ? (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={`/survey-review/${encodeURIComponent(token)}/pay-balance`}
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                  >
                    Review and pay the difference
                  </Link>
                  {canRequestCancellation ? (
                    <CancelOrderRequestDialog
                      token={token}
                      originalAmount={workflow.originalAmount}
                      paymentRouteLabel={originalPaymentRouteLabel}
                      reason="Customer requested cancellation after survey review instead of paying the additional amount."
                    />
                  ) : null}
                </div>
              ) : null}

              {(workflow.surveyStatus === "READY_FOR_BOOKING" ||
                workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ||
                workflow.surveyStatus === "INSTALLED") && (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={`/survey-review/${encodeURIComponent(token)}/success`}
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                  >
                    View installation confirmation
                  </Link>
                  {canRequestCancellation ? (
                    <CancelOrderRequestDialog
                      token={token}
                      originalAmount={workflow.originalAmount}
                      paymentRouteLabel={originalPaymentRouteLabel}
                      reason={
                        workflow.surveyStatus === "BOOKED_FOR_INSTALLATION"
                          ? "Customer requested cancellation before the charger was dispatched."
                          : "Customer requested cancellation while the order was waiting to be booked."
                      }
                      buttonLabel="Cancel order"
                    />
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="min-w-0 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:max-w-none sm:rounded-[32px] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Summary
          </p>
          <div className="mt-5 grid gap-4">
            <Summary label="Order reference" value={maskReference(reference)} />
            <Summary label="Product" value={workflow.chargerName || "Not available"} />
            <Summary
              label={changed ? originalPaymentLabel : "Original estimate"}
              value={money.format(workflow.originalAmount)}
            />
            <Summary label="Current total" value={money.format(finalAmount)} strong />
            {changed && additionalAmount > 0.01 ? (
              <Summary label="Balance left to pay" value={money.format(additionalAmount)} strong />
            ) : workflow.topUpPaymentStatus === "COMPLETED" ? (
              <Summary label="Additional payment" value="Confirmed" />
            ) : null}
            <Summary label="Survey due by" value={formatTimestamp(surveyDeadline)} />
            <Summary
              label="Survey received"
              value={workflow.surveyReceivedAt ? formatTimestamp(workflow.surveyReceivedAt) : "Awaiting survey"}
            />
            <Summary
              label="Survey reviewed"
              value={workflow.surveyReviewedAt ? formatTimestamp(workflow.surveyReviewedAt) : "Awaiting review"}
            />
            <Summary
              label="Charger dispatch"
              value={
                chargerDispatched
                  ? workflow.chargerExpectedDeliveryDate
                    ? `Expected ${formatDateOnly(workflow.chargerExpectedDeliveryDate)}`
                    : "Dispatched"
                  : "Awaiting dispatch"
              }
            />
            {preferredDatesEnabledForWorkflow(workflow) ? <SummaryList
              label="Preferred dates"
              values={
                workflow.preferredInstallationDates?.length
                  ? workflow.preferredInstallationDates.map((value) =>
                      formatPreferredInstallationDate(value),
                    )
                  : ["Not provided"]
              }
            /> : null}
            {showCancellationConfirmation ? (
              <Summary label="Cancellation status" value="Request received" strong />
            ) : null}
            <Summary
              label="Expected installation"
              value={workflow.installationDate || "Not booked yet"}
            />
          </div>

          {canEditPreferredDates ? (
            <div id="preferred-dates" className="scroll-mt-6">
              <PreferredInstallationDatesPanel
                token={token}
                minimumDate={preferredDateWindowStart}
                initialDates={workflow.preferredInstallationDates ?? []}
                monthsPerPage={1}
                layout="summary"
              />
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function ClosedStatusLinkPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto max-w-2xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
          Order status link closed
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
          This order status link is no longer active.
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The installation has been confirmed as complete, so this customer status link has been closed.
          If you need anything further, contact VCHRGD on{" "}
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

function QuickActionLink({
  href,
  label,
  detail,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  detail: string;
  icon: typeof AlertTriangle;
  tone: "warning" | "neutral" | "success";
}) {
  const toneClassName =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-slate-50 text-slate-900";
  const iconClassName =
    tone === "warning"
      ? "bg-amber-100 text-amber-700"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-white text-slate-600";

  return (
    <a
      href={href}
      className={`grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-[18px] border px-3 py-3 text-left no-underline transition hover:border-[#00c7ef] hover:bg-white ${toneClassName}`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-full ${iconClassName}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5">{label}</span>
        <span className="block truncate text-xs leading-5 opacity-75">{detail}</span>
      </span>
    </a>
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

function SummaryList({
  label,
  values,
}: {
  label: string;
  values: string[];
}) {
  return (
    <div className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <dt className="text-sm text-slate-500">{label}</dt>
        <dd className="m-0 grid gap-1 text-left text-sm font-semibold text-slate-900 sm:text-right">
          {values.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </dd>
      </div>
    </div>
  );
}

function Panel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-4 sm:rounded-[24px] sm:p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">{title}</p>
      <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-600">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function AmountHighlight({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <strong
        className={`mt-3 block text-2xl leading-none min-[430px]:text-[1.35rem] sm:text-[1.7rem] ${
          strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"
        }`}
      >
        {value}
      </strong>
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

function ActionOptionCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-4 sm:rounded-[24px] sm:p-5">
      <p className="text-lg font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ProgressItem({
  label,
  value,
  complete,
}: {
  label: string;
  value: string;
  complete: boolean;
}) {
  return (
    <div className="grid min-h-[132px] grid-rows-[auto_1fr] rounded-[18px] border border-slate-200 bg-white p-4 sm:rounded-[20px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <p className="min-w-0 text-xs font-bold uppercase leading-5 tracking-[0.12em] text-slate-500 sm:tracking-[0.16em]">
          {label}
        </p>
        <span
          className={`inline-flex h-7 shrink-0 items-center justify-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${
            complete
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {complete ? "Updated" : "Pending"}
        </span>
      </div>
      <p className="mt-4 self-start text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}
