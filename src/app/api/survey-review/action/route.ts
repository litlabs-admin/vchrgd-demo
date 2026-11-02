import { NextResponse } from "next/server";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import { sendUniqueGoogleChatNotification } from "@/lib/google-chat-notifications";
import {
  canCustomerRequestCancellation,
  getPostSurveyWorkflowByToken,
  getOutstandingWorkflowBalance,
  isSurveyReviewLinkExpired,
  markSurveyWorkflowBalancePending,
  markSurveyWorkflowBooked,
  requestSurveyWorkflowRefund,
} from "@/lib/post-survey-workflows";
import { isSameOriginRequest } from "@/lib/request-guards";

function buildBaseRedirect(request: Request, token: string, path = "") {
  return new URL(`/survey-review/${encodeURIComponent(token)}${path}`, request.url);
}

function formatCurrency(amount: number | undefined) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(typeof amount === "number" ? amount : 0);
}

function buildCancellationRequestMessage({
  workflow,
  reason,
  request,
}: {
  workflow: NonNullable<Awaited<ReturnType<typeof getPostSurveyWorkflowByToken>>>;
  reason: string;
  request: Request;
}) {
  const customerLink = new URL(
    `/survey-review/${encodeURIComponent(workflow.reviewToken || "")}`,
    request.url,
  );

  return [
    "Cancellation / refund requested",
    `Order: ${workflow.sourcePaymentId}`,
    workflow.jumptech?.projectId ? `Jumptech project: ${workflow.jumptech.projectId}` : null,
    `Customer: ${workflow.customerName || "Not provided"}`,
    `Email: ${workflow.customerEmail || "Not provided"}`,
    `Phone: ${workflow.customerPhone || "Not provided"}`,
    `Charger: ${workflow.chargerName || "Not provided"}`,
    `Original amount: ${formatCurrency(workflow.originalAmount)}`,
    workflow.amendedAmount !== undefined
      ? `Current/revised amount: ${formatCurrency(workflow.amendedAmount)}`
      : null,
    `Payment route: ${workflow.paymentChoice || workflow.provider || "Not selected"}`,
    `Reason: ${reason}`,
    `Customer link: ${customerLink.toString()}`,
    "Next step: review the Refunds requested tab and process the refund or reversal if approved.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const action = String(formData.get("action") || "");
  const token = String(formData.get("token") || "");

  if (!token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const workflow = await getPostSurveyWorkflowByToken(token);
  if (!workflow || isSurveyReviewLinkExpired(workflow)) {
    const expiredUrl = buildBaseRedirect(request, token);
    expiredUrl.searchParams.set("state", "expired");
    return NextResponse.redirect(expiredUrl, 303);
  }

  if (action === "decline") {
    if (!canCustomerRequestCancellation(workflow)) {
      const unavailableUrl = buildBaseRedirect(request, token);
      unavailableUrl.searchParams.set("state", "cancel-unavailable");
      return NextResponse.redirect(unavailableUrl, 303);
    }

    const reason =
      String(formData.get("reason") || "").trim() ||
      "Customer did not accept the revised installation cost.";
    await requestSurveyWorkflowRefund(workflow.id, "customer", reason);
    await updateCheckoutInteractionStatus(
      workflow.sourcePaymentId,
      "ABANDONED",
      "Customer requested order cancellation from the post-survey status page.",
    );
    await sendUniqueGoogleChatNotification(
      `customer-cancellation-request:${workflow.id}:${workflow.sourcePaymentId}`,
      buildCancellationRequestMessage({ workflow, reason, request }),
    );
    const declineUrl = buildBaseRedirect(request, token);
    declineUrl.searchParams.set("state", "declined");
    return NextResponse.redirect(declineUrl, 303);
  }

  if (action !== "accept") {
    return NextResponse.redirect(buildBaseRedirect(request, token), 303);
  }

  const amountToCollect = getOutstandingWorkflowBalance(workflow);

  if (amountToCollect > 0.01) {
    await markSurveyWorkflowBalancePending(
      workflow.id,
      "customer",
      `Customer accepted the revised quote and now needs to confirm a separate additional payment of ${amountToCollect.toFixed(2)}.`,
    );
    return NextResponse.redirect(buildBaseRedirect(request, token, "/pay-balance"), 303);
  }

  await markSurveyWorkflowBooked(
    workflow.id,
    "customer",
    "Customer accepted the revised quote with no further payment required.",
  );
  await updateCheckoutInteractionStatus(
    workflow.sourcePaymentId,
    "PAYMENT_COMPLETED",
    "Customer accepted the revised survey terms with no further payment required.",
  );
  return NextResponse.redirect(buildBaseRedirect(request, token, "/success"), 303);
}
