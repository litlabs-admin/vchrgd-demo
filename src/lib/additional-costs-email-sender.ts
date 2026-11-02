import { getCustomerAppUrl } from "@/lib/app-url";
import { renderAdditionalCostsEmail } from "@/lib/additional-costs-email";
import { isValidEmailAddress } from "@/lib/email-validation";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { isGmailSenderConfigured, sendGmailMessage } from "@/lib/gmail-sender";
import {
  buildSurveyReviewUrl,
  canPayWorkflowBalance,
  getOutstandingWorkflowBalance,
  getResolvedWorkflowAmount,
  isWorkflowBooked,
  recordAdditionalCostsEmailFailure,
  recordAdditionalCostsEmailSent,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";
import { releaseDedupeKey, tryReserveDedupeKey } from "@/lib/server-data";

const DEDUPE_SCOPE = "additional-costs-email";

type AdditionalCostsEmailSendResult = {
  state: "sent" | "disabled" | "ineligible" | "duplicate";
  orderReference: string;
  customerName?: string;
  recipient?: string;
  balance: number;
  messageId?: string;
  reason?: string;
};

function clean(value: string | null | undefined) {
  return value?.trim() || "";
}

function normaliseStatus(value?: string) {
  return clean(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function isEnabled() {
  return process.env.ADDITIONAL_COSTS_EMAILS_ENABLED === "true";
}

export function isQuoteApprovedJumptechStatus(status?: string, currentStatusLabel?: string) {
  return [status, currentStatusLabel].some((value) =>
    normaliseStatus(value).includes("QUOTE_APPROVED"),
  );
}

export function getAdditionalCostsEmailIneligibilityReason(
  workflow: SurveyWorkflow,
  { allowProgressedOrder = false }: { allowProgressedOrder?: boolean } = {},
) {
  const balance = getOutstandingWorkflowBalance(workflow);
  const recipient = clean(workflow.customerEmail);

  if (
    !isQuoteApprovedJumptechStatus(
      workflow.jumptech?.status,
      workflow.jumptech?.currentStatusLabel,
    ) &&
    !(allowProgressedOrder && (workflow.bookingApprovedAt || isWorkflowBooked(workflow)))
  ) {
    return "Jumptech status is not QUOTE APPROVED.";
  }

  if (balance <= 0.01) {
    return "There is no unpaid additional balance.";
  }

  if (!isValidEmailAddress(recipient)) {
    return "The customer email address is missing or invalid.";
  }

  if (!workflow.reviewToken) {
    return "The customer progress link is unavailable.";
  }

  if (
    workflow.surveyStatus === "DECLINED" ||
    workflow.refundStatus === "REQUESTED" ||
    workflow.refundStatus === "APPROVED" ||
    workflow.refundStatus === "COMPLETED"
  ) {
    return "The order is cancelled or in the refund workflow.";
  }

  if (!canPayWorkflowBalance(workflow)) {
    return "The order has no available balance-payment action.";
  }

  if (
    workflow.additionalCostsEmailSentAt &&
    Math.abs((workflow.additionalCostsEmailSentAmount ?? 0) - balance) < 0.005
  ) {
    return "An additional costs email has already been sent for this balance.";
  }

  return null;
}

function getFirstName(customerName?: string) {
  return clean(customerName).split(/\s+/)[0] || "there";
}

function getInstallationPostcode(workflow: SurveyWorkflow) {
  return clean(workflow.deliveryAddress?.postalCode || workflow.billingAddress?.postalCode) || "-";
}

function getExplanation(workflow: SurveyWorkflow) {
  const detail = [workflow.additionalInstallationCostDetail, workflow.amendmentNotes]
    .map(clean)
    .find((value) => value && !/^(?:GBP\s*)?£?\s*[\d,]+(?:\.\d{1,2})?$/i.test(value));
  return (
    detail ||
    "Your survey identified installation work outside the standard installation allowance. The balance shown covers the additional work required to complete the installation safely and to the required standard."
  );
}

export async function sendAdditionalCostsEmailForWorkflow({
  workflow,
  requestUrl,
  oidcToken,
  allowProgressedOrder = false,
}: {
  workflow: SurveyWorkflow;
  requestUrl?: string;
  oidcToken?: string | null;
  allowProgressedOrder?: boolean;
}): Promise<AdditionalCostsEmailSendResult> {
  const balance = getOutstandingWorkflowBalance(workflow);
  const baseResult = {
    orderReference: workflow.sourcePaymentId,
    customerName: workflow.customerName,
    recipient: workflow.customerEmail,
    balance,
  };

  if (!isEnabled()) {
    return { ...baseResult, state: "disabled", reason: "Additional costs emails are disabled." };
  }

  const ineligibilityReason = getAdditionalCostsEmailIneligibilityReason(workflow, {
    allowProgressedOrder,
  });
  if (ineligibilityReason) {
    return { ...baseResult, state: "ineligible", reason: ineligibilityReason };
  }

  if (!isGmailSenderConfigured()) {
    throw new Error("Gmail sender configuration is incomplete.");
  }

  const dedupeKey = `${workflow.id}:${balance.toFixed(2)}`;
  if (!(await tryReserveDedupeKey(DEDUPE_SCOPE, dedupeKey))) {
    return {
      ...baseResult,
      state: "duplicate",
      reason: "An additional costs email is already reserved or sent for this balance.",
    };
  }

  let messageAccepted = false;
  try {
    const customerAppUrl = getCustomerAppUrl(requestUrl);
    const progressLink = buildSurveyReviewUrl(customerAppUrl, workflow.reviewToken as string);
    const email = renderAdditionalCostsEmail({
      firstName: getFirstName(workflow.customerName),
      customerName: clean(workflow.customerName) || "VCHRGD customer",
      chargerName: clean(workflow.chargerName) || "VCHRGD home charger",
      installationPostcode: getInstallationPostcode(workflow),
      orderReference: workflow.sourcePaymentId,
      originalAmount: workflow.originalAmount,
      revisedTotal: getResolvedWorkflowAmount(workflow),
      alreadyPaid: workflow.originalAmount,
      balanceDue: balance,
      additionalCostLines: [{ label: "Additional installation work", amount: balance }],
      explanation: getExplanation(workflow),
      progressLink,
      paymentLink: `${progressLink}/pay-balance`,
      brandLogoUrl: `${customerAppUrl}/content/vchrgd-email-logo.png`,
    });
    const result = await sendGmailMessage({
      to: clean(workflow.customerEmail),
      subject: email.subject,
      html: email.html,
      text: email.text,
      oidcToken,
    });
    messageAccepted = true;

    await recordAdditionalCostsEmailSent(workflow.id, {
      amount: balance,
      messageId: result.id,
      recipient: clean(workflow.customerEmail),
    });
    await recordAdminAuditEvent({
      action: "additional_costs.email_sent",
      actor: "system",
      detail: `Additional costs email sent for ${workflow.sourcePaymentId} to ${workflow.customerEmail}. Gmail message ${result.id || "unknown"}.`,
    });

    return { ...baseResult, state: "sent", messageId: result.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to send additional costs email.";
    if (!messageAccepted) {
      await releaseDedupeKey(DEDUPE_SCOPE, dedupeKey);
      await recordAdditionalCostsEmailFailure(workflow.id, detail);
    }
    await recordAdminAuditEvent({
      action: "additional_costs.email_failed",
      actor: "system",
      detail: `Additional costs email failed for ${workflow.sourcePaymentId}: ${detail}`,
    });
    throw error;
  }
}

export type { AdditionalCostsEmailSendResult };
