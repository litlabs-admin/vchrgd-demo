import { NextResponse } from "next/server";
import { getFrasersPlusConfig } from "@/lib/frasers-plus";
import { getFrasersPlusWebhookAuthStatus } from "@/lib/frasers-plus-webhook-auth";
import {
  getPaymentSessionByPaymentId,
  getPaymentSessionByUpr,
  storeAuthorizationWebhookEvent,
} from "@/lib/frasers-plus-merchant-state";
import { captureFrasersPlusAuthorization } from "@/lib/frasers-plus-capture";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import {
  completeSurveyWorkflowTopUp,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByPaymentId,
} from "@/lib/post-survey-workflows";
import {
  ensureJumptechProjectForOriginalPayment,
  markJumptechQuoteApprovedForWorkflow,
} from "@/lib/workflow-sync";

type AuthorizationWebhookPayload = {
  uniquePaymentReference?: string;
  type?: string;
  status?: string;
  paymentAmount?: {
    amount: number;
    currency: string;
  };
  actionDate?: string;
  metadata?: Record<string, string>;
};

export async function POST(request: Request) {
  const { webhookAuthValue } = getFrasersPlusConfig();
  const authorizationHeader = request.headers.get("authorization") ?? "";

  const authStatus = getFrasersPlusWebhookAuthStatus(webhookAuthValue, authorizationHeader);
  if (authStatus === 503) {
    return NextResponse.json({ error: "Webhook authentication is not configured" }, { status: 503 });
  }
  if (authStatus !== 200) {
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as AuthorizationWebhookPayload | null;

  if (
    !payload ||
    typeof payload.uniquePaymentReference !== "string" || !payload.uniquePaymentReference.trim() ||
    typeof payload.type !== "string" || !payload.type.trim() ||
    typeof payload.status !== "string" || !payload.status.trim()
  ) {
    return NextResponse.json(
      { error: "Missing uniquePaymentReference, type or status" },
      { status: 400 },
    );
  }

  const reference = payload.uniquePaymentReference;
  const metadataPaymentId = typeof payload.metadata?.paymentId === "string" ? payload.metadata.paymentId : undefined;
  const knownSession =
    (await getPaymentSessionByUpr(reference)) ??
    (metadataPaymentId ? await getPaymentSessionByPaymentId(metadataPaymentId) : undefined);
  // A shared live merchant may still have staging callbacks in flight. Never
  // create a production order from an unknown callback; let the provider retry.
  if (
    !knownSession ||
    knownSession.provider !== "FRASERS_PLUS" ||
    (knownSession.uniquePaymentReference && knownSession.uniquePaymentReference !== reference)
  ) {
    return NextResponse.json({ ok: false, error: "Webhook payment is not available in this environment" }, { status: 503 });
  }

  const session = await storeAuthorizationWebhookEvent({
    uniquePaymentReference: payload.uniquePaymentReference,
    type: payload.type,
    status: payload.status,
    paymentAmount: payload.paymentAmount,
    actionDate: payload.actionDate,
    metadata: payload.metadata,
    raw: payload,
  });

  if (
    (session.latestStatus?.status === "COMPLETED" || session.latestStatus?.status === "CANCELLED") &&
    ["CREDIT", "REVERSAL"].includes(session.latestStatus.currentType ?? "") &&
    (payload.type === "AUTHORIZATION" || payload.type === "CAPTURE")
  ) {
    return NextResponse.json({ ok: true, ignored: "Payment already refunded or reversed" });
  }

  let captureStatus: "NOT_REQUIRED" | "COMPLETED" | "FAILED" =
    payload.type === "CAPTURE" && payload.status === "COMPLETED"
      ? "COMPLETED"
      : "NOT_REQUIRED";
  if (
    payload.type === "AUTHORIZATION" &&
    (payload.status === "AUTHORISED" ||
      payload.status === "AUTHORIZED" ||
      payload.status === "APPROVED" ||
      payload.status === "COMPLETED")
  ) {
    const capture = await captureFrasersPlusAuthorization(
      new URL(request.url).origin,
      payload.uniquePaymentReference,
      session,
    );
    captureStatus = capture.ok ? "COMPLETED" : "FAILED";
  }

  if (captureStatus === "FAILED") {
    return NextResponse.json(
      { ok: false, error: "Capture could not be confirmed", captureStatus },
      { status: 502 },
    );
  }

  if (captureStatus === "COMPLETED") {
    const workflow = await getPostSurveyWorkflowByPaymentId(session.paymentId);
    const isTopUpPayment =
      workflow &&
      (workflow.topUpPaymentId === session.paymentId ||
        workflow.replacementPaymentId === session.paymentId);

    if (workflow && isTopUpPayment) {
      if (workflow.topUpPaymentStatus !== "COMPLETED") {
        await completeSurveyWorkflowTopUp(
          workflow.id,
          "system",
          `Customer completed the Frasers Plus top-up of ${getOutstandingWorkflowBalance(workflow).toFixed(2)}.`,
        );
        await updateCheckoutInteractionStatus(
          workflow.sourcePaymentId,
          "PAYMENT_COMPLETED",
          "Customer completed the separate Frasers Plus top-up following survey review.",
        );
        await markJumptechQuoteApprovedForWorkflow(workflow.id, "system");
      }
    } else {
      await updateCheckoutInteractionStatus(
        session.paymentId,
        "PAYMENT_COMPLETED",
        "Frasers Plus authorization was captured with the completed basket.",
      );
      await ensureJumptechProjectForOriginalPayment(session.paymentId);
    }
  }

  return NextResponse.json({
    ok: true,
    uniquePaymentReference: session.uniquePaymentReference,
    paymentId: session.paymentId,
    captureStatus,
  });
}
