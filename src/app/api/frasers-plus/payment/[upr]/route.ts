import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  mapPaymentStateToCheckoutInteractionStatus,
  updateCheckoutInteractionStatus,
} from "@/lib/checkout-interactions";
import {
  getPaymentSessionByPaymentId,
  getPaymentSessionByUpr,
  updateFrasersPlusPaymentState,
  type PaymentSession,
} from "@/lib/frasers-plus-merchant-state";
import { captureFrasersPlusAuthorization } from "@/lib/frasers-plus-capture";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import { isSameOriginMutationRequest } from "@/lib/request-guards";
import {
  completeSurveyWorkflowTopUp,
  failSurveyWorkflowTopUp,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowByPaymentId,
} from "@/lib/post-survey-workflows";
import {
  frasersPlusRequest,
  getFrasersPlusConfig,
} from "@/lib/frasers-plus";
import {
  ensureJumptechProjectForOriginalPayment,
  markJumptechQuoteApprovedForWorkflow,
} from "@/lib/workflow-sync";

type Context = {
  params: Promise<{
    upr: string;
  }>;
};

function isSuccessfulFrasersStatus(status?: string) {
  return (
    status === "AUTHORISED" ||
    status === "AUTHORIZED" ||
    status === "APPROVED" ||
    status === "COMPLETED"
  );
}

function readPaymentResult(data: unknown) {
  return data && typeof data === "object"
    ? (data as { type?: string; currentType?: string; status?: string })
    : {};
}

async function captureApprovedAuthorization(
  origin: string,
  upr: string,
  data: unknown,
  session?: PaymentSession,
) {
  const payment = readPaymentResult(data);
  const type = payment.type ?? payment.currentType ?? session?.latestStatus?.currentType;
  if (!isSuccessfulFrasersStatus(payment.status) || type !== "AUTHORIZATION") {
    return { data, session };
  }

  const capture = await captureFrasersPlusAuthorization(origin, upr, session);
  if (!capture.ok) {
    return {
      data: {
        ...(data && typeof data === "object" ? data : {}),
        status: "PENDING",
        authorizationStatus: payment.status,
        captureStatus: "FAILED",
        captureError: capture.data,
      },
      session,
    };
  }

  return {
    data: {
      ...(data && typeof data === "object" ? data : {}),
      ...(capture.data && typeof capture.data === "object" ? capture.data : {}),
      type: "CAPTURE",
      currentType: "CAPTURE",
      status: "COMPLETED",
      captureStatus: "COMPLETED",
    },
    session: capture.session ?? session,
  };
}

export async function GET(request: Request, context: Context) {
  const { upr } = await context.params;
  const { useMock } = getFrasersPlusConfig();
  const { searchParams } = new URL(request.url);
  const paymentId = searchParams.get("paymentId") ?? "";
  const returnToken = searchParams.get("rt") ?? "";
  const adminAuthenticated = await isAdminAuthenticated();
  const session =
    (await getPaymentSessionByUpr(upr)) ??
    (paymentId ? await getPaymentSessionByPaymentId(paymentId) : undefined);
  const hasValidReturnToken =
    Boolean(session?.paymentId) &&
    session?.uniquePaymentReference === upr &&
    paymentId === session?.paymentId &&
    verifyFrasersPlusReturnToken(paymentId, returnToken);

  if (!adminAuthenticated && !hasValidReturnToken) {
    return NextResponse.json({ error: "Unauthorized payment status request" }, { status: 401 });
  }

  if (useMock) {
    const origin = new URL(request.url).origin;
    const response = await fetch(`${origin}/api/mock-tymit/payment/${upr}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "test-api-token",
      },
      cache: "no-store",
    });
    let data = await response.json();
    let capturedSession = session;
    if (response.ok) {
      const capture = await captureApprovedAuthorization(
        new URL(request.url).origin,
        upr,
        data,
        session,
      );
      data = capture.data;
      capturedSession = capture.session;
    }
    const nextSession =
      response.ok && data?.status
        ? await updateFrasersPlusPaymentState({
            uniquePaymentReference: upr,
            paymentId: capturedSession?.paymentId,
            currentType: data.type ?? data.currentType,
            status: data.status,
          })
        : capturedSession;
    const interactionStatus =
      typeof data?.status === "string" ? mapPaymentStateToCheckoutInteractionStatus(data.status) : null;
    if (interactionStatus && nextSession?.paymentId) {
      await updateCheckoutInteractionStatus(
        nextSession.paymentId,
        interactionStatus,
        interactionStatus === "PAYMENT_COMPLETED"
          ? "Customer completed the Frasers Plus approval flow."
          : interactionStatus === "PAYMENT_PENDING"
            ? "Customer entered the secure Frasers Plus approval flow and payment is still pending."
        : "Customer did not complete the Frasers Plus approval flow.",
      );
    }
    const workflow = nextSession?.paymentId
      ? await getPostSurveyWorkflowByPaymentId(nextSession.paymentId)
      : undefined;
    const isTopUpPayment =
      workflow &&
      (workflow.topUpPaymentId === nextSession?.paymentId ||
        workflow.replacementPaymentId === nextSession?.paymentId);
    if (workflow && isTopUpPayment && typeof data?.status === "string") {
      if (
        (data.status === "APPROVED" || data.status === "COMPLETED") &&
        workflow.topUpPaymentStatus !== "COMPLETED"
      ) {
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
      } else if (
        data.status === "DECLINED" &&
        workflow.topUpPaymentStatus !== "FAILED"
      ) {
        await failSurveyWorkflowTopUp(workflow.id, "system", {
          status: "FAILED",
          detail: "The Frasers Plus top-up was not approved. The customer can choose another payment route or cancel for a refund.",
        });
      } else if (
        data.status === "CANCELLED" &&
        workflow.topUpPaymentStatus !== "CANCELLED"
      ) {
        await failSurveyWorkflowTopUp(workflow.id, "system", {
          status: "CANCELLED",
          detail: "The Frasers Plus top-up was cancelled before authorisation completed.",
        });
      }
    }
    if (
      nextSession?.paymentId &&
      !isTopUpPayment &&
      typeof data?.status === "string" &&
      isSuccessfulFrasersStatus(data.status)
    ) {
      await ensureJumptechProjectForOriginalPayment(nextSession.paymentId);
    }
    return NextResponse.json(
      {
        ...data,
        latestAuthorizationWebhook: nextSession?.latestAuthorizationWebhook ?? session?.latestAuthorizationWebhook,
      },
      { status: response.status },
    );
  }

  const { response, data: providerData } = await frasersPlusRequest(`/v1/payment/${upr}`, {
    method: "GET",
  });
  let data = providerData;
  let capturedSession = session;
  if (response.ok) {
    const capture = await captureApprovedAuthorization(
      new URL(request.url).origin,
      upr,
      data,
      session,
    );
    data = capture.data;
    capturedSession = capture.session;
  }

  const nextSession =
    response.ok &&
    data &&
    typeof data === "object" &&
    "status" in data &&
    typeof data.status === "string"
      ? await updateFrasersPlusPaymentState({
          uniquePaymentReference: upr,
          paymentId: capturedSession?.paymentId,
          currentType:
            "type" in data && typeof data.type === "string" ? data.type : undefined,
          status: data.status,
        })
      : capturedSession;
  const interactionStatus =
    response.ok &&
    data &&
    typeof data === "object" &&
    "status" in data &&
    typeof data.status === "string"
      ? mapPaymentStateToCheckoutInteractionStatus(data.status)
      : null;
  if (interactionStatus && nextSession?.paymentId) {
    await updateCheckoutInteractionStatus(
      nextSession.paymentId,
      interactionStatus,
      interactionStatus === "PAYMENT_COMPLETED"
        ? "Customer completed the Frasers Plus approval flow."
        : interactionStatus === "PAYMENT_PENDING"
          ? "Customer entered the secure Frasers Plus approval flow and payment is still pending."
      : "Customer did not complete the Frasers Plus approval flow.",
    );
  }
  const workflow = nextSession?.paymentId
    ? await getPostSurveyWorkflowByPaymentId(nextSession.paymentId)
    : undefined;
  const isTopUpPayment =
    workflow &&
    (workflow.topUpPaymentId === nextSession?.paymentId ||
      workflow.replacementPaymentId === nextSession?.paymentId);
  if (
    workflow &&
    isTopUpPayment &&
    data &&
    typeof data === "object" &&
    "status" in data &&
    typeof data.status === "string"
  ) {
    if (
      (data.status === "APPROVED" || data.status === "COMPLETED") &&
      workflow.topUpPaymentStatus !== "COMPLETED"
    ) {
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
    } else if (
      data.status === "DECLINED" &&
      workflow.topUpPaymentStatus !== "FAILED"
    ) {
      await failSurveyWorkflowTopUp(workflow.id, "system", {
        status: "FAILED",
        detail: "The Frasers Plus top-up was not approved. The customer can choose another payment route or cancel for a refund.",
      });
    } else if (
      data.status === "CANCELLED" &&
      workflow.topUpPaymentStatus !== "CANCELLED"
    ) {
      await failSurveyWorkflowTopUp(workflow.id, "system", {
        status: "CANCELLED",
        detail: "The Frasers Plus top-up was cancelled before authorisation completed.",
      });
    }
  }
  if (
    nextSession?.paymentId &&
    !isTopUpPayment &&
    data &&
    typeof data === "object" &&
    "status" in data &&
    typeof data.status === "string" &&
    isSuccessfulFrasersStatus(data.status)
  ) {
    await ensureJumptechProjectForOriginalPayment(nextSession.paymentId);
  }
  return NextResponse.json(
    {
      ...(data && typeof data === "object" ? data : { data }),
      latestAuthorizationWebhook:
        nextSession?.latestAuthorizationWebhook ?? session?.latestAuthorizationWebhook,
    },
    { status: response.status },
  );
}

export async function PUT(request: Request, context: Context) {
  if (!isSameOriginMutationRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { upr } = await context.params;
  const adminAuthenticated = await isAdminAuthenticated();

  if (!adminAuthenticated) {
    return NextResponse.json({ error: "Unauthorized payment update request" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "A payment update is required." }, { status: 400 });
  }
  // Credits/reversals must use the confirmation, dedupe and reconciliation
  // controls in the back-office refund workflow, including on demo deployments.
  if (["CREDIT", "REVERSAL"].includes(payload.type)) {
    return NextResponse.json({ error: "Use the back-office refund workflow to refund or reverse this payment." }, { status: 409 });
  }
  if (payload.type !== "CAPTURE") return NextResponse.json({ error: "Unsupported payment update." }, { status: 400 });
  const session = await getPaymentSessionByUpr(upr);
  if (!session || session.provider !== "FRASERS_PLUS") return NextResponse.json({ error: "Payment session not found." }, { status: 404 });
  if (!Number.isFinite(session.amount) || payload.paymentAmount?.amount !== session.amount || payload.paymentAmount?.currency !== (session.currency || "GBP")) {
    return NextResponse.json({ error: "Capture must match the recorded order amount and currency." }, { status: 409 });
  }
  try {
    const capture = await captureFrasersPlusAuthorization(new URL(request.url).origin, upr, session);
    if (!capture.ok) return NextResponse.json({ error: "Capture has not been confirmed. Reconcile the existing payment before retrying." }, { status: 502 });
    await updateCheckoutInteractionStatus(session.paymentId, "PAYMENT_COMPLETED", "Merchant capture was confirmed by Frasers Plus.");
    await ensureJumptechProjectForOriginalPayment(session.paymentId);
    return NextResponse.json(capture.data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Capture outcome is unconfirmed. Reconcile the existing payment before retrying." }, { status: 502 });
  }
}
