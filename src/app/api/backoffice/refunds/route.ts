import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { tryReserveDedupeKey, releaseDedupeKey } from "@/lib/server-data";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { processProviderRefund, validateProviderRefund } from "@/lib/backoffice-provider-refunds";
import {
  approveSurveyWorkflowRefund,
  completeSurveyWorkflowManualRefund,
  completeSurveyWorkflowRefund,
  getPostSurveyWorkflowById,
  recordSurveyWorkflowRefundProviderResult,
  rejectSurveyWorkflowRefund,
  requestSurveyWorkflowRefund,
} from "@/lib/post-survey-workflows";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";

function redirectToRefundsTab(request: Request, returnTo?: string | null) {
  const url = getSafeInternalRedirect(request, returnTo, "/backoffice?tab=refunds");
  url.searchParams.delete("refundError");
  return NextResponse.redirect(
    url,
    303,
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  if (!session) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  const formData = await request.formData();
  const action = String(formData.get("action") || "");
  const workflowId = String(formData.get("workflowId") || "");
  const returnTo = String(formData.get("returnTo") || "");
  const actor = session.sub;
  const fail = (message: string) => {
    const url = getSafeInternalRedirect(request, returnTo, "/backoffice?tab=refunds");
    url.searchParams.set("refundError", message);
    return NextResponse.redirect(url, 303);
  };

  if (!workflowId) {
    return redirectToRefundsTab(request, returnTo);
  }

  if (!["request-refund", "reject-refund", "manual-refund-completed", "approve-refund", "check-provider-refund"].includes(action)) return fail("Unknown refund action.");
  if (!await tryReserveDedupeKey("backoffice-refund-action", workflowId)) return fail("A refund action is already running for this order. Please wait and refresh.");
  try {
  const workflow = await getPostSurveyWorkflowById(workflowId);
  if (!workflow) {
    return redirectToRefundsTab(request, returnTo);
  }
  if (workflow.refundStatus === "COMPLETED") return redirectToRefundsTab(request, returnTo);
  if (workflow.refundStatus === "APPROVED" && workflow.refundProviderResult !== "FAILED" && action !== "check-provider-refund" && !(action === "manual-refund-completed" && formData.get("providerOutcomeVerified") === "yes")) return fail("A provider refund has already been approved. Check its outcome before recording another refund.");

  if (action === "request-refund") {
    const reason = String(
      formData.get("adminNotes") ||
        "Back office requested cancellation review and a refund of the original payment.",
    ).trim();
    await requestSurveyWorkflowRefund(workflowId, actor, reason);
    await recordAdminAuditEvent({
      action: "backoffice.refund.requested",
      actor,
      detail: `Refund review requested for workflow ${workflowId}. No provider refund call was made. ${reason}`,
    });
    return redirectToRefundsTab(request, returnTo);
  }

  if (action === "reject-refund") {
    const reason = String(formData.get("adminNotes") || "Refund request rejected.").trim();
    await rejectSurveyWorkflowRefund(workflowId, actor, reason);
    await recordAdminAuditEvent({
      action: "backoffice.refund.rejected",
      actor,
      detail: `Refund rejected for workflow ${workflowId}. ${reason}`,
    });
    return redirectToRefundsTab(request, returnTo);
  }

  if (action === "manual-refund-completed") {
    const note = String(formData.get("adminNotes") || "").trim();
    const reference = String(formData.get("refundReference") || "").trim();
    const method = String(formData.get("refundMethod") || "");
    const refundedOn = String(formData.get("refundDate") || "");
    const amountText = String(formData.get("refundAmount") || "");
    const amount = Number(amountText);
    const expectedAmount = workflow.originalAmount + (workflow.topUpPaymentStatus === "COMPLETED" ? Math.max((workflow.amendedAmount ?? workflow.originalAmount) - workflow.originalAmount, 0) : 0);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const date = new Date(`${refundedOn}T00:00:00Z`);
    if (formData.get("refundConfirmed") !== "yes") return fail("Confirm that the full external refund has already completed.");
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== Math.round(expectedAmount * 100)) return fail("Enter the full recorded payment amount, excluding unpaid extra costs. Partial refunds cannot close this order.");
    if (!["BANK_TRANSFER", "PROVIDER_DASHBOARD", "OTHER"].includes(method) || !reference || reference.length > 120 || !note || note.length > 2000) return fail("Provide a refund method, reference and reason (within the field limits).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(refundedOn) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== refundedOn || refundedOn > today) return fail("Enter a valid refund date that is not in the future.");
    const detail = `${amount.toFixed(2)} GBP refunded externally on ${refundedOn} via ${method}; reference ${reference}. ${note}`;
    await completeSurveyWorkflowManualRefund(workflowId, actor, note, {
      amount, method: method as "BANK_TRANSFER" | "PROVIDER_DASHBOARD" | "OTHER", reference, refundedOn,
    });
    await updateCheckoutInteractionStatus(
      workflow.sourcePaymentId,
      "ABANDONED",
      "Backoffice marked the cancellation as manually refunded outside the VCHRGD provider workflow.",
    );
    await recordAdminAuditEvent({
      action: "backoffice.refund.manual_completed",
      actor,
      detail: `Refund manually marked as completed for workflow ${workflowId} (${workflow.sourcePaymentId}). No provider refund API call was made. ${detail}`,
    });
    return redirectToRefundsTab(request, returnTo);
  }

  if (action === "approve-refund" || action === "check-provider-refund") {
    if (action === "check-provider-refund" && workflow.refundStatus !== "APPROVED") return fail("There is no submitted provider refund to check.");
    if (action === "approve-refund") {
      const reason = String(formData.get("adminNotes") || "").trim();
      const displayedAmount = String(formData.get("providerRefundAmount") || "");
      if (formData.get("providerRefundConfirmed") !== "yes" || !reason || reason.length > 2000) return fail("Confirm the provider refund and enter the reason before continuing.");
      if (displayedAmount !== workflow.originalAmount.toFixed(2)) return fail("The order amount changed. Refresh and review it before refunding.");
      const validationError = await validateProviderRefund(workflow);
      if (validationError) return fail(validationError);
      await requestSurveyWorkflowRefund(workflowId, actor, reason);
      await approveSurveyWorkflowRefund(workflowId, actor, `Confirmed provider refund of ${workflow.originalAmount.toFixed(2)} GBP. ${reason}`);
      await recordAdminAuditEvent({ action: "backoffice.refund.provider_submitted", actor, detail: `Provider refund authorised for ${workflow.sourcePaymentId}: ${workflow.originalAmount.toFixed(2)} GBP. ${reason}` });
    }
    const result = await processProviderRefund(workflow, action === "check-provider-refund");
    await recordSurveyWorkflowRefundProviderResult(workflowId, actor, {
      succeeded: result.outcome === "COMPLETED",
      outcome: result.outcome,
      reference: result.reference,
      action: workflow.provider === "FRASERS_PLUS" ? "CREDIT_OR_REVERSAL" : "REFUND",
      detail: result.detail,
    });

    if (result.outcome === "COMPLETED") {
      await completeSurveyWorkflowRefund(
        workflowId,
        actor,
        `Refund completed through ${workflow.provider === "FRASERS_PLUS" ? "Frasers Plus" : "card"} flow.`,
      );
      await updateCheckoutInteractionStatus(
        workflow.sourcePaymentId,
        "ABANDONED",
        "Backoffice approved the customer cancellation and completed the refund or reversal flow.",
      );
      await recordAdminAuditEvent({
        action: "backoffice.refund.completed",
        actor,
        detail: `Refund completed for workflow ${workflowId}. ${result.detail}`,
      });
    } else {
      await recordAdminAuditEvent({
        action: `backoffice.refund.${result.outcome.toLowerCase()}`,
        actor,
        detail: `Provider refund ${result.outcome.toLowerCase()} for workflow ${workflowId}. ${result.detail}`,
      });
      if (result.outcome === "FAILED" || result.outcome === "UNKNOWN") return fail(result.detail);
    }
  }

  return redirectToRefundsTab(request, returnTo);
  } finally {
    await releaseDedupeKey("backoffice-refund-action", workflowId);
  }
}
