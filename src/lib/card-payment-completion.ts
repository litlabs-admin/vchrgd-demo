import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";
import { sendUniqueGoogleChatNotification } from "@/lib/google-chat-notifications";
import {
  completeSurveyWorkflowTopUp,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByPaymentId,
} from "@/lib/post-survey-workflows";
import {
  ensureJumptechProjectForOriginalPayment,
  markJumptechQuoteApprovedForWorkflow,
} from "@/lib/workflow-sync";

function isTopUpPaymentId(paymentId: string) {
  return /-(?:topup|balance)(?:-|$)/i.test(paymentId);
}

export async function processCompletedCardPayment(
  session: PaymentSession,
  providerName: string,
) {
  if (session.latestStatus?.status === "REFUNDED") return;
  const providerKey = providerName.trim().toLowerCase().replace(/\s+/g, "-");
  const workflow = await getPostSurveyWorkflowByPaymentId(session.paymentId);
  const topUpSession =
    isTopUpPaymentId(session.paymentId) ||
    workflow?.topUpPaymentId === session.paymentId ||
    workflow?.replacementPaymentId === session.paymentId;

  if (topUpSession) {
    await sendUniqueGoogleChatNotification(
      `${providerKey}-topup-paid:${session.paymentId}`,
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
        `${providerName} confirmed the separate card top-up of ${getOutstandingWorkflowBalance(workflow).toFixed(2)} following survey review.`,
        {
          paymentId: session.paymentId,
          completedAt: session.latestStatus?.updatedAt,
        },
      );
      await updateCheckoutInteractionStatus(
        workflow.sourcePaymentId,
        "PAYMENT_COMPLETED",
        `${providerName} confirmed the separate card top-up following survey review.`,
      );
      await markJumptechQuoteApprovedForWorkflow(workflow.id, "system");
    }

    return;
  }

  await sendUniqueGoogleChatNotification(
    `${providerKey}-paid:${session.paymentId}`,
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
