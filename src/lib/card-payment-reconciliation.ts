import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import { processCompletedCardPayment } from "@/lib/card-payment-completion";
import {
  listPaymentSessions,
  updateCardCheckoutStatus,
  type PaymentSession,
} from "@/lib/frasers-plus-merchant-state";
import { sendUniqueGoogleChatNotification } from "@/lib/google-chat-notifications";
import {
  completeSurveyWorkflowTopUp,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByPaymentId,
} from "@/lib/post-survey-workflows";
import { resolveSquareOrderPaymentStatus } from "@/lib/square";
import {
  deriveRevolutCardStatus,
  retrieveRevolutOrder,
} from "@/lib/revolut";
import {
  ensureJumptechProjectForOriginalPayment,
  markJumptechQuoteApprovedForWorkflow,
} from "@/lib/workflow-sync";

const DEFAULT_RECONCILIATION_MAX_AGE_DAYS = 7;

function isSuccessfulCardStatus(status: string) {
  return status === "AUTHORISED" || status === "AUTHORIZED" || status === "APPROVED" || status === "COMPLETED";
}

function getSquareReconciliationInteractionStatus(status: string) {
  if (isSuccessfulCardStatus(status)) {
    return "PAYMENT_COMPLETED";
  }

  if (status === "CANCELLED" || status === "EXPIRED") {
    return "ABANDONED";
  }

  return "PAYMENT_PENDING";
}

function getStableProviderReference(session: PaymentSession) {
  return session.providerPaymentReference || session.stripeSessionId || "";
}

function isTopUpPaymentId(paymentId: string) {
  return /-(?:topup|balance)(?:-|$)/i.test(paymentId);
}

function isWithinReconciliationWindow(session: PaymentSession) {
  const configuredDays = Number(process.env.CARD_RECONCILIATION_MAX_AGE_DAYS);
  const maxAgeDays =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : DEFAULT_RECONCILIATION_MAX_AGE_DAYS;
  const createdAt = Date.parse(session.createdAt);

  return (
    Number.isFinite(createdAt) &&
    createdAt >= Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  );
}

async function reconcileSquareSession(session: PaymentSession) {
  const providerReference = getStableProviderReference(session);
  if (!providerReference) {
    return { paymentId: session.paymentId, changed: false, status: "NO_REFERENCE" };
  }

  const resolved = await resolveSquareOrderPaymentStatus(providerReference);
  const status = resolved.status || "PENDING";

  await updateCardCheckoutStatus({
    paymentId: session.paymentId,
    providerPaymentReference: providerReference,
    status,
  });

  const interactionStatus = getSquareReconciliationInteractionStatus(status);
  if (interactionStatus) {
    await updateCheckoutInteractionStatus(
      session.paymentId,
      interactionStatus,
      isSuccessfulCardStatus(status)
        ? "Square reconciliation confirmed the secure card checkout was paid."
        : "Square reconciliation refreshed the secure card checkout status.",
    );
  }

  if (isSuccessfulCardStatus(status)) {
    const workflow = await getPostSurveyWorkflowByPaymentId(session.paymentId);
    const topUpSession =
      isTopUpPaymentId(session.paymentId) ||
      workflow?.topUpPaymentId === session.paymentId ||
      workflow?.replacementPaymentId === session.paymentId;

    if (topUpSession) {
      await sendUniqueGoogleChatNotification(
        `square-topup-paid:${session.paymentId}`,
        [
          "Balance payment received",
          `Order: ${workflow?.sourcePaymentId || session.customerId || session.paymentId}`,
          `Top-up reference: ${session.paymentId}`,
          `Customer: ${session.customerName || workflow?.customerName || "Not provided"}`,
          `Email: ${session.customerEmail || workflow?.customerEmail || "Not provided"}`,
          `Charger: ${session.chargerName || workflow?.chargerName || "Not provided"}`,
          `Amount: ${session.currency || "GBP"} ${session.amount?.toFixed(2) ?? "0.00"}`,
          "Next step: continue booking against the existing Jumptech project.",
        ].join("\n"),
      );

      if (workflow && workflow.topUpPaymentStatus !== "COMPLETED") {
        await completeSurveyWorkflowTopUp(
          workflow.id,
          "system",
          `Square reconciliation confirmed the separate card top-up of ${getOutstandingWorkflowBalance(workflow).toFixed(2)} following survey review.`,
          {
            paymentId: session.paymentId,
            completedAt: session.latestStatus?.updatedAt,
          },
        );
        await updateCheckoutInteractionStatus(
          workflow.sourcePaymentId,
          "PAYMENT_COMPLETED",
          "Square reconciliation confirmed the separate card top-up following survey review.",
        );
        await markJumptechQuoteApprovedForWorkflow(workflow.id, "system");
      }
    } else {
      await sendUniqueGoogleChatNotification(
        `square-paid:${session.paymentId}`,
        [
          "New paid VCHRGD customer",
          `Order: ${session.paymentId}`,
          `Customer: ${session.customerName || "Not provided"}`,
          `Email: ${session.customerEmail || "Not provided"}`,
          `Charger: ${session.chargerName || "Not provided"}`,
          `Amount: ${session.currency || "GBP"} ${session.amount?.toFixed(2) ?? "0.00"}`,
          "Next step: review the back office and confirm Jumptech project creation.",
        ].join("\n"),
      );
      await ensureJumptechProjectForOriginalPayment(session.paymentId);
    }
  }

  return {
    paymentId: session.paymentId,
    changed: session.latestStatus?.status !== status,
    status,
    providerReference,
  };
}

async function reconcileRevolutSession(session: PaymentSession) {
  const providerReference = getStableProviderReference(session);
  if (!providerReference) {
    return { paymentId: session.paymentId, changed: false, status: "NO_REFERENCE" };
  }

  const resolved = await retrieveRevolutOrder(providerReference);
  if (!resolved.response.ok) {
    return {
      paymentId: session.paymentId,
      changed: false,
      status: "RECONCILIATION_FAILED",
      providerReference,
    };
  }

  const status =
    resolved.data && typeof resolved.data === "object"
      ? deriveRevolutCardStatus(resolved.data)
      : "PENDING";

  const updatedSession = await updateCardCheckoutStatus({
    paymentId: session.paymentId,
    providerPaymentReference: providerReference,
    status,
  });

  await updateCheckoutInteractionStatus(
    session.paymentId,
    status === "COMPLETED"
      ? "PAYMENT_COMPLETED"
      : status === "CANCELLED" || status === "FAILED" || status === "DECLINED"
        ? "ABANDONED"
        : "PAYMENT_PENDING",
    status === "COMPLETED"
      ? "Revolut reconciliation confirmed the card payment was captured."
      : "Revolut reconciliation refreshed the secure card checkout status.",
  );

  if (status === "COMPLETED" && updatedSession) {
    await processCompletedCardPayment(updatedSession, "Revolut");
  }

  return {
    paymentId: session.paymentId,
    changed: session.latestStatus?.status !== status,
    status,
    providerReference,
  };
}

export async function reconcileSquareCardPayments({ limit = 50 } = {}) {
  const sessions = (await listPaymentSessions())
    .filter((session) => session.provider === "CARD" && session.cardProcessor === "SQUARE")
    .filter(isWithinReconciliationWindow)
    .filter((session) => session.latestStatus?.status !== "REFUNDED")
    .filter((session) => !isSuccessfulCardStatus(session.latestStatus?.status?.toUpperCase() || ""))
    .slice(0, limit);

  const results = [];
  for (const session of sessions) {
    results.push(await reconcileSquareSession(session));
  }

  return {
    checked: sessions.length,
    completed: results.filter((result) => isSuccessfulCardStatus(result.status)).length,
    results,
  };
}

export async function reconcileCardPayments({ limit = 50 } = {}) {
  const sessions = (await listPaymentSessions())
    .filter(
      (session) =>
        session.provider === "CARD" &&
        (session.cardProcessor === "SQUARE" || session.cardProcessor === "REVOLUT"),
    )
    .filter(isWithinReconciliationWindow)
    .filter((session) => session.latestStatus?.status !== "REFUNDED")
    .filter((session) => {
      const status = session.latestStatus?.status?.toUpperCase() || "";
      return session.cardProcessor === "REVOLUT"
        ? status !== "COMPLETED"
        : !isSuccessfulCardStatus(status);
    })
    .slice(0, limit);

  const results = [];
  for (const session of sessions) {
    if (session.cardProcessor === "SQUARE") {
      results.push(await reconcileSquareSession(session));
    } else if (session.cardProcessor === "REVOLUT") {
      results.push(await reconcileRevolutSession(session));
    }
  }

  return {
    checked: sessions.length,
    completed: results.filter((result) => result.status === "COMPLETED").length,
    results,
  };
}
