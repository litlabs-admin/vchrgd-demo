import { randomBytes, randomUUID } from "node:crypto";
import type { CheckoutInteraction } from "@/lib/checkout-interactions";
import {
  isValidEmailAddress,
  isValidUkMobileNumber,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";
import { trackSurveyStage } from "@/lib/survey-stage-clock";
import { preferredDatesEnabledForNewOrder, preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";

type WorkflowAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

type WorkflowProvider = "CARD" | "FRASERS_PLUS" | null;
type WorkflowPaymentChoice = "card" | "frasers-plus" | null;

type SurveyWorkflowStatus =
  | "AWAITING_SURVEY"
  | "SURVEY_RECEIVED"
  | "REVIEW_READY"
  | "BALANCE_PENDING"
  | "READY_FOR_BOOKING"
  | "BOOKED_FOR_INSTALLATION"
  | "INSTALLED"
  | "DECLINED";

type RefundRequestStatus = "NONE" | "REQUESTED" | "APPROVED" | "COMPLETED" | "REJECTED";
type TopUpPaymentStatus = "NONE" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";

type SurveyWorkflowEvent = {
  id: string;
  at: string;
  actor: string;
  label: string;
  detail: string;
};

type SurveyWorkflowJumptechJob = {
  id?: string;
  status?: string;
  scheduledFor?: string;
  assignee?: string;
  assigneeEmail?: string;
  assigneePhone?: string;
  completedAt?: string;
};

type SurveyWorkflowJumptechProject = {
  projectId: string;
  integrationName?: string;
  integrationId?: string;
  projectType?: string;
  applicationId?: string;
  status?: string;
  currentStatusLabel?: string;
  currentStatusDetail?: string;
  externalOwnerId?: string;
  jobs?: SurveyWorkflowJumptechJob[];
  createdAt: string;
  lastSyncedAt?: string;
  lastWebhookAt?: string;
  completedAt?: string;
  lastError?: string;
  quoteTotal?: number;
  additionalInstallationCosts?: number;
  additionalInstallationCostDetail?: string;
};

type SurveyWorkflow = {
  id: string;
  sourcePaymentId: string;
  currentPaymentId: string;
  sourceKind: "payment" | "interaction";
  provider: WorkflowProvider;
  paymentChoice: WorkflowPaymentChoice;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: WorkflowAddress;
  deliveryAddress?: WorkflowAddress;
  originalAmount: number;
  amendedAmount?: number;
  surveyAdjustment?: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  totalBeforeDiscount?: number;
  additionalInstallationCosts?: number;
  additionalInstallationCostDetail?: string;
  additionalCostsEmailSentAt?: string;
  additionalCostsEmailSentAmount?: number;
  additionalCostsEmailMessageId?: string;
  additionalCostsEmailFailure?: string;
  surveyReceivedAt?: string;
  surveyReviewedAt?: string;
  surveyStatus: SurveyWorkflowStatus;
  stageClock?: {
    status: SurveyWorkflowStatus;
    enteredAt: string;
    source: "transition" | "first-observed";
  };
  amendmentNotes?: string;
  adminNotes?: string;
  reviewToken?: string;
  reviewLinkExpiresAt?: string;
  customerDecision?: "ACCEPTED" | "DECLINED";
  customerDecisionAt?: string;
  refundStatus: RefundRequestStatus;
  refundReason?: string;
  refundRequestedAt?: string;
  refundApprovedAt?: string;
  refundCompletedAt?: string;
  manualRefund?: {
    amount: number;
    method: "BANK_TRANSFER" | "PROVIDER_DASHBOARD" | "OTHER";
    reference: string;
    refundedOn: string;
    recordedAt: string;
    recordedBy: string;
    notes: string;
  };
  refundProviderAttemptedAt?: string;
  refundProviderResult?: "SUCCEEDED" | "FAILED" | "PENDING" | "UNKNOWN";
  refundProviderReference?: string;
  refundProviderAction?: string;
  refundProviderDetail?: string;
  archivedAt?: string;
  archivedReason?: string;
  topUpPaymentChoice?: WorkflowPaymentChoice;
  topUpPaymentStatus: TopUpPaymentStatus;
  topUpPaymentId?: string;
  topUpUpr?: string;
  topUpRequestedAt?: string;
  topUpCompletedAt?: string;
  topUpFailureReason?: string;
  // Legacy fields kept so older local data can still be read safely.
  replacementPaymentId?: string;
  replacementUpr?: string;
  balanceDue?: number;
  bookingApprovedAt?: string;
  bookedAt?: string;
  chargerDispatchedAt?: string;
  chargerExpectedDeliveryDate?: string;
  preferredInstallationDates?: string[];
  preferredInstallationDatesEnabled?: boolean;
  preferredInstallationDatesUpdatedAt?: string;
  installationDate?: string;
  installerName?: string;
  installerEmail?: string;
  installerPhone?: string;
  installerNotes?: string;
  jumptech?: SurveyWorkflowJumptechProject;
  history: SurveyWorkflowEvent[];
};

type WorkflowFile = {
  workflows: SurveyWorkflow[];
};

const WORKFLOW_FILE = "post-survey-workflows.json";
const MAX_HISTORY = 60;
const SURVEY_RESPONSE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const INSTALLATION_PREFERENCE_LEAD_TIME_MS = 14 * 24 * 60 * 60 * 1000;

async function readWorkflowFile() {
  return readJsonFile<WorkflowFile>(WORKFLOW_FILE, { workflows: [] });
}

async function writeWorkflowFile(state: WorkflowFile) {
  await writeJsonFile(WORKFLOW_FILE, state);
}

function serialiseWorkflowStateForSync(workflows: SurveyWorkflow[]) {
  return JSON.stringify(
    workflows.map((workflow) =>
      Object.fromEntries(Object.entries(workflow).filter(([key]) => key !== "updatedAt")),
    ),
  );
}

function appendHistory(
  workflow: SurveyWorkflow,
  event: Omit<SurveyWorkflowEvent, "id" | "at">,
) {
  workflow.history = [
    {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...event,
    },
    ...workflow.history,
  ].slice(0, MAX_HISTORY);
}

function ensureWorkflowReviewToken(workflow: SurveyWorkflow) {
  if (!workflow.reviewToken) {
    workflow.reviewToken = randomBytes(24).toString("base64url");
  }
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normaliseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toIsoDate(parsed);
}

function normalisePreferredInstallationDate(value: string) {
  return normaliseDateOnly(value);
}

function formatDateOnlyLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function normaliseJumptechStatus(status?: string) {
  return `${status || ""}`.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function statusLooksLikeSurveyReceived(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    (normalized.includes("SURVEY") &&
      (normalized.includes("RECEIVED") ||
        normalized.includes("SUBMITTED") ||
        normalized.includes("COMPLETE") ||
        normalized.includes("COMPLETED"))) ||
    (normalized.includes("QUESTIONNAIRE") &&
      (normalized.includes("SUBMITTED") ||
        normalized.includes("COMPLETE") ||
        normalized.includes("COMPLETED"))) ||
    normalized === "IN_REVIEW"
  );
}

function statusLooksComplete(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    normalized.includes("COMPLETE") ||
    normalized.includes("COMPLETED") ||
    normalized.includes("INSTALLED") ||
    normalized.includes("CLOSED")
  );
}

function statusLooksInstalled(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    normalized.includes("INSTALLED") ||
    normalized === "INSTALLATION_COMPLETE" ||
    normalized === "INSTALLATION_COMPLETED" ||
    normalized === "JOB_INSTALLED"
  );
}

function statusLooksReadyForBooking(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    normalized.includes("BOOKING") ||
    normalized.includes("SCHEDUL") ||
    normalized.includes("APPOINTMENT") ||
    normalized.includes("INSTALLATION_READY") ||
    normalized.includes("READY_FOR_INSTALL")
  );
}

function statusLooksQuoteSent(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    normalized.includes("QUOTE_SENT") ||
    normalized.includes("ADDITIONAL_COST") ||
    normalized.includes("COST_REQUIRED")
  );
}

function statusLooksQuoteApproved(status?: string, currentStatusLabel?: string) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return normalized.includes("QUOTE_APPROVED");
}

function statusLooksDnoApproved(status?: string, currentStatusLabel?: string) {
  return normaliseJumptechStatus(status || currentStatusLabel) === "DNO_APPROVED";
}

function applyDnoBookingGate(workflow: SurveyWorkflow) {
  if (
    !statusLooksDnoApproved(workflow.jumptech?.status, workflow.jumptech?.currentStatusLabel) ||
    isWorkflowBooked(workflow) ||
    workflow.surveyStatus === "DECLINED" ||
    workflow.customerDecision === "DECLINED" ||
    workflow.archivedAt ||
    ["REQUESTED", "APPROVED", "COMPLETED"].includes(workflow.refundStatus)
  ) {
    return;
  }

  const previousStatus = workflow.surveyStatus;
  const balance = getOutstandingWorkflowBalance(workflow);
  const now = new Date().toISOString();
  workflow.surveyReceivedAt = workflow.surveyReceivedAt ?? now;
  workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? now;
  workflow.balanceDue = balance;
  if (balance > 0.01) {
    workflow.surveyStatus = "BALANCE_PENDING";
    workflow.bookingApprovedAt = undefined;
    ensureWorkflowReviewToken(workflow);
  } else {
    workflow.surveyStatus = "READY_FOR_BOOKING";
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? now;
  }

  if (workflow.surveyStatus !== previousStatus) {
    appendHistory(workflow, {
      actor: "system",
      label: balance > 0.01 ? "DNO approved; balance outstanding" : "DNO approved; ready for booking",
      detail: balance > 0.01
        ? "Jumptech has approved the DNO stage, but the outstanding balance must be paid before booking."
        : "Jumptech has approved the DNO stage and no balance remains. The order is ready for booking.",
    });
  }
}

function formatMoneyValue(value: number) {
  return `£${value.toFixed(2)}`;
}

function formatAdditionalInstallationCostsDetail(value: number) {
  return `Additional installation costs:\n${formatMoneyValue(value)}`;
}

function statusLooksBookedForInstallation(
  status?: string,
  currentStatusLabel?: string,
  jobs?: SurveyWorkflowJumptechJob[],
) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);
  return (
    (jobs?.some((job) => Boolean(job.scheduledFor)) ?? false) ||
    normalized.includes("BOOKED") ||
    normalized.includes("SCHEDULED") ||
    normalized.includes("APPOINTMENT_SET") ||
    normalized.includes("INSTALLATION_BOOKED")
  );
}

function jumptechStatusPriority(
  status?: string,
  currentStatusLabel?: string,
  jobs?: SurveyWorkflowJumptechJob[],
) {
  const normalized = normaliseJumptechStatus(status || currentStatusLabel);

  if (statusLooksInstalled(status, currentStatusLabel)) {
    return 60;
  }

  if (statusLooksBookedForInstallation(status, currentStatusLabel, jobs)) {
    return 50;
  }

  if (
    statusLooksQuoteApproved(status, currentStatusLabel) ||
    statusLooksDnoApproved(status, currentStatusLabel) ||
    statusLooksReadyForBooking(status, currentStatusLabel)
  ) {
    return 40;
  }

  if (statusLooksQuoteSent(status, currentStatusLabel)) {
    return 35;
  }

  if (statusLooksLikeSurveyReceived(status, currentStatusLabel)) {
    return 30;
  }

  if (normalized === "PENDING_APPLICATION") {
    return 20;
  }

  if (normalized === "CREATED") {
    return 10;
  }

  if (normalized === "ARCHIVED") {
    return 0;
  }

  return normalized ? 15 : 0;
}

function shouldRelinkJumptechProject(
  workflow: SurveyWorkflow,
  input: Partial<SurveyWorkflowJumptechProject>,
) {
  if (!workflow.jumptech?.projectId) {
    return true;
  }

  if (workflow.jumptech.projectId === input.projectId) {
    return true;
  }

  const currentPriority = jumptechStatusPriority(
    workflow.jumptech.status,
    workflow.jumptech.currentStatusLabel,
    workflow.jumptech.jobs,
  );
  const incomingPriority = jumptechStatusPriority(
    input.status,
    input.currentStatusLabel,
    input.jobs,
  );

  return incomingPriority > currentPriority;
}

function getPrimaryJumptechJob(jobs?: SurveyWorkflowJumptechJob[]) {
  if (!jobs?.length) {
    return undefined;
  }

  return (
    jobs.find((job) => job.scheduledFor || job.assignee || job.assigneeEmail || job.status) ??
    jobs[0]
  );
}

function applyJumptechWorkflowSignals(
  workflow: SurveyWorkflow,
  input: Partial<SurveyWorkflowJumptechProject>,
) {
  const quotedAdditionalCost =
    input.additionalInstallationCosts !== undefined
      ? Math.max(input.additionalInstallationCosts, 0)
      : undefined;
  const quoteTotal =
    input.quoteTotal !== undefined && Number.isFinite(input.quoteTotal)
      ? Math.max(input.quoteTotal, 0)
      : undefined;
  const additionalFromQuoteTotal =
    quoteTotal !== undefined
      ? Math.max(quoteTotal - workflow.originalAmount, 0)
      : undefined;
  const resolvedAdditionalCost =
    quotedAdditionalCost !== undefined
      ? quotedAdditionalCost
      : additionalFromQuoteTotal;

  if (quoteTotal !== undefined) {
    workflow.amendedAmount = quoteTotal;
    workflow.balanceDue = getOutstandingWorkflowBalance(workflow);
  } else if (resolvedAdditionalCost !== undefined) {
    workflow.amendedAmount = workflow.originalAmount + resolvedAdditionalCost;
    workflow.balanceDue = getOutstandingWorkflowBalance(workflow);
  }

  if (resolvedAdditionalCost !== undefined) {
    workflow.additionalInstallationCosts = resolvedAdditionalCost;
    workflow.additionalInstallationCostDetail =
      input.additionalInstallationCostDetail ||
      formatAdditionalInstallationCostsDetail(resolvedAdditionalCost);
    if (input.additionalInstallationCostDetail || !workflow.amendmentNotes) {
      workflow.amendmentNotes = workflow.additionalInstallationCostDetail;
    }
  }

  if (statusLooksLikeSurveyReceived(input.status, input.currentStatusLabel) && !workflow.surveyReceivedAt) {
    workflow.surveyReceivedAt = new Date().toISOString();
    if (workflow.surveyStatus === "AWAITING_SURVEY") {
      workflow.surveyStatus = "SURVEY_RECEIVED";
    }
  }

  if (statusLooksQuoteSent(input.status, input.currentStatusLabel)) {
    workflow.surveyReceivedAt = workflow.surveyReceivedAt ?? new Date().toISOString();
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    workflow.surveyStatus =
      getOutstandingWorkflowBalance(workflow) > 0 ? "BALANCE_PENDING" : "REVIEW_READY";
  }

  if (statusLooksQuoteApproved(input.status, input.currentStatusLabel)) {
    workflow.surveyReceivedAt = workflow.surveyReceivedAt ?? new Date().toISOString();
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    if (
      workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
      workflow.surveyStatus !== "INSTALLED" &&
      workflow.surveyStatus !== "DECLINED"
    ) {
      if (getOutstandingWorkflowBalance(workflow) > 0.01) {
        workflow.surveyStatus = "BALANCE_PENDING";
        workflow.bookingApprovedAt = undefined;
        ensureWorkflowReviewToken(workflow);
      } else {
        workflow.surveyStatus = "READY_FOR_BOOKING";
        workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? new Date().toISOString();
      }
    }
  }

  if (
    statusLooksReadyForBooking(input.status, input.currentStatusLabel) &&
    workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
    workflow.surveyStatus !== "INSTALLED" &&
    workflow.surveyStatus !== "DECLINED"
  ) {
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    if (
      workflow.surveyStatus === "SURVEY_RECEIVED" ||
      workflow.surveyStatus === "REVIEW_READY" ||
      workflow.surveyStatus === "BALANCE_PENDING"
    ) {
      workflow.surveyStatus = "READY_FOR_BOOKING";
      workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? new Date().toISOString();
    }
  }

  const primaryJob = getPrimaryJumptechJob(input.jobs);
  if (primaryJob?.scheduledFor) {
    workflow.installationDate = primaryJob.scheduledFor;
  }

  if (primaryJob?.assignee) {
    workflow.installerName = primaryJob.assignee;
  }

  if (primaryJob?.assigneeEmail) {
    workflow.installerEmail = primaryJob.assigneeEmail;
  }

  if (primaryJob?.assigneePhone) {
    workflow.installerPhone = primaryJob.assigneePhone;
  }

  if (
    statusLooksBookedForInstallation(input.status, input.currentStatusLabel, input.jobs) &&
    workflow.surveyStatus !== "INSTALLED" &&
    workflow.surveyStatus !== "DECLINED"
  ) {
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? new Date().toISOString();
    workflow.bookedAt = workflow.bookedAt ?? new Date().toISOString();
    workflow.surveyStatus = "BOOKED_FOR_INSTALLATION";
  }

  if (statusLooksComplete(input.status, input.currentStatusLabel) && workflow.refundStatus !== "COMPLETED") {
    workflow.jumptech = {
      ...workflow.jumptech,
      completedAt: input.completedAt ?? workflow.jumptech?.completedAt ?? new Date().toISOString(),
    } as SurveyWorkflowJumptechProject;
  }

  if (statusLooksInstalled(input.status, input.currentStatusLabel)) {
    const installedAt =
      input.completedAt ??
      primaryJob?.completedAt ??
      workflow.jumptech?.completedAt ??
      new Date().toISOString();
    workflow.surveyReceivedAt = workflow.surveyReceivedAt ?? new Date().toISOString();
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? new Date().toISOString();
    workflow.bookedAt = workflow.bookedAt ?? new Date().toISOString();
    workflow.installationDate = workflow.installationDate ?? installedAt;
    workflow.surveyStatus = "INSTALLED";
    workflow.jumptech = {
      ...workflow.jumptech,
      completedAt: installedAt,
    } as SurveyWorkflowJumptechProject;
  }

  applyDnoBookingGate(workflow);
  if (workflow.refundStatus === "COMPLETED") {
    workflow.surveyStatus = "DECLINED";
    workflow.balanceDue = 0;
  }
}

function toPaymentChoice(provider: WorkflowProvider): WorkflowPaymentChoice {
  if (provider === "CARD") {
    return "card";
  }

  if (provider === "FRASERS_PLUS") {
    return "frasers-plus";
  }

  return null;
}

function fromInteractionChoice(choice?: string | null): WorkflowPaymentChoice {
  return choice === "card" || choice === "frasers-plus" ? choice : null;
}

function toAddress(input?: {
  line1?: string;
  line2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
} | null): WorkflowAddress | undefined {
  if (!input?.line1 && !input?.city && !input?.postalCode) {
    return undefined;
  }

  return {
    line1: input?.line1 ?? "",
    line2: input?.line2 ?? "",
    city: input?.city ?? "",
    postalCode: input?.postalCode ?? "",
    country: input?.country ?? "GB",
  };
}

function buildDerivedWorkflow(
  payment: PaymentSession | undefined,
  interaction: CheckoutInteraction | undefined,
  existing?: SurveyWorkflow,
) {
  const now = new Date().toISOString();
  const sourcePaymentId = payment?.paymentId ?? interaction?.paymentId ?? randomUUID();
  const interactionCustomerName = [
    interaction?.customerFirstName,
    interaction?.customerLastName,
  ]
    .filter(Boolean)
    .join(" ");
  const customerName = payment?.customerName ?? interactionCustomerName ?? undefined;
  const customerEmail = normaliseEmailInput(
    payment?.customerEmail ?? interaction?.customerEmail ?? existing?.customerEmail,
  ) || undefined;
  const customerPhone = normaliseUkMobileInput(
    payment?.customerPhone ?? interaction?.customerPhone ?? existing?.customerPhone,
  ) || undefined;
  const provider = payment?.provider ?? null;
  const paymentChoice =
    fromInteractionChoice(interaction?.paymentChoice) ??
    existing?.paymentChoice ??
    toPaymentChoice(provider);

  const workflow: SurveyWorkflow = {
    id: existing?.id ?? randomUUID(),
    sourcePaymentId,
    currentPaymentId: existing?.currentPaymentId ?? payment?.paymentId ?? interaction?.paymentId ?? sourcePaymentId,
    sourceKind: payment ? "payment" : "interaction",
    provider: payment ? (provider ?? existing?.provider ?? null) : null,
    paymentChoice,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    customerName: customerName || existing?.customerName,
    customerEmail,
    customerPhone,
    chargerName: payment?.chargerName ?? interaction?.chargerName ?? existing?.chargerName,
    chargerSlug: payment?.chargerSlug ?? interaction?.selectedSlug ?? existing?.chargerSlug,
    propertyType: payment?.propertyType ?? interaction?.propertyType ?? existing?.propertyType,
    parkingType: payment?.parkingType ?? interaction?.parkingType ?? existing?.parkingType,
    fuseBoxDistance:
      payment?.fuseBoxDistance ?? interaction?.fuseBoxDistance ?? existing?.fuseBoxDistance,
    billingAddress:
      toAddress(
        payment?.billingAddress
          ? {
              line1: payment.billingAddress.line1,
              line2: payment.billingAddress.line2,
              city: payment.billingAddress.city,
              postalCode: payment.billingAddress.postalCode,
              country: payment.billingAddress.country,
            }
          : {
              line1: interaction?.billingLine1 ?? "",
              line2: interaction?.billingLine2 ?? "",
              city: interaction?.billingCity ?? "",
              postalCode: interaction?.billingPostalCode ?? "",
              country: interaction?.billingCountry ?? "GB",
            },
      ) ?? existing?.billingAddress,
    deliveryAddress:
      toAddress(
        payment?.deliveryAddress
          ? {
              line1: payment.deliveryAddress.line1,
              line2: payment.deliveryAddress.line2,
              city: payment.deliveryAddress.city,
              postalCode: payment.deliveryAddress.postalCode,
              country: payment.deliveryAddress.country,
            }
          : undefined,
      ) ??
      existing?.deliveryAddress ??
      toAddress(
        interaction?.billingLine1
          ? {
              line1: interaction.billingLine1 ?? "",
              line2: interaction.billingLine2 ?? "",
              city: interaction.billingCity ?? "",
              postalCode: interaction.billingPostalCode ?? "",
              country: interaction.billingCountry ?? "GB",
            }
          : undefined,
      ),
    originalAmount:
      payment?.amount ??
      interaction?.total ??
      existing?.originalAmount ??
      0,
    amendedAmount: existing?.amendedAmount,
    surveyAdjustment: payment?.surveyAdjustment ?? existing?.surveyAdjustment ?? 0,
    discountAmount: payment?.discountAmount ?? existing?.discountAmount ?? 0,
    discountCode: payment?.discountCode ?? existing?.discountCode,
    discountLabel: payment?.discountLabel ?? existing?.discountLabel,
    totalBeforeDiscount: payment?.totalBeforeDiscount ?? existing?.totalBeforeDiscount,
    additionalInstallationCosts: existing?.additionalInstallationCosts,
    additionalInstallationCostDetail: existing?.additionalInstallationCostDetail,
    additionalCostsEmailSentAt: existing?.additionalCostsEmailSentAt,
    additionalCostsEmailSentAmount: existing?.additionalCostsEmailSentAmount,
    additionalCostsEmailMessageId: existing?.additionalCostsEmailMessageId,
    additionalCostsEmailFailure: existing?.additionalCostsEmailFailure,
    surveyReceivedAt: existing?.surveyReceivedAt,
    surveyReviewedAt: existing?.surveyReviewedAt,
    surveyStatus: existing?.surveyStatus ?? "AWAITING_SURVEY",
    stageClock: existing?.stageClock,
    amendmentNotes: existing?.amendmentNotes,
    adminNotes: existing?.adminNotes,
    reviewToken: existing?.reviewToken,
    reviewLinkExpiresAt: existing?.reviewLinkExpiresAt,
    customerDecision: existing?.customerDecision,
    customerDecisionAt: existing?.customerDecisionAt,
    refundStatus: existing?.refundStatus ?? "NONE",
    refundReason: existing?.refundReason,
    refundRequestedAt: existing?.refundRequestedAt,
    refundApprovedAt: existing?.refundApprovedAt,
    refundCompletedAt: existing?.refundCompletedAt,
    manualRefund: existing?.manualRefund,
    refundProviderAttemptedAt: existing?.refundProviderAttemptedAt,
    refundProviderResult: existing?.refundProviderResult,
    refundProviderReference: existing?.refundProviderReference,
    refundProviderAction: existing?.refundProviderAction,
    refundProviderDetail: existing?.refundProviderDetail,
    archivedAt: existing?.archivedAt,
    archivedReason: existing?.archivedReason,
    topUpPaymentChoice: existing?.topUpPaymentChoice,
    topUpPaymentStatus:
      existing?.topUpPaymentStatus ??
      (existing?.topUpPaymentId || existing?.replacementPaymentId ? "COMPLETED" : "NONE"),
    topUpPaymentId: existing?.topUpPaymentId ?? existing?.replacementPaymentId,
    topUpUpr: existing?.topUpUpr ?? existing?.replacementUpr,
    topUpRequestedAt: existing?.topUpRequestedAt,
    topUpCompletedAt: existing?.topUpCompletedAt,
    topUpFailureReason: existing?.topUpFailureReason,
    replacementPaymentId: existing?.replacementPaymentId,
    replacementUpr: existing?.replacementUpr,
    balanceDue: existing?.balanceDue,
    bookingApprovedAt: existing?.bookingApprovedAt,
    bookedAt: existing?.bookedAt,
    chargerDispatchedAt: existing?.chargerDispatchedAt,
    chargerExpectedDeliveryDate: existing?.chargerExpectedDeliveryDate,
    preferredInstallationDates: existing?.preferredInstallationDates,
    preferredInstallationDatesEnabled: existing
      ? existing.preferredInstallationDatesEnabled
      : preferredDatesEnabledForNewOrder(
          [payment?.createdAt, interaction?.startedAt].filter((date): date is string => Boolean(date)).sort()[0] ?? now,
        ),
    preferredInstallationDatesUpdatedAt: existing?.preferredInstallationDatesUpdatedAt,
    installationDate: existing?.installationDate,
    installerName: existing?.installerName,
    installerEmail: existing?.installerEmail,
    installerPhone: existing?.installerPhone,
    installerNotes: existing?.installerNotes,
    jumptech: existing?.jumptech,
    history: existing?.history ?? [],
  };

  if (!existing) {
    appendHistory(workflow, {
      actor: "system",
      label: "Survey workflow created",
      detail: "The order was added to the post-survey workflow queue.",
    });
  }

  ensureWorkflowReviewToken(workflow);

  return workflow;
}

async function withWorkflowMutation(
  workflowId: string,
  mutate: (workflow: SurveyWorkflow) => void,
) {
  return withJsonFileTransaction(WORKFLOW_FILE, async () => {
  const state = await readWorkflowFile();
  const index = state.workflows.findIndex((workflow) => workflow.id === workflowId);

  if (index < 0) {
    return null;
  }

  const workflow = state.workflows[index];
  const previousStatus = workflow.surveyStatus;
  mutate(workflow);
  // A late operational update must not reopen a refunded order.
  if (workflow.refundStatus === "COMPLETED") {
    workflow.surveyStatus = "DECLINED";
    workflow.balanceDue = 0;
  }
  trackSurveyStage(workflow, previousStatus);
  ensureWorkflowReviewToken(workflow);
  workflow.updatedAt = new Date().toISOString();
  state.workflows[index] = workflow;
  await writeWorkflowFile(state);
  return workflow;

  });
}

function isPostSurveyChildPaymentId(paymentId?: string | null) {
  return Boolean(paymentId && /-(?:topup|balance)(?:-|$)/i.test(paymentId));
}

function isChildPaymentWorkflow(workflow: SurveyWorkflow) {
  return isPostSurveyChildPaymentId(workflow.sourcePaymentId);
}

function workflowHasPayment(workflow: SurveyWorkflow, paymentId: string) {
  return (
    workflow.sourcePaymentId === paymentId ||
    workflow.currentPaymentId === paymentId ||
    workflow.topUpPaymentId === paymentId ||
    workflow.replacementPaymentId === paymentId
  );
}

function paymentIdLooksLinkedToWorkflow(workflow: SurveyWorkflow, paymentId: string) {
  return [workflow.sourcePaymentId, workflow.currentPaymentId]
    .filter(Boolean)
    .some(
      (sourceId) =>
        paymentId.startsWith(`${sourceId}-topup-`) ||
        paymentId.startsWith(`${sourceId}-balance-`),
    );
}

function findParentWorkflowForChildPayment(
  workflows: SurveyWorkflow[],
  paymentId: string,
) {
  return (
    workflows.find(
      (workflow) => !isChildPaymentWorkflow(workflow) && workflowHasPayment(workflow, paymentId),
    ) ??
    workflows.find(
      (workflow) =>
        !isChildPaymentWorkflow(workflow) &&
        paymentIdLooksLinkedToWorkflow(workflow, paymentId),
    )
  );
}

function resolveTopUpStatusFromPayment(payment: PaymentSession): TopUpPaymentStatus {
  const status = payment.latestStatus?.status?.toUpperCase();

  if (!status) {
    return "PENDING";
  }

  if (["APPROVED", "AUTHORISED", "AUTHORIZED", "COMPLETED", "PAID"].includes(status)) {
    return "COMPLETED";
  }

  if (["DECLINED", "FAILED", "REJECTED"].includes(status)) {
    return "FAILED";
  }

  if (["CANCELLED", "CANCELED", "REFUNDED", "REVERSED"].includes(status)) {
    return "CANCELLED";
  }

  return "PENDING";
}

function syncChildPaymentIntoWorkflow(workflow: SurveyWorkflow, payment: PaymentSession) {
  const nextStatus = resolveTopUpStatusFromPayment(payment);
  const alreadyLinked =
    workflow.topUpPaymentId === payment.paymentId ||
    workflow.replacementPaymentId === payment.paymentId ||
    workflow.currentPaymentId === payment.paymentId;
  const inferredLink =
    paymentIdLooksLinkedToWorkflow(workflow, payment.paymentId) &&
    (!workflow.topUpPaymentId || nextStatus === "COMPLETED");

  if (!alreadyLinked && !inferredLink) {
    return;
  }

  // A settled balance is terminal. A later abandoned retry must never reopen it.
  if (workflow.topUpPaymentStatus === "COMPLETED" && nextStatus !== "COMPLETED") {
    return;
  }

  if (nextStatus === "COMPLETED") {
    workflow.topUpPaymentId = payment.paymentId;
    workflow.topUpUpr = payment.uniquePaymentReference ?? workflow.topUpUpr;
    workflow.topUpRequestedAt = payment.createdAt ?? workflow.topUpRequestedAt;
  } else {
    workflow.topUpPaymentId = workflow.topUpPaymentId ?? payment.paymentId;
    workflow.topUpUpr = workflow.topUpUpr ?? payment.uniquePaymentReference;
    workflow.topUpRequestedAt = workflow.topUpRequestedAt ?? payment.createdAt;
  }
  workflow.topUpPaymentChoice = workflow.topUpPaymentChoice ?? toPaymentChoice(payment.provider);
  workflow.topUpPaymentStatus = nextStatus;

  if (nextStatus === "COMPLETED") {
    workflow.balanceDue = 0;
    workflow.topUpCompletedAt =
      workflow.topUpCompletedAt ?? payment.latestStatus?.updatedAt ?? new Date().toISOString();
    workflow.topUpFailureReason = undefined;
    if (
      workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
      workflow.surveyStatus !== "INSTALLED" &&
      workflow.surveyStatus !== "DECLINED"
    ) {
      workflow.surveyStatus = "READY_FOR_BOOKING";
      workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? workflow.topUpCompletedAt;
    }
  } else if (nextStatus === "FAILED") {
    workflow.topUpCompletedAt = undefined;
    workflow.topUpFailureReason =
      workflow.topUpFailureReason ??
      "The additional payment was not approved. The customer can try again or request cancellation.";
  } else if (nextStatus === "CANCELLED") {
    workflow.topUpCompletedAt = undefined;
    workflow.topUpFailureReason =
      workflow.topUpFailureReason ??
      "The additional payment was cancelled before it completed.";
  }
}

export async function syncPostSurveyWorkflows(
  payments: PaymentSession[],
  interactions: CheckoutInteraction[],
) {
  return withJsonFileTransaction(WORKFLOW_FILE, async () => {
  const state = await readWorkflowFile();
  const previousState = serialiseWorkflowStateForSync(state.workflows);
  const previousStages = new Map(state.workflows.map((workflow) => [workflow.id, workflow.surveyStatus]));
  const nextWorkflows = [...state.workflows];

  const sourceIds = new Set(payments.map((payment) => payment.paymentId));
  const sourcePayments = payments.filter(
    (payment) => !isPostSurveyChildPaymentId(payment.paymentId),
  );
  const childPayments = payments.filter((payment) =>
    isPostSurveyChildPaymentId(payment.paymentId),
  );

  for (const payment of sourcePayments) {
    const interaction = interactions.find((item) => item.paymentId === payment.paymentId);
    const existing = nextWorkflows.find((workflow) => workflow.sourcePaymentId === payment.paymentId);
    const next = buildDerivedWorkflow(payment, interaction, existing);
    if (existing) {
      Object.assign(existing, next, { history: existing.history });
    } else {
      nextWorkflows.unshift(next);
    }
  }

  for (const interaction of interactions) {
    if (!interaction.detailsSubmittedAt && interaction.status !== "EXITED_SURVEY_LATER") {
      continue;
    }

    if (sourceIds.has(interaction.paymentId)) {
      continue;
    }

    const existing = nextWorkflows.find((workflow) => workflow.sourcePaymentId === interaction.paymentId);
    const next = buildDerivedWorkflow(undefined, interaction, existing);
    if (existing) {
      Object.assign(existing, next, { history: existing.history });
    } else {
      nextWorkflows.unshift(next);
    }
  }

  for (const payment of childPayments) {
    const parentWorkflow = findParentWorkflowForChildPayment(nextWorkflows, payment.paymentId);
    if (parentWorkflow) {
      syncChildPaymentIntoWorkflow(parentWorkflow, payment);
    }
  }

  const visibleWorkflows = nextWorkflows.filter((workflow) => !isChildPaymentWorkflow(workflow));

  for (const workflow of visibleWorkflows) {
    // Reconcile approvals received before this gate was supported, without another webhook.
    applyDnoBookingGate(workflow);
    if (workflow.refundStatus === "COMPLETED") {
      workflow.surveyStatus = "DECLINED";
      workflow.balanceDue = 0;
    }
    if (
      workflow.surveyStatus === "READY_FOR_BOOKING" &&
      getOutstandingWorkflowBalance(workflow) > 0.01
    ) {
      workflow.surveyStatus = "BALANCE_PENDING";
      workflow.bookingApprovedAt = undefined;
      ensureWorkflowReviewToken(workflow);
      appendHistory(workflow, {
        actor: "system",
        label: "Outstanding balance restored",
        detail:
          "The order was returned to balance payment because the amended amount has not been paid in full.",
      });
    }
  }

  visibleWorkflows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const workflow of visibleWorkflows) {
    trackSurveyStage(workflow, previousStages.get(workflow.id));
  }
  const nextState = serialiseWorkflowStateForSync(visibleWorkflows);
  if (nextState !== previousState) {
    await writeWorkflowFile({ workflows: visibleWorkflows });
  }
  return visibleWorkflows;

  });
}

export async function listPostSurveyWorkflows() {
  return (await readWorkflowFile()).workflows.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function getPostSurveyWorkflowById(workflowId: string) {
  return (await readWorkflowFile()).workflows.find((workflow) => workflow.id === workflowId);
}

export async function getPostSurveyWorkflowByToken(token: string) {
  return (await readWorkflowFile()).workflows.find((workflow) => workflow.reviewToken === token);
}

export async function getPostSurveyWorkflowByPaymentId(paymentId: string) {
  return findParentWorkflowForChildPayment((await readWorkflowFile()).workflows, paymentId);
}

export async function getPostSurveyWorkflowByJumptechProjectId(projectId: string) {
  return (await readWorkflowFile()).workflows.find(
    (workflow) => workflow.jumptech?.projectId === projectId,
  );
}

export async function getPostSurveyWorkflowByJumptechIntegrationId(integrationId: string) {
  return (await readWorkflowFile()).workflows.find(
    (workflow) =>
      workflow.sourcePaymentId === integrationId ||
      workflow.currentPaymentId === integrationId ||
      workflow.jumptech?.integrationId === integrationId,
  );
}

export async function deletePostSurveyWorkflow(workflowId: string) {
  return withJsonFileTransaction(WORKFLOW_FILE, async () => {
  const state = await readWorkflowFile();
  const workflow = state.workflows.find((entry) => entry.id === workflowId);
  if (!workflow) {
    return null;
  }

  await writeWorkflowFile({
    workflows: state.workflows.filter((entry) => entry.id !== workflowId),
  });

  return workflow;

  });
}

export function isSurveyReviewLinkExpired(workflow: SurveyWorkflow) {
  if (!workflow.reviewToken) {
    return true;
  }

  return workflow.surveyStatus === "INSTALLED" && getOutstandingWorkflowBalance(workflow) <= 0.01;
}

export function buildSurveyReviewUrl(origin: string, token: string) {
  return `${origin}/survey-review/${encodeURIComponent(token)}`;
}

export async function confirmSurveyReceived(workflowId: string, actor: string, note?: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyReceivedAt = workflow.surveyReceivedAt ?? new Date().toISOString();
    workflow.surveyStatus = "SURVEY_RECEIVED";
    if (note) {
      workflow.adminNotes = note;
    }
    appendHistory(workflow, {
      actor,
      label: "Survey received",
      detail: note || "The digital survey has been reviewed by the operations team.",
    });
  });
}

export async function prepareSurveyReviewLink(
  workflowId: string,
  actor: string,
  input: {
    amendedAmount?: number;
    amendmentNotes?: string;
    adminNotes?: string;
    expiresInHours?: number;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    const expiresInHours = Math.max(input.expiresInHours ?? 72, 1);
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
    const resolvedAmount =
      input.amendedAmount !== undefined && Number.isFinite(input.amendedAmount)
        ? Math.max(input.amendedAmount, 0)
        : workflow.amendedAmount ?? workflow.originalAmount;

    workflow.amendedAmount = resolvedAmount;
    workflow.amendmentNotes = input.amendmentNotes?.trim() || workflow.amendmentNotes;
    workflow.adminNotes = input.adminNotes?.trim() || workflow.adminNotes;
    ensureWorkflowReviewToken(workflow);
    workflow.reviewLinkExpiresAt = expiresAt;
    workflow.surveyStatus = "REVIEW_READY";
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? new Date().toISOString();
    workflow.balanceDue = Math.max(resolvedAmount - workflow.originalAmount, 0);
    workflow.customerDecision = undefined;
    workflow.customerDecisionAt = undefined;
    workflow.topUpPaymentChoice = undefined;
    workflow.topUpPaymentStatus = "NONE";
    workflow.topUpPaymentId = undefined;
    workflow.topUpUpr = undefined;
    workflow.topUpRequestedAt = undefined;
    workflow.topUpCompletedAt = undefined;
    workflow.topUpFailureReason = undefined;
    appendHistory(workflow, {
      actor,
      label: "Customer review link generated",
      detail: resolvedAmount === workflow.originalAmount
        ? `A customer review link was issued with the current total of ${resolvedAmount.toFixed(2)}.`
        : `A customer review link was issued with an amended total of ${resolvedAmount.toFixed(2)}.`,
    });
  });
}

export async function markSurveyWorkflowBalancePending(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyStatus = "BALANCE_PENDING";
    workflow.customerDecision = "ACCEPTED";
    workflow.customerDecisionAt = new Date().toISOString();
    workflow.topUpPaymentStatus =
      workflow.topUpPaymentStatus === "COMPLETED" ? "COMPLETED" : "NONE";
    workflow.topUpFailureReason = undefined;
    appendHistory(workflow, {
      actor,
      label: "Awaiting balance payment",
      detail,
    });
  });
}

export async function markSurveyWorkflowBooked(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyStatus = "READY_FOR_BOOKING";
    workflow.bookingApprovedAt = new Date().toISOString();
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? workflow.bookingApprovedAt;
    workflow.customerDecision = "ACCEPTED";
    workflow.customerDecisionAt = workflow.customerDecisionAt ?? new Date().toISOString();
    appendHistory(workflow, {
      actor,
      label: "Ready for booking",
      detail,
    });
  });
}

function stageAfterBalanceUpdate(workflow: SurveyWorkflow, next: SurveyWorkflowStatus) {
  if (workflow.surveyStatus === "DECLINED" || workflow.surveyStatus === "INSTALLED") {
    return workflow.surveyStatus;
  }
  return isWorkflowBooked(workflow) ? "BOOKED_FOR_INSTALLATION" : next;
}

export async function attachTopUpPaymentToWorkflow(
  workflowId: string,
  actor: string,
  input: {
    paymentId: string;
    paymentChoice: WorkflowPaymentChoice;
    uniquePaymentReference?: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (workflow.topUpPaymentStatus === "COMPLETED") {
      return;
    }

    workflow.topUpPaymentChoice = input.paymentChoice;
    workflow.topUpPaymentStatus = "PENDING";
    workflow.topUpPaymentId = input.paymentId;
    workflow.topUpUpr = input.uniquePaymentReference ?? workflow.topUpUpr;
    workflow.topUpRequestedAt = new Date().toISOString();
    workflow.topUpCompletedAt = undefined;
    workflow.topUpFailureReason = undefined;
    workflow.surveyStatus = stageAfterBalanceUpdate(workflow, "BALANCE_PENDING");
    workflow.customerDecision = "ACCEPTED";
    workflow.customerDecisionAt = workflow.customerDecisionAt ?? workflow.topUpRequestedAt;
    appendHistory(workflow, {
      actor,
      label: "Additional payment started",
      detail:
        input.paymentChoice === "frasers-plus"
          ? `Customer started a new Frasers Plus top-up for the amended balance${input.uniquePaymentReference ? ` (${input.uniquePaymentReference})` : ""}.`
          : `Customer started a new card top-up for the amended balance (${input.paymentId}).`,
    });
  });
}

export async function completeSurveyWorkflowTopUp(
  workflowId: string,
  actor: string,
  detail: string,
  payment?: {
    paymentId?: string;
    uniquePaymentReference?: string;
    completedAt?: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.topUpPaymentId = payment?.paymentId ?? workflow.topUpPaymentId;
    workflow.topUpUpr = payment?.uniquePaymentReference ?? workflow.topUpUpr;
    workflow.topUpPaymentStatus = "COMPLETED";
    workflow.balanceDue = 0;
    workflow.topUpCompletedAt =
      workflow.topUpCompletedAt ?? payment?.completedAt ?? new Date().toISOString();
    workflow.surveyStatus = stageAfterBalanceUpdate(workflow, "READY_FOR_BOOKING");
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? workflow.topUpCompletedAt;
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? workflow.bookingApprovedAt;
    workflow.customerDecision = "ACCEPTED";
    workflow.customerDecisionAt = workflow.customerDecisionAt ?? workflow.topUpCompletedAt;
    workflow.topUpFailureReason = undefined;
    appendHistory(workflow, {
      actor,
      label: "Additional payment completed",
      detail,
    });
  });
}

export async function markJumptechQuoteApprovedOnWorkflow(
  workflowId: string,
  actor: string,
  detail: string,
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (!workflow.jumptech?.projectId) {
      return;
    }

    workflow.jumptech = {
      ...workflow.jumptech,
      status: "QUOTE APPROVED",
      currentStatusLabel: "QUOTE APPROVED",
      currentStatusDetail: detail,
      lastSyncedAt: new Date().toISOString(),
    };
    workflow.surveyStatus =
      workflow.surveyStatus === "INSTALLED" || workflow.surveyStatus === "BOOKED_FOR_INSTALLATION"
        ? workflow.surveyStatus
        : "READY_FOR_BOOKING";
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? new Date().toISOString();
    appendHistory(workflow, {
      actor,
      label: "Jumptech quote approved",
      detail,
    });
  });
}

export async function failSurveyWorkflowTopUp(
  workflowId: string,
  actor: string,
  input: {
    status: Exclude<TopUpPaymentStatus, "NONE" | "COMPLETED">;
    detail: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (workflow.topUpPaymentStatus === "COMPLETED") {
      return;
    }

    workflow.topUpPaymentStatus = input.status;
    workflow.topUpFailureReason = input.detail;
    workflow.surveyStatus = stageAfterBalanceUpdate(workflow, "BALANCE_PENDING");
    appendHistory(workflow, {
      actor,
      label:
        input.status === "CANCELLED"
          ? "Additional payment cancelled"
          : "Additional payment not completed",
      detail: input.detail,
    });
  });
}

export async function approveSurveyWorkflowForBooking(
  workflowId: string,
  actor: string,
  detail: string,
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyStatus = "READY_FOR_BOOKING";
    workflow.bookingApprovedAt = new Date().toISOString();
    workflow.surveyReviewedAt = workflow.surveyReviewedAt ?? workflow.bookingApprovedAt;
    appendHistory(workflow, {
      actor,
      label: "Approved for booking",
      detail,
    });
  });
}

export async function attachReplacementPaymentToWorkflow(
  workflowId: string,
  actor: string,
  input: {
    paymentId: string;
    uniquePaymentReference?: string;
    provider?: WorkflowProvider;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.currentPaymentId = input.paymentId;
    workflow.replacementPaymentId = input.paymentId;
    workflow.replacementUpr = input.uniquePaymentReference ?? workflow.replacementUpr;
    workflow.provider = input.provider ?? workflow.provider;
    workflow.paymentChoice = toPaymentChoice(workflow.provider);
    appendHistory(workflow, {
      actor,
      label: "Replacement payment created",
      detail: input.uniquePaymentReference
        ? `A replacement Frasers Plus authorization was created (${input.uniquePaymentReference}).`
        : `A replacement payment reference ${input.paymentId} was created.`,
    });
  });
}

export async function requestSurveyWorkflowRefund(
  workflowId: string,
  actor: string,
  reason: string,
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyStatus = "DECLINED";
    workflow.customerDecision = "DECLINED";
    workflow.customerDecisionAt = new Date().toISOString();
    workflow.refundStatus = "REQUESTED";
    workflow.refundReason = reason;
    workflow.refundRequestedAt = new Date().toISOString();
    if (workflow.topUpPaymentStatus === "PENDING") {
      workflow.topUpPaymentStatus = "CANCELLED";
      workflow.topUpFailureReason = "Customer chose to cancel the order instead of paying the amended balance.";
    }
    appendHistory(workflow, {
      actor,
      label: "Refund requested",
      detail: reason,
    });
  });
}

export async function approveSurveyWorkflowRefund(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.refundStatus = "APPROVED";
    workflow.refundApprovedAt = new Date().toISOString();
    appendHistory(workflow, {
      actor,
      label: "Refund approved",
      detail,
    });
  });
}

export async function completeSurveyWorkflowRefund(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.refundStatus = "COMPLETED";
    workflow.refundCompletedAt = new Date().toISOString();
    workflow.surveyStatus = "DECLINED";
    workflow.balanceDue = 0;
    if (workflow.topUpPaymentStatus !== "COMPLETED") workflow.topUpPaymentStatus = "CANCELLED";
    appendHistory(workflow, {
      actor,
      label: "Refund completed",
      detail,
    });
  });
}

export async function recordSurveyWorkflowRefundProviderResult(
  workflowId: string,
  actor: string,
  input: {
    succeeded: boolean;
    action: string;
    detail: string;
    outcome?: "COMPLETED" | "PENDING" | "FAILED" | "UNKNOWN";
    reference?: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.refundProviderAttemptedAt = new Date().toISOString();
    workflow.refundProviderResult = input.outcome === "COMPLETED" ? "SUCCEEDED" : input.outcome ?? (input.succeeded ? "SUCCEEDED" : "FAILED");
    workflow.refundProviderReference = input.reference ?? workflow.refundProviderReference;
    workflow.refundProviderAction = input.action;
    workflow.refundProviderDetail = input.detail;
    appendHistory(workflow, {
      actor,
      label: input.succeeded ? "Provider refund completed" : `Provider refund ${(input.outcome ?? "FAILED").toLowerCase()}`,
      detail: input.detail,
    });
  });
}

export async function completeSurveyWorkflowManualRefund(
  workflowId: string,
  actor: string,
  detail: string,
  record?: Omit<NonNullable<SurveyWorkflow["manualRefund"]>, "recordedAt" | "recordedBy" | "notes">,
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (workflow.refundStatus === "COMPLETED") return;
    const now = new Date().toISOString();
    workflow.refundStatus = "COMPLETED";
    workflow.refundCompletedAt = now;
    workflow.surveyStatus = "DECLINED";
    workflow.customerDecision = "DECLINED";
    workflow.customerDecisionAt = workflow.customerDecisionAt ?? now;
    workflow.refundReason = workflow.refundReason || detail;
    workflow.refundRequestedAt = workflow.refundRequestedAt ?? now;
    workflow.balanceDue = 0;
    if (workflow.topUpPaymentStatus !== "COMPLETED") {
      workflow.topUpPaymentStatus = "CANCELLED";
      workflow.topUpFailureReason = "Order closed after a full external refund; do not collect the remaining balance.";
    }
    if (record) workflow.manualRefund = { ...record, recordedAt: now, recordedBy: actor, notes: detail };
    appendHistory(workflow, {
      actor,
      label: "Manual refund completed",
      detail,
    });
  });
}

export async function rejectSurveyWorkflowRefund(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.refundStatus = "REJECTED";
    appendHistory(workflow, {
      actor,
      label: "Refund rejected",
      detail,
    });
  });
}

export async function markSurveyWorkflowBookedForInstallation(
  workflowId: string,
  actor: string,
  input: {
    installationDate?: string;
    installerName?: string;
    installerEmail?: string;
    installerPhone?: string;
    installerNotes?: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.surveyStatus = "BOOKED_FOR_INSTALLATION";
    workflow.bookedAt = new Date().toISOString();
    workflow.installationDate = input.installationDate?.trim() || workflow.installationDate;
    workflow.installerName = input.installerName?.trim() || workflow.installerName;
    workflow.installerEmail = input.installerEmail?.trim() || workflow.installerEmail;
    workflow.installerPhone = input.installerPhone?.trim() || workflow.installerPhone;
    workflow.installerNotes = input.installerNotes?.trim() || workflow.installerNotes;
    appendHistory(workflow, {
      actor,
      label: "Booked for installation",
      detail:
        input.installationDate?.trim()
          ? `Installation booked for ${input.installationDate.trim()}.`
          : "Installation booking details were recorded.",
    });
  });
}

export async function markSurveyWorkflowInstalled(
  workflowId: string,
  actor: string,
  detail = "Installation marked as installed.",
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    const installedAt = new Date().toISOString();
    workflow.surveyStatus = "INSTALLED";
    workflow.bookedAt = workflow.bookedAt ?? installedAt;
    workflow.bookingApprovedAt = workflow.bookingApprovedAt ?? workflow.bookedAt;
    workflow.jumptech = {
      ...(workflow.jumptech ?? {
        projectId: "",
        createdAt: installedAt,
      }),
      completedAt: workflow.jumptech?.completedAt ?? installedAt,
    };
    appendHistory(workflow, {
      actor,
      label: "Installation completed",
      detail,
    });
  });
}

export async function updateSurveyWorkflowChargerDispatch(
  workflowId: string,
  actor: string,
  input: {
    dispatched: boolean;
    expectedDeliveryDate?: string;
  },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    const expectedDeliveryDate = input.expectedDeliveryDate?.trim()
      ? normaliseDateOnly(input.expectedDeliveryDate)
      : null;

    if (input.dispatched) {
      const hadDispatch = Boolean(workflow.chargerDispatchedAt);
      workflow.chargerDispatchedAt = workflow.chargerDispatchedAt ?? new Date().toISOString();
      workflow.chargerExpectedDeliveryDate = expectedDeliveryDate ?? undefined;
      appendHistory(workflow, {
        actor,
        label: hadDispatch ? "Charger dispatch updated" : "Charger dispatched",
        detail: workflow.chargerExpectedDeliveryDate
          ? `The charger was marked as dispatched with an expected delivery date of ${formatDateOnlyLabel(workflow.chargerExpectedDeliveryDate)}.`
          : "The charger was marked as dispatched to the customer address.",
      });
      return;
    }

    const hadDispatch = Boolean(
      workflow.chargerDispatchedAt || workflow.chargerExpectedDeliveryDate,
    );
    workflow.chargerDispatchedAt = undefined;
    workflow.chargerExpectedDeliveryDate = undefined;
    if (hadDispatch) {
      appendHistory(workflow, {
        actor,
        label: "Charger dispatch cleared",
        detail: "The charger dispatch status was cleared and online cancellation was re-enabled.",
      });
    }
  });
}

export async function saveSurveyWorkflowPreferredInstallationDates(
  workflowId: string,
  actor: string,
  dates: string[],
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (!preferredDatesEnabledForWorkflow(workflow)) {
      throw new Error("Preferred date selection is not available for this order.");
    }
    workflow.preferredInstallationDates = [...dates].sort();
    workflow.preferredInstallationDatesUpdatedAt = new Date().toISOString();
    appendHistory(workflow, {
      actor,
      label: "Preferred installation dates saved",
      detail: `Customer selected ${workflow.preferredInstallationDates.join(", ")} as preferred installation dates.`,
    });
  });
}

export async function attachJumptechProjectToWorkflow(
  workflowId: string,
  actor: string,
  input: SurveyWorkflowJumptechProject,
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.jumptech = {
      ...workflow.jumptech,
      ...input,
      createdAt: workflow.jumptech?.createdAt ?? input.createdAt ?? new Date().toISOString(),
      lastError: undefined,
    };

    applyJumptechWorkflowSignals(workflow, input);

    appendHistory(workflow, {
      actor,
      label: "Jumptech project linked",
      detail: input.status
        ? `Jumptech project ${input.projectId} is now ${input.status}.`
        : `Jumptech project ${input.projectId} was linked to this order.`,
    });
  });
}

export async function reserveJumptechProjectCreation(workflowId: string, actor: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    if (workflow.jumptech?.projectId) {
      return;
    }

    workflow.jumptech = {
      ...(workflow.jumptech ?? {
        projectId: "",
        createdAt: new Date().toISOString(),
      }),
      lastError: "Jumptech project creation is in progress.",
    };

    appendHistory(workflow, {
      actor,
      label: "Jumptech project creation reserved",
      detail: "A Jumptech project creation request was reserved to prevent duplicate submissions.",
    });
  });
}

export async function recordJumptechProjectUpdate(
  projectId: string,
  actor: string,
  input: Partial<SurveyWorkflowJumptechProject>,
) {
  let workflow = await getPostSurveyWorkflowByJumptechProjectId(projectId);
  if (!workflow && input.integrationId) {
    const linkedWorkflow = await getPostSurveyWorkflowByJumptechIntegrationId(input.integrationId);
    if (linkedWorkflow && shouldRelinkJumptechProject(linkedWorkflow, { ...input, projectId })) {
      workflow = linkedWorkflow;
    }
  }

  if (!workflow) {
    return null;
  }

  return await withWorkflowMutation(workflow.id, (currentWorkflow) => {
    if (!currentWorkflow.jumptech) {
      currentWorkflow.jumptech = {
        projectId,
        createdAt: new Date().toISOString(),
      };
    }

    currentWorkflow.jumptech = {
      ...currentWorkflow.jumptech,
      ...input,
      projectId,
      lastError: undefined,
    };

    applyJumptechWorkflowSignals(currentWorkflow, input);

    appendHistory(currentWorkflow, {
      actor,
      label: "Jumptech status updated",
      detail: input.status
        ? `Jumptech project ${projectId} moved to ${input.status}.`
        : `Jumptech project ${projectId} was updated.`,
    });
  });
}

export async function recordJumptechProjectError(workflowId: string, actor: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.jumptech = {
      ...(workflow.jumptech ?? {
        projectId: "",
        createdAt: new Date().toISOString(),
      }),
      lastError: detail,
    };
    appendHistory(workflow, {
      actor,
      label: "Jumptech sync error",
      detail,
    });
  });
}

export async function recordAdditionalCostsEmailSent(
  workflowId: string,
  input: { amount: number; messageId?: string; recipient: string },
) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.additionalCostsEmailSentAt = new Date().toISOString();
    workflow.additionalCostsEmailSentAmount = input.amount;
    workflow.additionalCostsEmailMessageId = input.messageId;
    workflow.additionalCostsEmailFailure = undefined;
    appendHistory(workflow, {
      actor: "system",
      label: "Additional costs email sent",
      detail: `Additional costs email for ${formatMoneyValue(input.amount)} sent to ${input.recipient}.`,
    });
  });
}

export async function recordAdditionalCostsEmailFailure(workflowId: string, detail: string) {
  return await withWorkflowMutation(workflowId, (workflow) => {
    workflow.additionalCostsEmailFailure = detail;
    appendHistory(workflow, {
      actor: "system",
      label: "Additional costs email failed",
      detail,
    });
  });
}

export function findEligibleJumptechWorkflows(workflows: SurveyWorkflow[]) {
  return workflows.filter(
    (workflow) =>
      (workflow.provider === "CARD" || workflow.provider === "FRASERS_PLUS") &&
      isValidEmailAddress(workflow.customerEmail) &&
      isValidUkMobileNumber(workflow.customerPhone) &&
      Boolean(workflow.deliveryAddress?.line1 || workflow.billingAddress?.line1) &&
      Boolean(workflow.deliveryAddress?.postalCode || workflow.billingAddress?.postalCode) &&
      workflow.surveyStatus === "AWAITING_SURVEY" &&
      !workflow.surveyReceivedAt &&
      !workflow.surveyReviewedAt &&
      !workflow.amendedAmount &&
      !workflow.topUpPaymentId &&
      !workflow.replacementPaymentId &&
      !workflow.topUpRequestedAt &&
      workflow.topUpPaymentStatus === "NONE" &&
      (!workflow.jumptech ||
        (!workflow.jumptech.projectId &&
          workflow.jumptech.lastError !== "Jumptech project creation is in progress.")),
  );
}

export function getResolvedWorkflowAmount(workflow: SurveyWorkflow) {
  return workflow.amendedAmount ?? workflow.originalAmount;
}

export function getOutstandingWorkflowBalance(workflow: SurveyWorkflow) {
  if (workflow.refundStatus === "COMPLETED") return 0;
  if (workflow.topUpPaymentStatus === "COMPLETED") {
    return 0;
  }

  return Math.max(getResolvedWorkflowAmount(workflow) - workflow.originalAmount, 0);
}

export function canPayWorkflowBalance(workflow: SurveyWorkflow) {
  return (
    Boolean(workflow.reviewToken) &&
    getOutstandingWorkflowBalance(workflow) > 0.01 &&
    workflow.surveyStatus !== "DECLINED" &&
    !["REQUESTED", "APPROVED", "COMPLETED"].includes(workflow.refundStatus)
  );
}

export function getSurveyResponseDeadline(workflow: SurveyWorkflow) {
  return new Date(new Date(workflow.createdAt).getTime() + SURVEY_RESPONSE_WINDOW_MS).toISOString();
}

export function getPreferredInstallationWindowStart(workflow: SurveyWorkflow) {
  return toIsoDate(
    new Date(new Date(workflow.createdAt).getTime() + INSTALLATION_PREFERENCE_LEAD_TIME_MS),
  );
}

export function normalisePreferredInstallationDateList(dates: string[]) {
  return Array.from(
    new Set(
      dates
        .map((value) => normalisePreferredInstallationDate(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
}

export function isSurveyOverdue(workflow: SurveyWorkflow) {
  if (workflow.surveyReceivedAt) {
    return false;
  }

  if (
    workflow.surveyStatus === "DECLINED" ||
    workflow.surveyStatus === "READY_FOR_BOOKING" ||
    workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ||
    workflow.surveyStatus === "INSTALLED"
  ) {
    return false;
  }

  return Date.now() > new Date(getSurveyResponseDeadline(workflow)).getTime();
}

export function isWorkflowBooked(workflow: SurveyWorkflow) {
  return (
    Boolean(workflow.bookedAt) ||
    workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ||
    workflow.surveyStatus === "INSTALLED"
  );
}

export function hasWorkflowChargerDispatched(workflow: SurveyWorkflow) {
  return Boolean(workflow.chargerDispatchedAt);
}

export function canCustomerRequestCancellation(workflow: SurveyWorkflow) {
  if (
    workflow.surveyStatus === "DECLINED" ||
    workflow.surveyStatus === "INSTALLED" ||
    workflow.refundStatus === "REQUESTED" ||
    workflow.refundStatus === "APPROVED" ||
    workflow.refundStatus === "COMPLETED"
  ) {
    return false;
  }

  return !hasWorkflowChargerDispatched(workflow);
}

export function getCustomerWorkflowProgress(workflow: SurveyWorkflow) {
  if (workflow.refundStatus === "COMPLETED") {
    return [{ key: "refund", label: "Refund completed", value: workflow.manualRefund ? `The team has recorded a refund of GBP ${workflow.manualRefund.amount.toFixed(2)}.` : "The payment provider has confirmed your refund or reversal.", complete: true }];
  }
  const reviewed =
    Boolean(workflow.surveyReviewedAt) ||
    workflow.surveyStatus === "REVIEW_READY" ||
    workflow.surveyStatus === "BALANCE_PENDING" ||
    workflow.surveyStatus === "READY_FOR_BOOKING" ||
      workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ||
      workflow.surveyStatus === "INSTALLED" ||
      workflow.surveyStatus === "DECLINED";
  const booked = isWorkflowBooked(workflow);
  const chargerDispatched = hasWorkflowChargerDispatched(workflow);
  const outstandingBalance = getOutstandingWorkflowBalance(workflow);
  const surveyOverdueAction =
    workflow.provider === "FRASERS_PLUS"
      ? "The order may be cancelled and the Frasers Plus allocation reversed."
      : workflow.provider === "CARD"
        ? "The order may be cancelled and the card payment refunded."
        : "The order may be cancelled if the survey is not returned in time.";

  return [
    {
      key: "payment",
      label:
        workflow.topUpPaymentStatus === "COMPLETED"
          ? "Additional payment received"
          : outstandingBalance > 0
            ? "Original payment confirmed"
            : "Payment confirmed",
      value:
        workflow.topUpPaymentStatus === "COMPLETED"
          ? workflow.topUpPaymentChoice === "frasers-plus"
            ? "The amended balance was approved as a separate Frasers Plus top-up."
            : "The amended balance was paid as a separate card top-up."
          : workflow.provider === "FRASERS_PLUS"
            ? "Frasers Plus approved the original quoted amount when the order was placed."
            : workflow.provider === "CARD"
              ? "Your original card payment was taken when the order was placed."
              : "Payment has been confirmed for this order.",
      complete: true,
    },
    {
      key: "survey",
      label: workflow.surveyReceivedAt ? "Survey received" : "Survey not received yet",
      value: workflow.surveyReceivedAt
        ? "We have received your survey details."
        : isSurveyOverdue(workflow)
          ? `The survey has not been received within 3 days. Please contact VCHRGD immediately. ${surveyOverdueAction}`
          : `Waiting for the customer survey to be completed. If it is not received within 3 days, ${surveyOverdueAction.charAt(0).toLowerCase()}${surveyOverdueAction.slice(1)}`,
      complete: Boolean(workflow.surveyReceivedAt),
    },
    {
      key: "review",
      label: reviewed ? "Survey reviewed" : "Survey review pending",
      value: reviewed
        ? outstandingBalance > 0 && workflow.topUpPaymentStatus !== "COMPLETED"
          ? workflow.amendmentNotes ||
            `The survey has been reviewed and an additional ${getOutstandingWorkflowBalance(workflow).toFixed(2)} is required before booking can continue.`
          : workflow.adminNotes ||
            workflow.amendmentNotes ||
            "The survey has been reviewed by the operations team."
        : "The operations team will review the survey once it has been received.",
      complete: reviewed,
    },
    {
      key: "booking",
      label:
        workflow.surveyStatus === "INSTALLED"
          ? "Installation complete"
          : booked
            ? "Installation booked"
            : "Installation not booked yet",
      value: workflow.surveyStatus === "INSTALLED"
        ? workflow.installationDate || "Installation completed"
        : booked
        ? workflow.installationDate || "Booking confirmed"
        : workflow.surveyStatus === "BALANCE_PENDING"
          ? workflow.topUpPaymentStatus === "PENDING"
            ? "We are waiting for the separate top-up payment to be completed."
            : "We will confirm the booking once the additional payment is confirmed."
          : "We will confirm the booking once survey review is complete.",
      complete: booked,
    },
    {
      key: "charger",
      label: chargerDispatched
        ? "Charger dispatched"
        : booked
          ? "Charger not dispatched yet"
          : "Charger dispatch pending",
      value: chargerDispatched
        ? workflow.chargerExpectedDeliveryDate
          ? `Your charger has been dispatched to the installation address. Expected delivery: ${formatDateOnlyLabel(workflow.chargerExpectedDeliveryDate)}.`
          : "Your charger has been dispatched to the installation address."
        : booked
          ? "Your charger has not been marked as dispatched yet."
          : "The charger dispatch update will appear here once the installation is booked.",
      complete: chargerDispatched,
    },
    {
      key: "installer",
      label: "Installer name",
      value: workflow.installerName || "Installer not assigned yet",
      complete: Boolean(workflow.installerName),
    },
    {
      key: "date",
      label: workflow.surveyStatus === "INSTALLED" ? "Installation date" : "Expected installation date",
      value:
        workflow.installationDate ||
        (workflow.surveyStatus === "INSTALLED"
          ? "Installation completed"
          : "Installation date not confirmed yet"),
      complete: Boolean(workflow.installationDate),
    },
  ];
}

export type {
  RefundRequestStatus,
  SurveyWorkflow,
  SurveyWorkflowEvent,
  SurveyWorkflowJumptechJob,
  SurveyWorkflowJumptechProject,
  SurveyWorkflowStatus,
  TopUpPaymentStatus,
  WorkflowAddress,
  WorkflowPaymentChoice,
  WorkflowProvider,
};
