import { NextResponse } from "next/server";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import {
  getPaymentSessionByProviderPaymentReference,
  updateCardCheckoutStatus,
} from "@/lib/frasers-plus-merchant-state";
import {
  getSquareConfig,
  normaliseSquareWebhookEvent,
  resolveSquarePaymentOrderId,
  resolveSquareOrderPaymentStatus,
  verifySquareWebhookSignature,
} from "@/lib/square";
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

function isSuccessfulSquareStatus(status: string) {
  return status === "AUTHORISED" || status === "AUTHORIZED" || status === "COMPLETED";
}

function getSquareCheckoutInteractionStatus(status: string) {
  if (isSuccessfulSquareStatus(status)) {
    return "PAYMENT_COMPLETED";
  }

  if (status === "CANCELLED" || status === "EXPIRED") {
    return "ABANDONED";
  }

  // Square hosted checkout can report a failed card attempt while the same
  // hosted order remains retryable. Do not make that terminal for VCHRGD.
  return "PAYMENT_PENDING";
}

function isTopUpPaymentId(paymentId: string) {
  return /-(?:topup|balance)(?:-|$)/i.test(paymentId);
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") ?? "";
  const notificationUrl = getSquareConfig().webhookNotificationUrl || request.url;

  if (!verifySquareWebhookSignature(body, signature, notificationUrl)) {
    return NextResponse.json({ error: "Square webhook verification failed." }, { status: 400 });
  }

  try {
    const rawPayload = JSON.parse(body) as unknown;
    const event = normaliseSquareWebhookEvent(rawPayload);

    if (!event?.orderId && !event?.paymentId) {
      return NextResponse.json({ received: true });
    }

    let paymentReference = event.orderId || event.paymentId;
    let session = paymentReference
      ? await getPaymentSessionByProviderPaymentReference(paymentReference)
      : undefined;

    if (!session?.paymentId && event.paymentId && !event.orderId) {
      const paymentOrder = await resolveSquarePaymentOrderId(event.paymentId);
      if (paymentOrder.orderId) {
        paymentReference = paymentOrder.orderId;
        session = await getPaymentSessionByProviderPaymentReference(paymentReference);
      }
    }

    if (!session?.paymentId || !paymentReference) {
      return NextResponse.json({ received: true });
    }

    const resolved = await resolveSquareOrderPaymentStatus(paymentReference);
    const status = resolved.status || event.status || "PENDING";

    const updatedSession = await updateCardCheckoutStatus({
      paymentId: session.paymentId,
      // Keep the Square order ID as the durable hosted-checkout reference.
      // Individual failed card attempts can have their own payment IDs; if we
      // overwrite the order ID with one of those, later successful order
      // webhooks no longer resolve back to this VCHRGD session.
      providerPaymentReference: paymentReference,
      status,
    });
    if (updatedSession?.latestStatus?.status === "REFUNDED") {
      return NextResponse.json({ received: true, ignored: "Payment already refunded" });
    }

    const interactionStatus = getSquareCheckoutInteractionStatus(status);
    if (interactionStatus) {
      await updateCheckoutInteractionStatus(
        session.paymentId,
        interactionStatus,
        isSuccessfulSquareStatus(status)
          ? "Customer completed the secure Square checkout flow."
          : status === "CANCELLED"
            ? "Square checkout was cancelled before completion."
            : status === "EXPIRED"
              ? "Square checkout expired before completion."
              : "Square updated the checkout status; the hosted checkout may still be retryable.",
      );
    }

    if (isSuccessfulSquareStatus(status)) {
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
            `Square confirmed the separate card top-up of ${getOutstandingWorkflowBalance(workflow).toFixed(2)} following survey review.`,
            {
              paymentId: session.paymentId,
              completedAt: session.latestStatus?.updatedAt,
            },
          );
          await updateCheckoutInteractionStatus(
            workflow.sourcePaymentId,
            "PAYMENT_COMPLETED",
            "Square confirmed the separate card top-up following survey review.",
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

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to process Square webhook.",
      },
      { status: 400 },
    );
  }
}
