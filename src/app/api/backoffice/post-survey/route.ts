import { NextResponse } from "next/server";
import { deleteCheckoutInteractionsForPaymentIds } from "@/lib/checkout-interactions";
import { getAdminSession, isAdminAuthenticated } from "@/lib/admin-auth";
import {
  deletePaymentSessionsForPaymentIds,
  recordAdminAuditEvent,
} from "@/lib/frasers-plus-merchant-state";
import {
  approveSurveyWorkflowForBooking,
  confirmSurveyReceived,
  deletePostSurveyWorkflow,
  markSurveyWorkflowBookedForInstallation,
  markSurveyWorkflowInstalled,
  prepareSurveyReviewLink,
  updateSurveyWorkflowChargerDispatch,
  getOutstandingWorkflowBalance,
  getPostSurveyWorkflowById,
} from "@/lib/post-survey-workflows";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";
import { deleteWorkOrderForWorkflow, markWorkOrderSent } from "@/lib/work-orders";
import { sendUniqueGoogleChatNotification } from "@/lib/google-chat-notifications";
import { getInstallerById } from "@/lib/installers";

function redirectToSurveyTab(request: Request, returnTo?: string | null) {
  return NextResponse.redirect(
    getSafeInternalRedirect(request, returnTo, "/backoffice?tab=survey"),
    303,
  );
}

function redirectToBookingTab(request: Request, returnTo?: string | null) {
  return NextResponse.redirect(
    getSafeInternalRedirect(
      request,
      returnTo,
      "/backoffice?tab=booking",
    ),
    303,
  );
}

function parseOptionalAmount(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  const formData = await request.formData();
  const action = String(
    formData.get("action") || new URL(request.url).searchParams.get("action") || "",
  );
  const workflowId = String(formData.get("workflowId") || "");
  const returnTo = String(formData.get("returnTo") || "");
  const bookingReturnTo = String(formData.get("bookingReturnTo") || "");
  const actor = "backoffice-admin";

  if (!workflowId) {
    return redirectToSurveyTab(request, returnTo);
  }

  if (action === "delete-workflow") {
    const deletedWorkflow = await deletePostSurveyWorkflow(workflowId);

    if (deletedWorkflow) {
      const linkedPaymentIds = Array.from(
        new Set(
          [
            deletedWorkflow.sourcePaymentId,
            deletedWorkflow.currentPaymentId,
            deletedWorkflow.topUpPaymentId,
            deletedWorkflow.replacementPaymentId,
          ].filter((value): value is string => Boolean(value)),
        ),
      );

      const [deletedInteractions, deletedSessions, deletedWorkOrder] = await Promise.all([
        deleteCheckoutInteractionsForPaymentIds(linkedPaymentIds),
        deletePaymentSessionsForPaymentIds(linkedPaymentIds),
        deleteWorkOrderForWorkflow(workflowId),
      ]);

      await recordAdminAuditEvent({
        action: "backoffice.post_survey.deleted",
        actor,
        detail: `Workflow ${workflowId} removed from back office. Removed ${deletedInteractions} checkout interaction(s), ${deletedSessions} payment session(s), and ${deletedWorkOrder ? "1" : "0"} work order(s).`,
      });
    }

    return NextResponse.redirect(
      getSafeInternalRedirect(request, returnTo, "/backoffice?tab=survey"),
      303,
    );
  }

  if (action === "confirm-survey") {
    await confirmSurveyReceived(
      workflowId,
      actor,
      String(formData.get("surveyAdminNotes") || "").trim() || undefined,
    );
    await recordAdminAuditEvent({
      action: "backoffice.post_survey.confirmed",
      actor,
      detail: `Survey marked as received for workflow ${workflowId}.`,
    });
    return redirectToSurveyTab(request, returnTo);
  }

  if (action === "approve-booking") {
    await approveSurveyWorkflowForBooking(
      workflowId,
      actor,
      String(formData.get("surveyAdminNotes") || "").trim() ||
        "Ops approved the order to move into the booking queue.",
    );
    await recordAdminAuditEvent({
      action: "backoffice.post_survey.booking_ready",
      actor,
      detail: `Workflow ${workflowId} moved to orders for booking.`,
    });
    return redirectToBookingTab(request, bookingReturnTo || returnTo);
  }

  if (action === "mark-booked") {
    const workflow = await getPostSurveyWorkflowById(workflowId);
    const outstandingBalance = workflow ? getOutstandingWorkflowBalance(workflow) : 0;
    if (outstandingBalance > 0.01) {
      await recordAdminAuditEvent({
        action: "backoffice.post_survey.booking_blocked_unpaid_balance",
        actor,
        detail: `Workflow ${workflowId} could not be booked because ${outstandingBalance.toFixed(2)} remains unpaid.`,
      });
      const blockedUrl = getSafeInternalRedirect(
        request,
        bookingReturnTo || returnTo,
        "/backoffice?tab=booking",
      );
      blockedUrl.searchParams.set(
        "bookingError",
        `Collect the outstanding balance of £${outstandingBalance.toFixed(2)} before booking this order.`,
      );
      return NextResponse.redirect(blockedUrl, 303);
    }

    await markSurveyWorkflowBookedForInstallation(workflowId, actor, {
      installationDate: String(formData.get("installationDate") || ""),
      installerName: String(formData.get("installerName") || ""),
      installerEmail: String(formData.get("installerEmail") || ""),
      installerPhone: String(formData.get("installerPhone") || ""),
      installerNotes: String(formData.get("installerNotes") || ""),
    });
    await recordAdminAuditEvent({
      action: "backoffice.post_survey.booked_installation",
      actor,
      detail: `Workflow ${workflowId} was booked for installation.`,
    });
    return NextResponse.redirect(
      getSafeInternalRedirect(request, bookingReturnTo || returnTo, "/backoffice?tab=booking"),
      303,
    );
  }

  if (action === "save-dispatch") {
    const dispatched = formData.get("chargerDispatched") === "on";
    const expectedDeliveryDate = String(formData.get("chargerExpectedDeliveryDate") || "");
    await updateSurveyWorkflowChargerDispatch(workflowId, actor, {
      dispatched,
      expectedDeliveryDate,
    });
    await recordAdminAuditEvent({
      action: dispatched
        ? "backoffice.post_survey.charger_dispatched"
        : "backoffice.post_survey.charger_dispatch_cleared",
      actor,
      detail: dispatched
        ? `Workflow ${workflowId} was marked as charger dispatched.`
        : `Workflow ${workflowId} charger dispatch was cleared.`,
    });
    return NextResponse.redirect(
      getSafeInternalRedirect(request, bookingReturnTo || returnTo, "/backoffice?tab=booking"),
      303,
    );
  }

  if (action === "mark-po-sent") {
    if (formData.get("poSent") !== "on") {
      return redirectToBookingTab(request, bookingReturnTo || returnTo);
    }

    const [session, workflow] = await Promise.all([
      getAdminSession(),
      getPostSurveyWorkflowById(workflowId),
    ]);
    if (!session?.sub || !workflow) {
      return redirectToBookingTab(request, bookingReturnTo || returnTo);
    }

    const result = await markWorkOrderSent(workflowId, session.sub);
    if (result.changed) {
      const installer = await getInstallerById(result.record.installerId);
      await Promise.all([
        sendUniqueGoogleChatNotification(
          `work-order-sent:${workflowId}:${result.record.purchaseOrderNumber}`,
          [
            "Installer PO sent",
            `PO: ${result.record.purchaseOrderNumber}`,
            `Order reference: ${workflow.sourcePaymentId}`,
            `Customer: ${workflow.customerName || "Not available"}`,
            `Installer: ${installer?.legalName || workflow.installerName || "Not available"}`,
            `Confirmed by: ${session.sub}`,
          ].join("\n"),
        ),
        recordAdminAuditEvent({
          action: "backoffice.work_order.sent",
          actor: session.sub,
          detail: `PO ${result.record.purchaseOrderNumber} marked as sent for workflow ${workflowId}.`,
        }),
      ]);
    }

    return NextResponse.redirect(
      getSafeInternalRedirect(request, bookingReturnTo || returnTo, "/backoffice?tab=booking"),
      303,
    );
  }

  if (action === "mark-installed") {
    await markSurveyWorkflowInstalled(
      workflowId,
      actor,
      "Installation marked as installed by backoffice.",
    );
    await recordAdminAuditEvent({
      action: "backoffice.post_survey.installed",
      actor,
      detail: `Workflow ${workflowId} was marked installed.`,
    });
    return NextResponse.redirect(
      getSafeInternalRedirect(request, returnTo, "/backoffice?tab=installed"),
      303,
    );
  }

  if (action === "save-review") {
    const expiresInHours = Number(formData.get("expiresInHours") || "72");
    await prepareSurveyReviewLink(workflowId, actor, {
      amendedAmount: parseOptionalAmount(formData.get("amendedAmount")),
      amendmentNotes: String(formData.get("amendmentNotes") || ""),
      adminNotes: String(formData.get("reviewAdminNotes") || ""),
      expiresInHours: Number.isFinite(expiresInHours) ? expiresInHours : 72,
    });
    await recordAdminAuditEvent({
      action: "backoffice.post_survey.link_generated",
      actor,
      detail: `Review link generated for workflow ${workflowId}.`,
    });
  }

  return redirectToSurveyTab(request, returnTo);
}
