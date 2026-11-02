import Link from "next/link";
import { redirect } from "next/navigation";
import { BackofficeLiveRefresh } from "@/components/backoffice-live-refresh";
import { CheckoutClickAnalytics } from "@/components/checkout-click-summary";
import { LandingAnalytics } from "@/components/landing-analytics-summary";
import { preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";
import { BackofficeOrderSearch } from "@/components/backoffice-order-search";
import { BackofficeScrollRestoration } from "@/components/backoffice-scroll-restoration";
import { DeleteWorkflowButton } from "@/components/delete-workflow-button";
import { BackofficeRefundActions, ManualRefundForm, ProviderRefundForm } from "@/components/backoffice-refund-actions";
import { getAdminSession } from "@/lib/admin-auth";
import { getBootstrapAdminSummary } from "@/lib/admin-auth";
import { isSuperAdminUsername } from "@/lib/admin-auth";
import {
  buildManagedAdminOtpAuthUri,
  listManagedAdminUsers,
  type ManagedAdminUser,
} from "@/lib/admin-users";
import {
  getCheckoutInteractionEffectiveStatus,
  getCheckoutInteractionLossPoint,
  hasSubmittedCheckoutDetails,
  listCheckoutInteractions,
  type CheckoutInteraction,
} from "@/lib/checkout-interactions";
import {
  getMerchantDashboardState,
  type AuditEvent,
  type PaymentSession,
} from "@/lib/frasers-plus-merchant-state";
import {
  getSurveyResponseDeadline,
  getResolvedWorkflowAmount,
  isSurveyOverdue,
  syncPostSurveyWorkflows,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";
import { getProductSettings, type ProductDiscount } from "@/lib/product-settings";
import { getInstallerDirectory, matchInstallerByNameInDirectory, type InstallerMatch, type InstallerRecord } from "@/lib/installers";
import { listWorkOrders, type WorkOrderRecord } from "@/lib/work-orders";
import {
  BACKOFFICE_ORDER_FILTER_KEYS,
  listBackofficeSavedViews,
} from "@/lib/backoffice-saved-views";

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type BackofficeTab =
  | "orders"
  | "stalled"
  | "booking"
  | "booked"
  | "installed"
  | "details"
  | "journey"
  | "kpis"
  | "survey"
  | "refunds"
  | "audit"
  | "products"
  | "installers"
  | "access";
type SortDirection = "desc" | "asc";
type SearchParamRecord = Record<string, string | string[] | undefined>;
type WorkflowOrderEntry = {
  kind: "workflow";
  workflow: SurveyWorkflow;
  payment: PaymentSession | null;
  workOrder: WorkOrderRecord | null;
};
type StalledOrderEntry = {
  kind: "stalled";
  interaction: CheckoutInteraction;
};
type AllOrdersEntry = WorkflowOrderEntry | StalledOrderEntry;
type OrderSortKey =
  | "ordered"
  | "customer"
  | "amount"
  | "stage"
  | "installation"
  | "installer"
  | "jumptech";
type OrderSlaState = {
  level: "clear" | "attention" | "overdue";
  label: string;
  detail: string;
};

const filterInputClassName =
  "min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-[#00eaff] focus:ring-4 focus:ring-[#00eaff]/15";
const RECORDS_PER_PAGE = 25;
const ORDER_STAGE_OPTIONS = [
  ["awaiting-survey", "Awaiting survey"],
  ["review", "Survey for review"],
  ["ready", "Ready for booking"],
  ["booked", "Booked"],
  ["installed", "Installed"],
  ["declined", "Declined"],
] as const;

function formatMoney(amount?: number, currency = "GBP") {
  if (amount === undefined) {
    return "Not set";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "Not available";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatPreferredInstallationDate(value?: string) {
  if (!value) {
    return "Not provided";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPreferredInstallationDates(values?: string[]) {
  if (!values?.length) {
    return "Not provided";
  }

  return values.map((value) => formatPreferredInstallationDate(value)).join(" | ");
}

function isInCurrentWeek(value?: string) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  const start = new Date(now);
  const dayOffset = (now.getDay() + 6) % 7;
  start.setDate(now.getDate() - dayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return date >= start && date < end;
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function readMultiParam(params: SearchParamRecord, key: string) {
  const value = params[key];
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return Array.from(
    new Set(values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)),
  );
}

function readSortDirection(
  params: SearchParamRecord,
  key: string,
): SortDirection {
  return readParam(params, key) === "asc" ? "asc" : "desc";
}

function readPageNumber(params: SearchParamRecord, key: string) {
  const parsed = Number.parseInt(readParam(params, key), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function paginateRecords<T>(
  records: T[],
  params: SearchParamRecord,
  pageParam: string,
  pageSize = RECORDS_PER_PAGE,
) {
  const totalItems = records.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(readPageNumber(params, pageParam), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    currentPage,
    endIndex,
    items: records.slice(startIndex, endIndex),
    pageParam,
    pageSize,
    startIndex,
    totalItems,
    totalPages,
  };
}

type PaginationState = {
  currentPage: number;
  endIndex: number;
  pageParam: string;
  pageSize: number;
  startIndex: number;
  totalItems: number;
  totalPages: number;
};

function getPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const candidates = new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);

  return Array.from(candidates)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

function buildPaginationHref(
  params: SearchParamRecord,
  pagination: PaginationState,
  page: number,
) {
  return buildBackofficeHref(params, {
    [pagination.pageParam]: page === 1 ? null : String(page),
    openBooking: null,
    openJourney: null,
    openSurvey: null,
  });
}

function buildBackofficeHref(
  params: SearchParamRecord,
  overrides: Record<string, string | null | undefined> = {},
  hash?: string,
) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const normalised = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of normalised) {
      if (item) {
        search.append(key, item);
      }
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!value) {
      search.delete(key);
    } else {
      search.set(key, value);
    }
  }

  const query = search.toString();
  return `/backoffice${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

function matchesDateRange(value: string | undefined, from: string, to: string) {
  if (!from && !to) {
    return true;
  }

  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }

  if (from) {
    const fromTime = new Date(`${from}T00:00:00`).getTime();
    if (!Number.isNaN(fromTime) && timestamp < fromTime) {
      return false;
    }
  }

  if (to) {
    const toTime = new Date(`${to}T23:59:59.999`).getTime();
    if (!Number.isNaN(toTime) && timestamp > toTime) {
      return false;
    }
  }

  return true;
}

function includesQuery(parts: Array<string | null | undefined>, query: string) {
  if (!query) {
    return true;
  }

  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function isSuccessfulPayment(payment: PaymentSession) {
  const status = payment.latestStatus?.status?.toUpperCase();
  return (
    status === "COMPLETED" ||
    status === "APPROVED" ||
    status === "AUTHORISED" ||
    status === "AUTHORIZED"
  );
}

function isPaidPayment(payment: PaymentSession | null) {
  const status = payment?.latestStatus?.status?.toUpperCase();
  return status === "COMPLETED" || status === "PAID" || status === "CAPTURED";
}

function getConfirmedWorkflowPayment(
  workflow: SurveyWorkflow,
  paymentById: Map<string, PaymentSession>,
) {
  const candidates = [
    workflow.sourcePaymentId,
    workflow.currentPaymentId,
    workflow.replacementPaymentId,
  ]
    .filter((value): value is string => Boolean(value))
    .map((paymentId) => paymentById.get(paymentId))
    .filter((payment): payment is PaymentSession => Boolean(payment));

  return candidates.find(isSuccessfulPayment) ?? null;
}

function getWorkflowPayment(
  workflow: SurveyWorkflow,
  paymentById: Map<string, PaymentSession>,
) {
  return (
    getConfirmedWorkflowPayment(workflow, paymentById) ??
    paymentById.get(workflow.currentPaymentId) ??
    paymentById.get(workflow.sourcePaymentId) ??
    (workflow.replacementPaymentId
      ? paymentById.get(workflow.replacementPaymentId)
      : undefined) ??
    null
  );
}

function isSurveyReviewStage(workflow: SurveyWorkflow) {
  return (
    workflow.surveyStatus !== "READY_FOR_BOOKING" &&
    workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
    workflow.surveyStatus !== "INSTALLED"
  );
}

function hasReturnedSurvey(workflow: SurveyWorkflow) {
  return (
    Boolean(workflow.surveyReceivedAt) ||
    workflow.surveyStatus === "SURVEY_RECEIVED" ||
    workflow.surveyStatus === "REVIEW_READY" ||
    workflow.surveyStatus === "BALANCE_PENDING" ||
    workflow.surveyStatus === "READY_FOR_BOOKING"
  );
}

function isOperationalWorkflow(
  workflow: SurveyWorkflow,
  paymentById: Map<string, PaymentSession>,
) {
  return Boolean(workflow.jumptech?.projectId) && Boolean(getConfirmedWorkflowPayment(workflow, paymentById));
}

function isSurveyReviewWorkflow(
  workflow: SurveyWorkflow,
  paymentById: Map<string, PaymentSession>,
) {
  return (
    !["REQUESTED", "APPROVED", "COMPLETED"].includes(workflow.refundStatus) &&
    isSurveyReviewStage(workflow) &&
    !hasReturnedSurvey(workflow) &&
    isOperationalWorkflow(workflow, paymentById)
  );
}

function isBookingWorkflow(
  workflow: SurveyWorkflow,
  paymentById: Map<string, PaymentSession>,
) {
  return (
    !["REQUESTED", "APPROVED", "COMPLETED"].includes(workflow.refundStatus) &&
    workflow.surveyStatus !== "BOOKED_FOR_INSTALLATION" &&
    workflow.surveyStatus !== "INSTALLED" &&
    hasReturnedSurvey(workflow) &&
    isOperationalWorkflow(workflow, paymentById)
  );
}

function percentage(value: number, total: number) {
  if (!total) {
    return "0%";
  }

  return `${Math.round((value / total) * 100)}%`;
}

function toDayKey(value?: string) {
  return value ? value.slice(0, 10) : "";
}

function sumPaymentAmounts(payments: PaymentSession[]) {
  return payments.reduce((total, payment) => total + (payment.amount ?? 0), 0);
}

function toTimestamp(value?: string) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getSafeSurveyResponseDeadline(workflow: SurveyWorkflow) {
  return toTimestamp(workflow.createdAt) > 0
    ? getSurveyResponseDeadline(workflow)
    : undefined;
}

function compareDates(left?: string, right?: string, direction: SortDirection = "desc") {
  const difference = toTimestamp(left) - toTimestamp(right);
  return direction === "asc" ? difference : -difference;
}

function sortByDate<T>(
  items: T[],
  direction: SortDirection,
  getDate: (item: T) => string | undefined,
) {
  return [...items].sort((left, right) =>
    compareDates(getDate(left), getDate(right), direction),
  );
}

function getWorkflowSubmissionDate(workflow: SurveyWorkflow) {
  return workflow.createdAt || workflow.updatedAt;
}

function getJourneySubmissionDate(
  interaction: CheckoutInteraction,
) {
  return interaction.detailsSubmittedAt || interaction.startedAt || interaction.updatedAt;
}

function isInteractionPaid(
  interaction: CheckoutInteraction,
  paymentById: Map<string, PaymentSession>,
) {
  return (
    getCheckoutInteractionEffectiveStatus(interaction) === "PAYMENT_COMPLETED" ||
    Boolean(paymentById.get(interaction.paymentId) && isSuccessfulPayment(paymentById.get(interaction.paymentId)!))
  );
}

function getInteractionCustomerKey(interaction: CheckoutInteraction) {
  const email = interaction.customerEmail?.trim().toLowerCase();
  const phone = interaction.customerPhone?.replace(/\D/g, "");

  if (email || phone) {
    return `${email || "no-email"}|${phone || "no-phone"}`;
  }

  return interaction.paymentId;
}

function dedupeCheckoutInteractions(interactions: CheckoutInteraction[]) {
  const latestByCustomer = new Map<string, CheckoutInteraction>();

  for (const interaction of interactions) {
    const key = getInteractionCustomerKey(interaction);
    const existing = latestByCustomer.get(key);

    if (
      !existing ||
      toTimestamp(interaction.updatedAt || getJourneySubmissionDate(interaction)) >
        toTimestamp(existing.updatedAt || getJourneySubmissionDate(existing))
    ) {
      latestByCustomer.set(key, interaction);
    }
  }

  return Array.from(latestByCustomer.values());
}

function getJourneyOutcomeKey(
  interaction: CheckoutInteraction,
) {
  const effectiveStatus = getCheckoutInteractionEffectiveStatus(interaction);

  if (effectiveStatus === "PAYMENT_COMPLETED") {
    return "converted";
  }

  if (effectiveStatus === "EXITED_SURVEY_LATER") {
    return "survey-exit";
  }

  if (interaction.status === "PAYMENT_PENDING" && effectiveStatus === "PAYMENT_PENDING") {
    return "payment-handoff";
  }

  if (effectiveStatus === "ABANDONED") {
    return "stalled";
  }

  return "active";
}

function getJourneyOutcomeLabel(
  interaction: CheckoutInteraction,
) {
  switch (getJourneyOutcomeKey(interaction)) {
    case "converted":
      return "Converted";
    case "survey-exit":
      return "Exited to finish survey";
    case "payment-handoff":
      return "In secure payment handoff";
    case "stalled":
      return "Interest stalled";
    default:
      return "Active in checkout";
  }
}

function getStepLabel(step: number) {
  switch (step) {
    case 1:
      return "Selection";
    case 2:
      return "Property";
    case 3:
      return "Parking";
    case 4:
      return "Cable run";
    case 5:
      return "Details";
    case 6:
      return "Payment";
    default:
      return `Step ${step}`;
  }
}

function getTabHref(tab: BackofficeTab) {
  return tab === "orders" ? "/backoffice" : `/backoffice?tab=${tab}`;
}

function getWorkflowExtraCosts(workflow: SurveyWorkflow) {
  return (
    workflow.additionalInstallationCosts ??
    workflow.jumptech?.additionalInstallationCosts ??
    Math.max(getResolvedWorkflowAmount(workflow) - workflow.originalAmount, 0)
  );
}

function getAllOrdersStage(workflow: SurveyWorkflow) {
  if (workflow.surveyStatus === "INSTALLED") {
    return "installed";
  }
  if (workflow.surveyStatus === "BOOKED_FOR_INSTALLATION") {
    return "booked";
  }
  if (workflow.surveyStatus === "READY_FOR_BOOKING") {
    return "ready";
  }
  if (workflow.surveyStatus === "DECLINED") {
    return "declined";
  }
  if (hasReturnedSurvey(workflow)) {
    return "review";
  }
  return "awaiting-survey";
}

function getAllOrdersDetailHref(workflow: SurveyWorkflow, params: SearchParamRecord) {
  return buildBackofficeHref(params, {
    tab: "orders",
    focusOrder: workflow.id,
    openBooking: null,
    openJourney: null,
    openSurvey: null,
  });
}

function readOrderSortKey(params: SearchParamRecord): OrderSortKey {
  const value = readParam(params, "orderSortBy");
  return [
    "ordered",
    "customer",
    "amount",
    "stage",
    "installation",
    "installer",
    "jumptech",
  ].includes(value)
    ? value as OrderSortKey
    : "ordered";
}

function hoursSince(value?: string) {
  if (!value) {
    return 0;
  }
  return Math.max(0, (Date.now() - toTimestamp(value)) / (60 * 60 * 1000));
}

function formatElapsedHours(hours: number) {
  if (hours >= 48) {
    return `${Math.floor(hours / 24)} days`;
  }
  if (hours >= 1) {
    return `${Math.floor(hours)} hours`;
  }
  return "under 1 hour";
}

function getOrderSla(entry: AllOrdersEntry): OrderSlaState {
  if (entry.kind === "stalled") {
    const stalledFor = hoursSince(entry.interaction.updatedAt);
    return {
      level: stalledFor >= 24 ? "overdue" : "attention",
      label: stalledFor >= 24 ? "Long-term stall" : "Recent stall",
      detail: `No checkout activity for ${formatElapsedHours(stalledFor)}.`,
    };
  }

  const { workflow, workOrder } = entry;
  const stage = getAllOrdersStage(workflow);
  if (stage === "installed" || stage === "declined") {
    return {
      level: "clear",
      label: stage === "installed" ? "Complete" : "Closed",
      detail: stage === "installed" ? "Installation is recorded as complete." : "No active operational action is due.",
    };
  }

  if (stage === "awaiting-survey") {
    const deadline = toTimestamp(getSafeSurveyResponseDeadline(workflow));
    if (!deadline) {
      return {
        level: "attention",
        label: "Survey date unavailable",
        detail: "The historic order date is invalid and needs review.",
      };
    }
    const remainingHours = (deadline - Date.now()) / (60 * 60 * 1000);
    if (remainingHours < 0) {
      return {
        level: "overdue",
        label: "Survey overdue",
        detail: `Survey passed its return deadline ${formatElapsedHours(Math.abs(remainingHours))} ago.`,
      };
    }
    if (remainingHours <= 24) {
      return {
        level: "attention",
        label: "Survey due soon",
        detail: `Survey deadline is in ${formatElapsedHours(remainingHours)}.`,
      };
    }
    return {
      level: "clear",
      label: "Within survey window",
      detail: `Survey deadline is in ${formatElapsedHours(remainingHours)}.`,
    };
  }

  if (stage === "review") {
    if (workflow.surveyStatus === "BALANCE_PENDING") {
      return {
        level: "attention",
        label: "Customer action",
        detail: "Additional-cost approval or payment is pending.",
      };
    }
    const reviewWait = hoursSince(workflow.surveyReceivedAt || workflow.updatedAt);
    return {
      level: reviewWait >= 24 ? "overdue" : "attention",
      label: reviewWait >= 24 ? "Review waiting 24h+" : "Review required",
      detail: `Survey has awaited review for ${formatElapsedHours(reviewWait)}.`,
    };
  }

  if (stage === "ready") {
    const bookingWait = hoursSince(
      workflow.bookingApprovedAt || workflow.surveyReviewedAt || workflow.updatedAt,
    );
    return {
      level: bookingWait >= 48 ? "overdue" : "attention",
      label: bookingWait >= 48 ? "Booking waiting 48h+" : "Ready to book",
      detail: `Order has awaited booking for ${formatElapsedHours(bookingWait)}.`,
    };
  }

  if (!workflow.installationDate) {
    return {
      level: "overdue",
      label: "Install date missing",
      detail: "The order is marked booked but has no installation date.",
    };
  }
  if (!workflow.installerName && !workOrder?.installerMatchedName) {
    return {
      level: "overdue",
      label: "Installer missing",
      detail: "The order is booked but no installer is assigned.",
    };
  }
  if (!workOrder) {
    return {
      level: "attention",
      label: "PO required",
      detail: "Installer is assigned but the purchase order is not generated.",
    };
  }

  const installationTime = toTimestamp(`${workflow.installationDate}T00:00:00`);
  const hoursToInstall = (installationTime - Date.now()) / (60 * 60 * 1000);
  if (!workflow.chargerDispatchedAt && hoursToInstall <= 72) {
    return {
      level: "overdue",
      label: "Dispatch urgent",
      detail: "Installation is within 3 days and charger dispatch is not recorded.",
    };
  }

  return {
    level: "clear",
    label: "On track",
    detail: "No current operational SLA warning.",
  };
}

function sortAllOrderEntries(
  entries: AllOrdersEntry[],
  key: OrderSortKey,
  direction: SortDirection,
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const stageRank: Record<string, number> = {
    stalled: 0,
    "awaiting-survey": 1,
    review: 2,
    ready: 3,
    booked: 4,
    installed: 5,
    declined: 6,
  };
  const getStringValue = (entry: AllOrdersEntry) => {
    if (key === "customer") {
      return entry.kind === "workflow"
        ? entry.workflow.customerName || ""
        : [entry.interaction.customerFirstName, entry.interaction.customerLastName].filter(Boolean).join(" ");
    }
    if (key === "installer") {
      return entry.kind === "workflow"
        ? entry.workflow.installerName || entry.workOrder?.installerMatchedName || ""
        : "";
    }
    if (key === "jumptech") {
      return entry.kind === "workflow"
        ? entry.workflow.jumptech?.currentStatusLabel || entry.workflow.jumptech?.status || ""
        : "";
    }
    return "";
  };
  const getNumberValue = (entry: AllOrdersEntry) => {
    if (key === "ordered") {
      return entry.kind === "workflow"
        ? toTimestamp(entry.payment?.createdAt || entry.workflow.createdAt)
        : toTimestamp(entry.interaction.startedAt);
    }
    if (key === "amount") {
      return entry.kind === "workflow"
        ? getResolvedWorkflowAmount(entry.workflow)
        : entry.interaction.total ?? 0;
    }
    if (key === "stage") {
      return stageRank[entry.kind === "workflow" ? getAllOrdersStage(entry.workflow) : "stalled"];
    }
    if (key === "installation") {
      return entry.kind === "workflow" ? toTimestamp(entry.workflow.installationDate) : 0;
    }
    return 0;
  };

  return [...entries].sort((left, right) => {
    if (key === "customer" || key === "installer" || key === "jumptech") {
      return getStringValue(left).localeCompare(getStringValue(right)) * directionMultiplier;
    }
    return (getNumberValue(left) - getNumberValue(right)) * directionMultiplier;
  });
}

function formatWorkflowStatus(status: SurveyWorkflow["surveyStatus"]) {
  return status.replaceAll("_", " ");
}

function formatRefundStatus(status: SurveyWorkflow["refundStatus"]) {
  return status.replaceAll("_", " ");
}

function formatTopUpStatus(status: SurveyWorkflow["topUpPaymentStatus"]) {
  return status.replaceAll("_", " ");
}

function formatPaymentRoute(
  choice?: SurveyWorkflow["paymentChoice"] | SurveyWorkflow["topUpPaymentChoice"],
) {
  return choice === "frasers-plus"
    ? "Frasers Plus"
    : choice === "card"
      ? "Card"
      : "Not selected";
}

export default async function AdminPage() {
  redirect("/backoffice");
}

export async function AdminDashboardScreen({ searchParams }: AdminPageProps = {}) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/backoffice/login");
  }
  const isSuperAdmin = await isSuperAdminUsername(session.sub);

  const params = (await searchParams) ?? {};
  const focusedOrderId = readParam(params, "focusOrder");
  const openJourneyId = readParam(params, "openJourney");
  const openSurveyId = readParam(params, "openSurvey");
  const openBookingId = readParam(params, "openBooking");
  const tabParam = readParam(params, "tab");
  const activeTab: BackofficeTab =
    tabParam === "orders" ||
    tabParam === "stalled" ||
    tabParam === "booking" ||
    tabParam === "journey" ||
    tabParam === "details" ||
    tabParam === "booked" ||
    tabParam === "installed" ||
    tabParam === "audit" ||
    tabParam === "access" ||
    tabParam === "products" ||
    tabParam === "installers" ||
    tabParam === "kpis" ||
    tabParam === "survey" ||
    tabParam === "refunds"
      ? tabParam
      : "orders";

  const bootstrapAdmin = getBootstrapAdminSummary();
  const [
    merchantDashboardState,
    interactions,
    managedAdminUsers,
    productSettings,
    installerDirectory,
    workOrderRecords,
    savedOrderViews,
  ] = await Promise.all([
    getMerchantDashboardState(200),
    listCheckoutInteractions(),
    listManagedAdminUsers(),
    getProductSettings(),
    getInstallerDirectory(),
    listWorkOrders(),
    listBackofficeSavedViews(session.sub),
  ]);
  const payments = merchantDashboardState.payments;
  const auditEvents = merchantDashboardState.auditEvents;
  const allWorkflows = await syncPostSurveyWorkflows(payments, interactions);
  const workflows = allWorkflows.filter((workflow) => !workflow.archivedAt);
  const installerById = new Map(
    installerDirectory.installers.map((installer) => [installer.id, installer]),
  );
  const workOrderByWorkflowId = new Map(
    workOrderRecords.map((record) => [record.workflowId, record]),
  );
  const workOrderEntries = workflows.map((workflow) => {
    const record = workOrderByWorkflowId.get(workflow.id) ?? null;
    const entry: [
      string,
      {
        record: WorkOrderRecord | null;
        installer: InstallerRecord | null;
        match: InstallerMatch | null;
      },
    ] = [
      workflow.id,
      {
        record,
        installer: record ? installerById.get(record.installerId) ?? null : null,
        match: matchInstallerByNameInDirectory(installerDirectory, workflow.installerName),
      },
    ];
    return entry;
  });
  const workOrders = new Map(workOrderEntries);
  const productState = readParam(params, "productState");
  const productError = readParam(params, "productError");
  const viewState = readParam(params, "viewState");
  const viewError = readParam(params, "viewError");
  const activeSavedViewId = readParam(params, "savedView");
  const installerState = readParam(params, "installerState");
  const installerError = readParam(params, "installerError");
  const manualPaymentError = readParam(params, "manualPaymentError");
  const bookingError = readParam(params, "bookingError");
  const refundError = readParam(params, "refundError");
  const paymentById = new Map(payments.map((payment) => [payment.paymentId, payment]));

  const frasersPlusCount = payments.filter((payment) => payment.provider === "FRASERS_PLUS").length;
  const cardCount = payments.filter((payment) => payment.provider === "CARD").length;
  const completedValue = payments.reduce((total, payment) => {
    if (isSuccessfulPayment(payment)) {
      return total + (payment.amount ?? 0);
    }
    return total;
  }, 0);
  const stalledJourneyCount = interactions.filter(
    (interaction) => getJourneyOutcomeKey(interaction) === "stalled",
  ).length;
  const refundRequestCount = workflows.filter((workflow) => workflow.refundStatus === "REQUESTED").length;
  const surveyReviewWorkflows = workflows.filter((workflow) =>
    isSurveyReviewWorkflow(workflow, paymentById),
  );
  const overdueSurveyCount = surveyReviewWorkflows.filter((workflow) => isSurveyOverdue(workflow)).length;
  const readyForBookingCount = workflows.filter(
    (workflow) => isBookingWorkflow(workflow, paymentById),
  ).length;
  const bookedInstallationCount = workflows.filter(
    (workflow) => workflow.surveyStatus === "BOOKED_FOR_INSTALLATION",
  ).length;
  const installedInstallationCount = workflows.filter(
    (workflow) => workflow.surveyStatus === "INSTALLED",
  ).length;
  const accessState = readParam(params, "accessState");
  const accessError = readParam(params, "accessError");
  const [accessAction, accessUserId] = accessState.includes(":")
    ? accessState.split(":", 2)
    : [accessState, ""];

  const bookingProviderFilter = readParam(params, "bookingProvider");
  const bookingQuery = readParam(params, "bookingQuery");
  const bookingSort = readSortDirection(params, "bookingSort");
  const bookingWorkflows = workflows.filter(
    (workflow) => isBookingWorkflow(workflow, paymentById),
  );
  const bookedWorkflows = workflows.filter(
    (workflow) => workflow.surveyStatus === "BOOKED_FOR_INSTALLATION",
  );
  const installedWorkflows = workflows.filter(
    (workflow) => workflow.surveyStatus === "INSTALLED",
  );
  const filteredBookingWorkflows = sortByDate(
    bookingWorkflows.filter((workflow) => {
    if (
      bookingProviderFilter &&
      bookingProviderFilter !== "all" &&
      (workflow.provider ?? "NONE") !== bookingProviderFilter
    ) {
      return false;
    }

    return includesQuery(
      [
        workflow.sourcePaymentId,
        workflow.currentPaymentId,
        workflow.customerName,
        workflow.customerEmail,
        workflow.customerPhone,
        workflow.chargerName,
        workflow.installerName,
        preferredDatesEnabledForWorkflow(workflow) ? workflow.preferredInstallationDates?.join(" ") : undefined,
      ],
      bookingQuery,
    );
    }),
    bookingSort,
    getWorkflowSubmissionDate,
  );
  const filteredBookedWorkflows = sortByDate(
    bookedWorkflows.filter((workflow) => {
      if (
        bookingProviderFilter &&
        bookingProviderFilter !== "all" &&
        (workflow.provider ?? "NONE") !== bookingProviderFilter
      ) {
        return false;
      }

      return includesQuery(
        [
          workflow.sourcePaymentId,
          workflow.currentPaymentId,
          workflow.customerName,
          workflow.customerEmail,
          workflow.customerPhone,
          workflow.chargerName,
          workflow.installerName,
          workflow.installationDate,
          preferredDatesEnabledForWorkflow(workflow) ? workflow.preferredInstallationDates?.join(" ") : undefined,
        ],
        bookingQuery,
      );
    }),
    bookingSort,
    (workflow) => workflow.installationDate || workflow.bookedAt || getWorkflowSubmissionDate(workflow),
  );
  const filteredInstalledWorkflows = sortByDate(
    installedWorkflows.filter((workflow) => {
      if (
        bookingProviderFilter &&
        bookingProviderFilter !== "all" &&
        (workflow.provider ?? "NONE") !== bookingProviderFilter
      ) {
        return false;
      }

      return includesQuery(
        [
          workflow.sourcePaymentId,
          workflow.currentPaymentId,
          workflow.customerName,
          workflow.customerEmail,
          workflow.customerPhone,
          workflow.chargerName,
          workflow.installerName,
          workflow.installationDate,
          workflow.jumptech?.completedAt,
        ],
        bookingQuery,
      );
    }),
    bookingSort,
    (workflow) => workflow.jumptech?.completedAt || workflow.installationDate || workflow.bookedAt || getWorkflowSubmissionDate(workflow),
  );

  const journeyOutcomeFilter = readParam(params, "journeyOutcome");
  const journeyStepFilter = readParam(params, "journeyStep");
  const journeyDetailsFilter = readParam(params, "journeyDetails");
  const journeyPaymentFilter = readParam(params, "journeyPayment");
  const journeyQuery = readParam(params, "journeyQuery");
  const journeySort = readSortDirection(params, "journeySort");
  const detailsSubmittedInteractions = sortByDate(
    dedupeCheckoutInteractions(
      interactions.filter(
        (interaction) =>
          hasSubmittedCheckoutDetails(interaction) &&
          !isInteractionPaid(interaction, paymentById),
      ),
    ),
    "desc",
    getJourneySubmissionDate,
  );
  const filteredInteractions = sortByDate(
    interactions.filter((interaction) => {
    if (hasSubmittedCheckoutDetails(interaction)) {
      return false;
    }

    if (
      journeyOutcomeFilter &&
      journeyOutcomeFilter !== "all" &&
      getJourneyOutcomeKey(interaction) !== journeyOutcomeFilter
    ) {
      return false;
    }

    if (journeyStepFilter && journeyStepFilter !== "all" && String(interaction.lastStep) !== journeyStepFilter) {
      return false;
    }

    if (journeyDetailsFilter === "pre-details" && hasSubmittedCheckoutDetails(interaction)) {
      return false;
    }

    if (
      journeyDetailsFilter === "details-submitted" &&
      !hasSubmittedCheckoutDetails(interaction)
    ) {
      return false;
    }

    if (journeyPaymentFilter === "undecided" && interaction.paymentChoice) {
      return false;
    }

    if (
      journeyPaymentFilter &&
      journeyPaymentFilter !== "all" &&
      journeyPaymentFilter !== "undecided" &&
      interaction.paymentChoice !== journeyPaymentFilter
    ) {
      return false;
    }

    return includesQuery(
      [
        interaction.paymentId,
        interaction.chargerName,
        interaction.customerFirstName,
        interaction.customerLastName,
        interaction.customerEmail,
        interaction.customerPhone,
        interaction.billingLine1,
        interaction.billingCity,
        interaction.billingPostalCode,
      ],
      journeyQuery,
    );
    }),
    journeySort,
    getJourneySubmissionDate,
  );

  const auditTargetFilter = readParam(params, "auditTarget");
  const auditQuery = readParam(params, "auditQuery");
  const auditSort = readSortDirection(params, "auditSort");
  const filteredAuditEvents = sortByDate(
    auditEvents.filter((event) => {
    if (auditTargetFilter && auditTargetFilter !== "all" && event.target !== auditTargetFilter) {
      return false;
    }

    return includesQuery(
      [event.action, event.actor, event.detail, event.paymentId, event.provider],
      auditQuery,
    );
    }),
    auditSort,
    (event) => event.createdAt,
  );

  const surveyStatusFilter = readParam(params, "surveyStatus");
  const surveyProviderFilter = readParam(params, "surveyProvider");
  const surveyQuery = readParam(params, "surveyQuery");
  const surveySort = readSortDirection(params, "surveySort");
  const surveyWorkflows = surveyReviewWorkflows;
  const filteredSurveyWorkflows = sortByDate(
    surveyWorkflows.filter((workflow) => {
    if (
      surveyStatusFilter &&
      surveyStatusFilter !== "all" &&
      workflow.surveyStatus !== surveyStatusFilter
    ) {
      return false;
    }

    if (
      surveyProviderFilter &&
      surveyProviderFilter !== "all" &&
      (workflow.provider ?? "NONE") !== surveyProviderFilter
    ) {
      return false;
    }

    return includesQuery(
      [
        workflow.sourcePaymentId,
        workflow.currentPaymentId,
        workflow.customerName,
        workflow.customerEmail,
        workflow.customerPhone,
        workflow.chargerName,
        workflow.amendmentNotes,
        workflow.billingAddress?.postalCode,
        preferredDatesEnabledForWorkflow(workflow) ? workflow.preferredInstallationDates?.join(" ") : undefined,
      ],
      surveyQuery,
    );
    }),
    surveySort,
    getWorkflowSubmissionDate,
  );

  const refundStatusFilter = readParam(params, "refundStatus");
  const refundQuery = readParam(params, "refundQuery");
  const refundSort = readSortDirection(params, "refundSort");
  const filteredRefundWorkflows = sortByDate(
    workflows.filter((workflow) => {
    if (workflow.refundStatus === "NONE") {
      return false;
    }

    if (
      refundStatusFilter &&
      refundStatusFilter !== "all" &&
      workflow.refundStatus !== refundStatusFilter
    ) {
      return false;
    }

    return includesQuery(
      [
        workflow.sourcePaymentId,
        workflow.currentPaymentId,
        workflow.customerName,
        workflow.customerEmail,
        workflow.customerPhone,
        workflow.chargerName,
        workflow.refundReason,
      ],
      refundQuery,
    );
    }),
    refundSort,
    getWorkflowSubmissionDate,
  );

  const validOrderStages = new Set(ORDER_STAGE_OPTIONS.map(([value]) => value));
  const orderStageFilters = readMultiParam(params, "orderStage").filter((value) =>
    validOrderStages.has(value as (typeof ORDER_STAGE_OPTIONS)[number][0]),
  );
  const orderProviderFilter = readParam(params, "orderProvider");
  const orderPaymentFilter = readParam(params, "orderPayment");
  const orderInstallerFilter = readParam(params, "orderInstaller");
  const orderPoFilter = readParam(params, "orderPo");
  const orderDispatchFilter = readParam(params, "orderDispatch");
  const orderExtrasFilter = readParam(params, "orderExtras");
  const orderVisibilityFilter = readParam(params, "orderVisibility");
  const orderSlaFilter = readParam(params, "orderSla");
  const orderQuickFilter = readParam(params, "orderQuick");
  const orderQuery = readParam(params, "orderQuery");
  const stalledQuery = readParam(params, "stalledQuery");
  const orderSort = readSortDirection(params, "orderSort");
  const orderSortBy = readOrderSortKey(params);
  const workflowPaymentIds = new Set(
    workflows.flatMap((workflow) => [
      workflow.sourcePaymentId,
      workflow.currentPaymentId,
      workflow.replacementPaymentId,
      workflow.topUpPaymentId,
    ]).filter((value): value is string => Boolean(value)),
  );
  const workflowOrderEntries: WorkflowOrderEntry[] = workflows.map((workflow) => ({
    kind: "workflow",
    workflow,
    payment: getWorkflowPayment(workflow, paymentById),
    workOrder: workOrderByWorkflowId.get(workflow.id) ?? null,
  }));
  const stalledOrderEntries: StalledOrderEntry[] = dedupeCheckoutInteractions(
    interactions.filter(
      (interaction) =>
        getJourneyOutcomeKey(interaction) === "stalled" &&
        !workflowPaymentIds.has(interaction.paymentId),
    ),
  ).map((interaction) => ({ kind: "stalled", interaction }));
  const allOrderEntries: AllOrdersEntry[] = workflowOrderEntries.filter(
    (entry) => entry.payment && isSuccessfulPayment(entry.payment),
  );
  const orderEntriesBeforeNameSearch = allOrderEntries.filter((entry) => {
    const sla = getOrderSla(entry);
    if (orderSlaFilter === "attention" && sla.level === "clear") {
      return false;
    }
    if (orderSlaFilter === "overdue" && sla.level !== "overdue") {
      return false;
    }
    if (orderSlaFilter === "clear" && sla.level !== "clear") {
      return false;
    }

    if (entry.kind === "stalled") {
      const { interaction } = entry;
      if (orderStageFilters.length && !orderStageFilters.includes("stalled")) {
        return false;
      }
      if (
        !orderStageFilters.includes("stalled") &&
        orderVisibilityFilter !== "include-stalled"
      ) {
        return false;
      }
      const stalledProvider = interaction.paymentChoice === "frasers-plus"
        ? "FRASERS_PLUS"
        : interaction.paymentChoice === "card"
          ? "CARD"
          : "NONE";
      if (
        orderProviderFilter &&
        orderProviderFilter !== "all" &&
        stalledProvider !== orderProviderFilter
      ) {
        return false;
      }
      if (orderPaymentFilter === "paid") {
        return false;
      }
      if (orderInstallerFilter === "assigned" || orderPoFilter === "generated") {
        return false;
      }
      if (orderDispatchFilter === "dispatched" || orderExtrasFilter === "yes") {
        return false;
      }
      return true;
    }

    const { workflow, payment, workOrder } = entry;
    if (orderQuickFilter === "booked-week" && !isInCurrentWeek(workflow.bookedAt)) {
      return false;
    }
    if (orderStageFilters.length === 1 && orderStageFilters[0] === "stalled") {
      return false;
    }
    if (
      orderStageFilters.length &&
      !orderStageFilters.includes(getAllOrdersStage(workflow))
    ) {
      return false;
    }
    if (
      orderProviderFilter &&
      orderProviderFilter !== "all" &&
      (payment?.provider ?? workflow.provider ?? "NONE") !== orderProviderFilter
    ) {
      return false;
    }
    if (orderPaymentFilter === "paid" && !isPaidPayment(payment)) {
      return false;
    }
    if (orderPaymentFilter === "unpaid" && isPaidPayment(payment)) {
      return false;
    }
    if (
      orderInstallerFilter === "assigned" &&
      !workflow.installerName &&
      !workOrder?.installerMatchedName
    ) {
      return false;
    }
    if (
      orderInstallerFilter === "unassigned" &&
      (workflow.installerName || workOrder?.installerMatchedName)
    ) {
      return false;
    }
    if (orderPoFilter === "generated" && !workOrder) {
      return false;
    }
    if (orderPoFilter === "missing" && workOrder) {
      return false;
    }
    if (orderDispatchFilter === "dispatched" && !workflow.chargerDispatchedAt) {
      return false;
    }
    if (orderDispatchFilter === "pending" && workflow.chargerDispatchedAt) {
      return false;
    }
    const extraCosts = getWorkflowExtraCosts(workflow);
    if (orderExtrasFilter === "yes" && extraCosts <= 0) {
      return false;
    }
    if (orderExtrasFilter === "no" && extraCosts > 0) {
      return false;
    }
    return true;
  });
  const allOrderCustomerNames = Array.from(
    new Set(
      workflowOrderEntries
        .map((entry) => entry.workflow.customerName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const filteredAllOrderEntries = sortAllOrderEntries(
    orderEntriesBeforeNameSearch.filter((entry) => entry.kind === "workflow"
      ? includesQuery(
          [
            entry.workflow.sourcePaymentId,
            entry.workflow.currentPaymentId,
            entry.payment?.paymentId,
            entry.workflow.customerName,
            entry.workflow.customerEmail,
            entry.workflow.customerPhone,
            entry.workflow.chargerName,
            entry.workflow.installerName,
            entry.workOrder?.installerMatchedName,
            entry.workOrder?.purchaseOrderNumber,
            entry.workflow.jumptech?.projectId,
            entry.workflow.jumptech?.integrationId,
            entry.workflow.jumptech?.currentStatusLabel,
            entry.workflow.jumptech?.status,
          ],
          orderQuery,
        )
      : includesQuery(
          [
            entry.interaction.paymentId,
            entry.interaction.customerFirstName,
            entry.interaction.customerLastName,
            entry.interaction.customerEmail,
            entry.interaction.customerPhone,
            entry.interaction.chargerName,
            entry.interaction.lastReason,
          ],
          orderQuery,
        )),
    orderSortBy,
    orderSort,
  );
  const matchingOverdueOrderCount = filteredAllOrderEntries.filter(
    (entry) => getOrderSla(entry).level === "overdue",
  ).length;
  const matchingAttentionOrderCount = filteredAllOrderEntries.filter(
    (entry) => getOrderSla(entry).level === "attention",
  ).length;

  const paginatedAllOrderEntries = paginateRecords(
    filteredAllOrderEntries,
    params,
    "orderPage",
    25,
  );
  const filteredStalledOrderEntries = stalledOrderEntries.filter(({ interaction }) =>
    includesQuery(
      [
        interaction.paymentId,
        interaction.customerFirstName,
        interaction.customerLastName,
        interaction.customerEmail,
        interaction.customerPhone,
        interaction.chargerName,
        interaction.lastReason,
      ],
      stalledQuery,
    ),
  );
  const paginatedStalledOrderEntries = paginateRecords(
    filteredStalledOrderEntries,
    params,
    "stalledPage",
    25,
  );
  const paginatedBookingWorkflows = paginateRecords(
    filteredBookingWorkflows,
    params,
    "bookingPage",
  );
  const paginatedBookedWorkflows = paginateRecords(
    filteredBookedWorkflows,
    params,
    "bookedPage",
  );
  const paginatedInstalledWorkflows = paginateRecords(
    filteredInstalledWorkflows,
    params,
    "installedPage",
  );
  const paginatedDetailsSubmittedInteractions = paginateRecords(
    detailsSubmittedInteractions,
    params,
    "detailsPage",
  );
  const paginatedInteractions = paginateRecords(
    filteredInteractions,
    params,
    "journeyPage",
  );
  const paginatedSurveyWorkflows = paginateRecords(
    filteredSurveyWorkflows,
    params,
    "surveyPage",
  );
  const paginatedRefundWorkflows = paginateRecords(
    filteredRefundWorkflows,
    params,
    "refundPage",
  );
  const paginatedAuditEvents = paginateRecords(
    filteredAuditEvents,
    params,
    "auditPage",
  );
  const paginatedProductDiscounts = paginateRecords(
    productSettings.discounts,
    params,
    "discountPage",
  );
  const paginatedInstallers = paginateRecords(
    installerDirectory.installers,
    params,
    "installerPage",
  );
  const paginatedManagedAdminUsers = paginateRecords(
    managedAdminUsers,
    params,
    "accessPage",
  );

  const kpiDateFrom = readParam(params, "kpiDateFrom");
  const kpiDateTo = readParam(params, "kpiDateTo");
  const kpiStageFilter = readParam(params, "kpiStage");
  const kpiOutcomeFilter = readParam(params, "kpiOutcome");
  const kpiSuccessTypeFilter = readParam(params, "kpiSuccessType");

  const filteredKpiInteractions = interactions.filter((interaction) => {
    if (!matchesDateRange(interaction.startedAt || interaction.updatedAt, kpiDateFrom, kpiDateTo)) {
      return false;
    }

    if (kpiStageFilter && kpiStageFilter !== "all" && String(interaction.lastStep) !== kpiStageFilter) {
      return false;
    }

    if (
      kpiOutcomeFilter &&
      kpiOutcomeFilter !== "all" &&
      getJourneyOutcomeKey(interaction) !== kpiOutcomeFilter
    ) {
      return false;
    }

    if (kpiSuccessTypeFilter && kpiSuccessTypeFilter !== "all") {
      const linkedPayment = paymentById.get(interaction.paymentId);
      const expectedChoice = kpiSuccessTypeFilter === "CARD" ? "card" : "frasers-plus";
      const matchesChoice = interaction.paymentChoice === expectedChoice;
      const matchesSuccessfulProvider =
        linkedPayment?.provider === kpiSuccessTypeFilter && isSuccessfulPayment(linkedPayment);

      if (!matchesChoice && !matchesSuccessfulProvider) {
        return false;
      }
    }

    return true;
  });

  const filteredKpiPayments = payments.filter((payment) => {
    if (!matchesDateRange(payment.updatedAt || payment.createdAt, kpiDateFrom, kpiDateTo)) {
      return false;
    }

    if (kpiSuccessTypeFilter && kpiSuccessTypeFilter !== "all" && payment.provider !== kpiSuccessTypeFilter) {
      return false;
    }

    if (kpiStageFilter && kpiStageFilter !== "all") {
      const linkedInteraction = filteredKpiInteractions.find(
        (interaction) => interaction.paymentId === payment.paymentId,
      );
      if (!linkedInteraction) {
        return false;
      }
    }

    if (kpiOutcomeFilter && kpiOutcomeFilter !== "all") {
      const linkedInteraction = filteredKpiInteractions.find(
        (interaction) => interaction.paymentId === payment.paymentId,
      );
      if (!linkedInteraction || getJourneyOutcomeKey(linkedInteraction) !== kpiOutcomeFilter) {
        return false;
      }
    }

    return true;
  });

  const successfulKpiPayments = filteredKpiPayments.filter(isSuccessfulPayment);
  const filteredKpiInteractionsWithDetails = filteredKpiInteractions.filter((interaction) =>
    hasSubmittedCheckoutDetails(interaction),
  );
  const filteredKpiSecureHandoffs = filteredKpiInteractions.filter(
    (interaction) => getJourneyOutcomeKey(interaction) === "payment-handoff",
  );
  const filteredKpiConverted = filteredKpiInteractions.filter(
    (interaction) => getJourneyOutcomeKey(interaction) === "converted",
  );

  const stageDistribution = [1, 2, 3, 4, 5, 6].map((step) => ({
    label: getStepLabel(step),
    value: filteredKpiInteractions.filter((interaction) => interaction.lastStep === step).length,
  }));

  const outcomeDistribution = [
    { key: "active", label: "Active in checkout" },
    { key: "payment-handoff", label: "Secure payment started" },
    { key: "converted", label: "Converted" },
    { key: "stalled", label: "Interest stalled" },
    { key: "survey-exit", label: "Exited to survey later" },
  ].map((item) => ({
    label: item.label,
    value: filteredKpiInteractions.filter((interaction) => getJourneyOutcomeKey(interaction) === item.key).length,
  }));

  const successfulPaymentMix = [
    {
      label: "Card",
      value: successfulKpiPayments.filter((payment) => payment.provider === "CARD").length,
      detail: formatMoney(
        sumPaymentAmounts(
          successfulKpiPayments.filter((payment) => payment.provider === "CARD"),
        ),
      ),
    },
    {
      label: "Frasers Plus",
      value: successfulKpiPayments.filter((payment) => payment.provider === "FRASERS_PLUS").length,
      detail: formatMoney(
        sumPaymentAmounts(
          successfulKpiPayments.filter((payment) => payment.provider === "FRASERS_PLUS"),
        ),
      ),
    },
  ];

  const timelineSourceDays = Array.from(
    new Set(
      [
        ...filteredKpiInteractions.map((interaction) => toDayKey(interaction.startedAt || interaction.updatedAt)),
        ...successfulKpiPayments.map((payment) => toDayKey(payment.updatedAt || payment.createdAt)),
      ].filter(Boolean),
    ),
  )
    .sort()
    .slice(-7);

  const timelineData = timelineSourceDays.map((day) => ({
    day,
    started: filteredKpiInteractions.filter(
      (interaction) => toDayKey(interaction.startedAt || interaction.updatedAt) === day,
    ).length,
    details: filteredKpiInteractions.filter(
      (interaction) => toDayKey(interaction.detailsSubmittedAt || interaction.updatedAt) === day,
    ).length,
    converted: filteredKpiConverted.filter(
      (interaction) => toDayKey(interaction.updatedAt) === day,
    ).length,
  }));

  const interactionsWithSubmittedDetails = interactions.filter((interaction) =>
    hasSubmittedCheckoutDetails(interaction),
  ).length;
  const paymentHandoffCount = interactions.filter(
    (interaction) => getJourneyOutcomeKey(interaction) === "payment-handoff",
  ).length;
  const convertedCount = interactions.filter(
    (interaction) => getJourneyOutcomeKey(interaction) === "converted",
  ).length;
  const preDetailsStallCount = interactions.filter(
    (interaction) =>
      getJourneyOutcomeKey(interaction) === "stalled" && !hasSubmittedCheckoutDetails(interaction),
  ).length;

  const focusedWorkflow = focusedOrderId
    ? workflows.find(
        (workflow) =>
          workflow.id === focusedOrderId || workflow.sourcePaymentId === focusedOrderId,
      )
    : null;

  if (focusedOrderId && !focusedWorkflow) {
    redirect(buildBackofficeHref(params, { focusOrder: null, tab: "orders" }));
  }

  if (focusedWorkflow) {
    const focusedStage = getAllOrdersStage(focusedWorkflow);
    const focusedWorkOrder = workOrders.get(focusedWorkflow.id);
    const focusedTopUpSession =
      paymentById.get(focusedWorkflow.topUpPaymentId ?? "") ??
      paymentById.get(focusedWorkflow.replacementPaymentId ?? "");
    const focusedReturnTo = buildBackofficeHref(params, {
      tab: "orders",
      focusOrder: focusedWorkflow.id,
      openBooking: null,
      openJourney: null,
      openSurvey: null,
    });
    const backToOrdersHref = buildBackofficeHref(params, {
      tab: "orders",
      focusOrder: null,
      openBooking: null,
      openJourney: null,
      openSurvey: null,
    });

    return (
      <main className="backoffice-shell min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-8 text-slate-950">
        <BackofficeScrollRestoration />
        <div className="mx-auto max-w-[1480px]">
          <nav aria-label="Order detail navigation">
            <Link
              href={backToOrdersHref}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
            >
              <span aria-hidden="true">←</span>
              <span className="ml-2">Back to Orders</span>
            </Link>
          </nav>

          <header className="mt-5 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
              Order details
            </p>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-[-0.05em] text-slate-950 sm:text-4xl">
                  {focusedWorkflow.customerName || focusedWorkflow.chargerName || "Customer order"}
                </h1>
                <p className="mt-2 break-all text-sm font-semibold text-slate-600">
                  {focusedWorkflow.sourcePaymentId}
                </p>
              </div>
              <SnapshotBadge
                tone={
                  focusedStage === "installed"
                    ? "positive"
                    : focusedStage === "declined"
                      ? "danger"
                      : focusedStage === "review" || focusedStage === "ready"
                        ? "attention"
                        : "neutral"
                }
              >
                {focusedWorkflow.refundStatus === "COMPLETED" ? "Refunded" : {
                  "awaiting-survey": "Awaiting survey",
                  review: "Survey for review",
                  ready: "Ready for booking",
                  booked: "Booked",
                  installed: "Installed",
                  declined: "Declined",
                }[focusedStage]}
              </SnapshotBadge>
            </div>
            {bookingError ? (
              <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                {bookingError}
              </p>
            ) : null}
            {refundError ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{refundError}</p> : null}
          </header>

          <section className="mt-6" aria-label="Expanded order">
            {focusedStage === "installed" ? (
              <InstalledWorkflowCard
                workflow={focusedWorkflow}
                installers={installerDirectory.installers}
                installerMatch={focusedWorkOrder?.match ?? null}
                workOrder={focusedWorkOrder?.record ?? null}
                workOrderInstaller={focusedWorkOrder?.installer ?? null}
                returnTo={focusedReturnTo}
              />
            ) : focusedStage === "ready" || focusedStage === "booked" ? (
              <BookingWorkflowCard
                workflow={focusedWorkflow}
                topUpSession={focusedTopUpSession}
                open
                returnTo={focusedReturnTo}
                bookedReturnTo={focusedReturnTo}
                installers={installerDirectory.installers}
                installerMatch={focusedWorkOrder?.match ?? null}
                workOrder={focusedWorkOrder?.record ?? null}
                workOrderInstaller={focusedWorkOrder?.installer ?? null}
              />
            ) : (
              <div className="grid gap-4">
                <SurveyWorkflowCard
                  workflow={focusedWorkflow}
                  topUpSession={focusedTopUpSession}
                  open
                  returnTo={focusedReturnTo}
                  bookingReturnTo={focusedReturnTo}
                />
                <WorkOrderPanel
                  workflow={focusedWorkflow}
                  installers={installerDirectory.installers}
                  installerMatch={focusedWorkOrder?.match ?? null}
                  workOrder={focusedWorkOrder?.record ?? null}
                  workOrderInstaller={focusedWorkOrder?.installer ?? null}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="backoffice-shell min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-8 text-slate-950">
      <BackofficeScrollRestoration />
      <div className="mx-auto max-w-[1480px]">
        {refundError ? <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{refundError}</p> : null}
        <div className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] lg:flex-row lg:items-end lg:justify-between">
          <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
              Merchant back office
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-slate-950">
              {activeTab === "orders"
                ? "Orders"
                : activeTab === "stalled"
                  ? "Stalled checkouts"
                  : activeTab === "kpis"
                    ? "KPIs"
                    : "Back-office administration"}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              {activeTab === "orders"
                ? "Find a paid customer and see their current stage, urgent next step, and action in one place."
                : activeTab === "stalled"
                  ? "Review checkout journeys that did not convert, separately from operational orders."
                  : activeTab === "kpis"
                    ? "Monitor conversion, payment, and journey performance."
                    : "Configuration, access, refunds, and audit tools."}
            </p>
            <div className="mt-5 max-w-xl">
              <label className="block text-sm font-semibold text-slate-800">
                <span>Find any customer</span>
                <span className="mt-2 block">
                  <BackofficeOrderSearch
                    initialValue={orderQuery}
                    customerNames={allOrderCustomerNames}
                    className={filterInputClassName}
                  />
                </span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <BackofficeLiveRefresh />
            <details className="group relative">
              <summary className="inline-flex min-h-12 cursor-pointer list-none items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef]">
                {session.sub} · Admin
                <span className="ml-2 text-slate-400 transition group-open:rotate-180" aria-hidden="true">▾</span>
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-64 rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                {[
                  ["Orders", "/backoffice"],
                  ["Product settings", "/backoffice?tab=products"],
                  ["Installers", "/backoffice?tab=installers"],
                  ["Team access", "/backoffice?tab=access"],
                  ["Audit trail", "/backoffice?tab=audit"],
                  ["Refunds", "/backoffice?tab=refunds"],
                  ["Change log", "/backoffice/changelog"],
                  ["Email preview", "/backoffice/email-preview"],
                ].map(([label, href]) => (
                  <Link key={href} href={href} className="block rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100">
                    {label}
                  </Link>
                ))}
                <form action="/api/admin/logout" method="post" className="mt-1 border-t border-slate-100 pt-1">
                  <button type="submit" className="w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>

        {!["orders", "stalled", "kpis"].includes(activeTab) ? (
        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatCard
            label="Tracked orders"
            value={String(workflows.length)}
            detail="Every checkout that has moved into the survey or booking workflow."
          />
          <StatCard
            label="Journey stalls"
            value={String(stalledJourneyCount)}
            detail={`${interactionsWithSubmittedDetails} interaction${interactionsWithSubmittedDetails === 1 ? "" : "s"} reached customer details.`}
          />
          <StatCard
            label="Survey review"
            value={String(surveyReviewWorkflows.length)}
            detail={`${overdueSurveyCount} overdue survey${overdueSurveyCount === 1 ? "" : "s"} need customer contact or refund action.`}
          />
          <StatCard
            label="Ready for booking"
            value={String(readyForBookingCount)}
            detail="Orders cleared by survey review and waiting for installer assignment."
          />
          <StatCard
            label="Booked for install"
            value={String(bookedInstallationCount)}
            detail="Orders with installer details recorded and installation booked."
          />
          <StatCard
            label="Installed"
            value={String(installedInstallationCount)}
            detail="Jobs marked installed by Jumptech or back office."
          />
          <StatCard
            label="Refund queue"
            value={String(refundRequestCount)}
            detail="Customer cancellations awaiting operational approval."
          />
          <StatCard
            label="Frasers / card"
            value={`${frasersPlusCount} / ${cardCount}`}
            detail="Tracked payment mix between Frasers Plus and card routes."
          />
          <StatCard
            label="Admin users"
            value={String(managedAdminUsers.length + (bootstrapAdmin ? 1 : 0))}
            detail="Bootstrap and managed backoffice accounts with per-user access controls."
          />
        </section>
        ) : null}

        <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap gap-3">
            <TabLink href={getTabHref("orders")} active={activeTab === "orders"} label={`Orders (${allOrderEntries.length})`} />
            <TabLink href={getTabHref("stalled")} active={activeTab === "stalled"} label={`Stalled (${stalledOrderEntries.length})`} />
            <TabLink href={getTabHref("kpis")} active={activeTab === "kpis"} label="KPIs" />
          </div>
        </section>

        {activeTab === "orders" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  All orders
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Complete operational snapshot
                </h2>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-500">
                Every active order is shown in one row with payment, survey, booking, installer, PO, dispatch, additional-cost, and Jumptech status.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="mr-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-600">Quick views</span>
              <QuickViewLink
                href="/backoffice?orderStage=awaiting-survey%2Creview&orderSla=overdue"
                active={orderSlaFilter === "overdue" && (orderStageFilters.includes("awaiting-survey") || orderStageFilters.includes("review"))}
                label="Overdue surveys"
              />
              <QuickViewLink
                href="/backoffice?orderStage=ready"
                active={orderStageFilters.length === 1 && orderStageFilters[0] === "ready"}
                label="Ready to book"
              />
              <QuickViewLink
                href="/backoffice?orderStage=booked&orderQuick=booked-week"
                active={orderQuickFilter === "booked-week"}
                label="Booked this week"
              />
            </div>

            <details className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-700">
                Personal saved views
              </summary>
            <div className="border-t border-slate-200 p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    My saved views
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Saves operational filters and sort order for this agent. Customer searches remain temporary.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {savedOrderViews.length ? savedOrderViews.map((view) => {
                      const viewHref = buildBackofficeHref(
                        {},
                        { tab: "orders", savedView: view.id, ...view.filters },
                      );
                      return (
                        <div key={view.id} className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1">
                          <Link
                            href={viewHref}
                            aria-current={activeSavedViewId === view.id ? "page" : undefined}
                            className={`inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold transition ${
                              activeSavedViewId === view.id
                                ? "bg-[#00eaff] text-slate-950 shadow-sm"
                                : "bg-white text-slate-800 hover:bg-slate-100 hover:text-[#006c88]"
                            }`}
                          >
                            {view.name}
                          </Link>
                          <form action="/api/backoffice/saved-views" method="post">
                            <input type="hidden" name="action" value="delete" />
                            <input type="hidden" name="viewId" value={view.id} />
                            <input type="hidden" name="returnTo" value="/backoffice" />
                            <button
                              type="submit"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Delete saved view ${view.name}`}
                              title={`Delete ${view.name}`}
                            >
                              ×
                            </button>
                          </form>
                        </div>
                      );
                    }) : (
                      <span className="text-sm text-slate-500">No personal views saved yet.</span>
                    )}
                  </div>
                </div>

                <form action="/api/backoffice/saved-views" method="post" className="flex w-full flex-col gap-2 sm:flex-row xl:max-w-xl">
                  <input type="hidden" name="action" value="save" />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={buildBackofficeHref(params, { viewState: null, viewError: null })}
                  />
                  {BACKOFFICE_ORDER_FILTER_KEYS.map((key) => (
                    <input
                      key={key}
                      type="hidden"
                      name={key}
                      value={key === "orderStage" ? orderStageFilters.join(",") : readParam(params, key)}
                    />
                  ))}
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Saved view name</span>
                    <input
                      name="viewName"
                      required
                      maxLength={48}
                      placeholder="Name this filter view"
                      className={filterInputClassName}
                    />
                  </label>
                  <button
                    type="submit"
                    className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Save current view
                  </button>
                </form>
              </div>
              {viewError ? (
                <p className="mt-3 text-sm font-semibold text-rose-700">{viewError}</p>
              ) : viewState === "saved" ? (
                <p className="mt-3 text-sm font-semibold text-emerald-700">Saved view updated.</p>
              ) : viewState === "deleted" ? (
                <p className="mt-3 text-sm font-semibold text-emerald-700">Saved view deleted.</p>
              ) : null}
            </div>
            </details>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="orders" />
              <fieldset className="sm:col-span-2 xl:col-span-3">
                <legend className="text-sm font-medium text-slate-700">Order stages</legend>
                <div className="mt-2 flex min-h-12 flex-wrap gap-2">
                  {ORDER_STAGE_OPTIONS.map(([value, label]) => (
                    <label key={value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="orderStage"
                        value={value}
                        defaultChecked={orderStageFilters.includes(value)}
                        className="peer sr-only"
                      />
                      <span className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 peer-checked:border-slate-950 peer-checked:bg-slate-950 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-[#00eaff]/20">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Choose none to include every active stage.</p>
              </fieldset>
              <FilterField label="Payment route">
                <select name="orderProvider" defaultValue={orderProviderFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment routes</option>
                  <option value="CARD">Card</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                  <option value="NONE">No payment route</option>
                </select>
              </FilterField>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Clear filters
                </Link>
              </div>
            </form>

            <div className="mt-6 flex flex-col gap-2 border-y border-slate-200 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-500">
                <span className="text-base font-bold text-slate-950">
                  {paginatedAllOrderEntries.totalItems} matching order{paginatedAllOrderEntries.totalItems === 1 ? "" : "s"}
                </span>
                <span>
                  {paginatedAllOrderEntries.items.length} shown · page {paginatedAllOrderEntries.currentPage} of {paginatedAllOrderEntries.totalPages}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                {matchingOverdueOrderCount ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                    {matchingOverdueOrderCount} overdue
                  </span>
                ) : null}
                {matchingAttentionOrderCount ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    {matchingAttentionOrderCount} need attention
                  </span>
                ) : null}
              </div>
            </div>

            {paginatedAllOrderEntries.items.length ? (
              <AllOrdersTable
                entries={paginatedAllOrderEntries.items}
                params={params}
                sortBy={orderSortBy}
                sortDirection={orderSort}
              />
            ) : (
              <EmptyState message="No orders match the selected filters." />
            )}
            <PaginationControls
              label="orders"
              pagination={paginatedAllOrderEntries}
              params={params}
            />
          </section>
        ) : null}

        {activeTab === "stalled" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">Recovery queue</p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">Stalled checkouts</h2>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                These journeys did not become paid operational orders. Use them for recovery and marketing follow-up.
              </p>
            </div>

            <form method="get" className="mt-6 flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4 sm:flex-row">
              <input type="hidden" name="tab" value="stalled" />
              <input
                type="search"
                name="stalledQuery"
                defaultValue={stalledQuery}
                placeholder="Search name, email, phone or reference"
                className={`${filterInputClassName} flex-1`}
              />
              <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold text-white">
                Search stalled
              </button>
            </form>

            <p className="mt-5 text-sm font-semibold text-slate-700">
              {paginatedStalledOrderEntries.totalItems} stalled checkout{paginatedStalledOrderEntries.totalItems === 1 ? "" : "s"}
            </p>
            {paginatedStalledOrderEntries.items.length ? (
              <div className="mt-4 grid gap-4">
                {paginatedStalledOrderEntries.items.map(({ interaction }) => (
                  <JourneyCard
                    key={interaction.id}
                    interaction={interaction}
                    open={interaction.id === openJourneyId}
                    returnTo={buildBackofficeHref(
                      params,
                      { tab: "stalled", openJourney: interaction.id },
                      `journey-${interaction.id}`,
                    )}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No stalled checkouts match this search." />
            )}
            <PaginationControls
              label="stalled checkouts"
              pagination={paginatedStalledOrderEntries}
              params={params}
            />
          </section>
        ) : null}

        {activeTab === "booking" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Orders for booking
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Booking queue and installation assignments
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Orders appear here only after survey review is complete or the customer has accepted any revised terms.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="booking" />
              <FilterField label="Payment route">
                <select name="bookingProvider" defaultValue={bookingProviderFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment routes</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                  <option value="CARD">Card</option>
                  <option value="NONE">No payment route</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="bookingQuery"
                  defaultValue={bookingQuery}
                  placeholder="Order ref, customer, charger, installer"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Submission date">
                <select name="bookingSort" defaultValue={bookingSort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredBookingWorkflows.length === 0 ? (
              <EmptyState message="No booking-ready orders match the current filters." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedBookingWorkflows.items.map((workflow) => (
                    <BookingWorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      topUpSession={
                        paymentById.get(workflow.topUpPaymentId ?? "") ??
                        paymentById.get(workflow.replacementPaymentId ?? "")
                      }
                      open={
                        workflow.id === openBookingId
                      }
                      returnTo={buildBackofficeHref(
                        params,
                        { tab: "booking", openBooking: workflow.id },
                        `booking-${workflow.id}`,
                      )}
                      bookedReturnTo={buildBackofficeHref(
                        params,
                        {
                          tab: "booked",
                          openBooking: workflow.id,
                        },
                        `booking-${workflow.id}`,
                      )}
                      installers={installerDirectory.installers}
                      installerMatch={workOrders.get(workflow.id)?.match ?? null}
                      workOrder={workOrders.get(workflow.id)?.record ?? null}
                      workOrderInstaller={workOrders.get(workflow.id)?.installer ?? null}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="booking-ready orders"
                  pagination={paginatedBookingWorkflows}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "booked" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Booked installations
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Scheduled jobs and installer assignments
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                These jobs have scheduled booking information from Jumptech or the back office.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="booked" />
              <FilterField label="Payment route">
                <select name="bookingProvider" defaultValue={bookingProviderFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment routes</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                  <option value="CARD">Card</option>
                  <option value="NONE">No payment route</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="bookingQuery"
                  defaultValue={bookingQuery}
                  placeholder="Order ref, customer, installer, date"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Installation date">
                <select name="bookingSort" defaultValue={bookingSort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=booked"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredBookedWorkflows.length === 0 ? (
              <EmptyState message="No booked installations match the current filters." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedBookedWorkflows.items.map((workflow) => (
                    <BookingWorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      topUpSession={
                        paymentById.get(workflow.topUpPaymentId ?? "") ??
                        paymentById.get(workflow.replacementPaymentId ?? "")
                      }
                      open={workflow.id === openBookingId}
                      returnTo={buildBackofficeHref(
                        params,
                        { tab: "booked", openBooking: workflow.id },
                        `booking-${workflow.id}`,
                      )}
                      bookedReturnTo={buildBackofficeHref(
                        params,
                        { tab: "booked", openBooking: workflow.id },
                        `booking-${workflow.id}`,
                      )}
                      installers={installerDirectory.installers}
                      installerMatch={workOrders.get(workflow.id)?.match ?? null}
                      workOrder={workOrders.get(workflow.id)?.record ?? null}
                      workOrderInstaller={workOrders.get(workflow.id)?.installer ?? null}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="booked installations"
                  pagination={paginatedBookedWorkflows}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "installed" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Installed jobs
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Completed installations
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                A reduced view for completed jobs, keeping only the customer, product, installer, and completion references.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="installed" />
              <FilterField label="Payment route">
                <select name="bookingProvider" defaultValue={bookingProviderFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment routes</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                  <option value="CARD">Card</option>
                  <option value="NONE">No payment route</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="bookingQuery"
                  defaultValue={bookingQuery}
                  placeholder="Order ref, customer, installer"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Completion date">
                <select name="bookingSort" defaultValue={bookingSort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=installed"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredInstalledWorkflows.length === 0 ? (
              <EmptyState message="No installed jobs match the current filters." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedInstalledWorkflows.items.map((workflow) => (
                    <InstalledWorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      installers={installerDirectory.installers}
                      installerMatch={workOrders.get(workflow.id)?.match ?? null}
                      workOrder={workOrders.get(workflow.id)?.record ?? null}
                      workOrderInstaller={workOrders.get(workflow.id)?.installer ?? null}
                      returnTo={buildBackofficeHref(
                        params,
                        { tab: "installed" },
                        `installed-${workflow.id}`,
                      )}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="installed jobs"
                  pagination={paginatedInstalledWorkflows}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "details" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Details submitted
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Customers who left details but have not paid
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Deduped by customer contact details, with the latest checkout attempt shown for each customer.
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <StatCard
                label="Unpaid details"
                value={String(detailsSubmittedInteractions.length)}
                detail="Customers with contact details captured and no confirmed payment."
              />
              <StatCard
                label="Card interest"
                value={String(detailsSubmittedInteractions.filter((interaction) => interaction.paymentChoice === "card").length)}
                detail="Customers who selected card before dropping out."
              />
              <StatCard
                label="Latest attempt"
                value={
                  detailsSubmittedInteractions[0]
                    ? formatTimestamp(getJourneySubmissionDate(detailsSubmittedInteractions[0]))
                    : "None"
                }
                detail="Most recent details-submitted checkout activity."
              />
            </div>

            <form
              method="get"
              action="/api/backoffice/unpaid-details-export"
              className="mt-6 grid gap-4 rounded-[24px] border border-cyan-100 bg-cyan-50/60 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]"
            >
              <FilterField label="Unpaid details from">
                <input type="date" name="from" className={filterInputClassName} />
              </FilterField>
              <FilterField label="Unpaid details to">
                <input type="date" name="to" className={filterInputClassName} />
              </FilterField>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
                >
                  Export date range
                </button>
              </div>
              <div className="flex items-end">
                <Link
                  href="/api/backoffice/unpaid-details-export"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] active:scale-[0.98]"
                >
                  Export all unpaid details
                </Link>
              </div>
            </form>

            {manualPaymentError ? (
              <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                {manualPaymentError}
              </div>
            ) : null}

            <ManualPaidCustomerForm
              chargerOptions={productSettings.chargers}
              returnTo={buildBackofficeHref(params, { tab: "details" })}
            />

            {detailsSubmittedInteractions.length === 0 ? (
              <EmptyState message="No customers have submitted details without paying." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedDetailsSubmittedInteractions.items.map((interaction) => (
                    <JourneyCard
                      key={interaction.id}
                      interaction={interaction}
                      open={interaction.id === openJourneyId}
                      returnTo={buildBackofficeHref(
                        params,
                        { tab: "details", openJourney: interaction.id },
                        `journey-${interaction.id}`,
                      )}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="details submitted records"
                  pagination={paginatedDetailsSubmittedInteractions}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "journey" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Journey tracking
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Early checkout interactions
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Use this to see where customers lose momentum before contact details are captured.
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Pre-details interactions" value={String(filteredInteractions.length)} detail="Checkout interactions before contact details were submitted." />
              <StatCard label="Details queue" value={String(detailsSubmittedInteractions.length)} detail="Captured details with no confirmed payment are separated into their own tab." />
              <StatCard label="Secure handoffs" value={String(paymentHandoffCount)} detail="Customers sent into secure checkout." />
              <StatCard label="Stalled pre-details" value={String(preDetailsStallCount)} detail={`${convertedCount} interaction${convertedCount === 1 ? "" : "s"} converted through payment.`} />
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-6">
              <input type="hidden" name="tab" value="journey" />
              <FilterField label="Outcome">
                <select name="journeyOutcome" defaultValue={journeyOutcomeFilter || "all"} className={filterInputClassName}>
                  <option value="all">All outcomes</option>
                  <option value="active">Active in checkout</option>
                  <option value="payment-handoff">Secure payment started</option>
                  <option value="converted">Converted</option>
                  <option value="stalled">Interest stalled</option>
                  <option value="survey-exit">Exited to survey later</option>
                </select>
              </FilterField>
              <FilterField label="Stage reached">
                <select name="journeyStep" defaultValue={journeyStepFilter || "all"} className={filterInputClassName}>
                  <option value="all">All stages</option>
                  {[1, 2, 3, 4, 5, 6].map((step) => (
                    <option key={step} value={String(step)}>
                      {getStepLabel(step)}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Customer details">
                <select name="journeyDetails" defaultValue={journeyDetailsFilter || "all"} className={filterInputClassName}>
                  <option value="all">All</option>
                  <option value="pre-details">Before details submitted</option>
                </select>
              </FilterField>
              <FilterField label="Payment interest">
                <select name="journeyPayment" defaultValue={journeyPaymentFilter || "all"} className={filterInputClassName}>
                  <option value="all">All</option>
                  <option value="undecided">No payment choice yet</option>
                  <option value="card">Card</option>
                  <option value="frasers-plus">Frasers Plus</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="journeyQuery"
                  defaultValue={journeyQuery}
                  placeholder="Name, email, postcode, charger"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Submission date">
                <select name="journeySort" defaultValue={journeySort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="md:col-span-6 flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=journey"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            <form
              method="get"
              action="/api/backoffice/unpaid-details-export"
              className="mt-4 grid gap-4 rounded-[24px] border border-cyan-100 bg-cyan-50/60 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]"
            >
              <FilterField label="Unpaid details from">
                <input type="date" name="from" className={filterInputClassName} />
              </FilterField>
              <FilterField label="Unpaid details to">
                <input type="date" name="to" className={filterInputClassName} />
              </FilterField>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
                >
                  Export date range
                </button>
              </div>
              <div className="flex items-end">
                <Link
                  href="/api/backoffice/unpaid-details-export"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] active:scale-[0.98]"
                >
                  Export all unpaid details
                </Link>
              </div>
            </form>

            {manualPaymentError ? (
              <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                {manualPaymentError}
              </div>
            ) : null}

            <ManualPaidCustomerForm
              chargerOptions={productSettings.chargers}
              returnTo={buildBackofficeHref(params, { tab: "journey" })}
            />

            {filteredInteractions.length === 0 ? (
              <EmptyState message="No checkout interactions match the current journey filters." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedInteractions.items.map((interaction) => (
                    <JourneyCard
                      key={interaction.id}
                      interaction={interaction}
                      open={interaction.id === openJourneyId}
                      returnTo={buildBackofficeHref(
                        params,
                        { tab: "journey", openJourney: interaction.id },
                        `journey-${interaction.id}`,
                      )}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="journey records"
                  pagination={paginatedInteractions}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "kpis" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  KPI dashboard
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Filterable conversion and journey performance
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Use the filters below to view stage progression, payment mix, and conversion trends.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-5">
              <input type="hidden" name="tab" value="kpis" />
              <FilterField label="Date from">
                <input
                  type="date"
                  name="kpiDateFrom"
                  defaultValue={kpiDateFrom}
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Date to">
                <input
                  type="date"
                  name="kpiDateTo"
                  defaultValue={kpiDateTo}
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Stage reached">
                <select name="kpiStage" defaultValue={kpiStageFilter || "all"} className={filterInputClassName}>
                  <option value="all">All stages</option>
                  {[1, 2, 3, 4, 5, 6].map((step) => (
                    <option key={step} value={String(step)}>
                      {getStepLabel(step)}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Outcome">
                <select name="kpiOutcome" defaultValue={kpiOutcomeFilter || "all"} className={filterInputClassName}>
                  <option value="all">All outcomes</option>
                  <option value="active">Active in checkout</option>
                  <option value="payment-handoff">Secure payment started</option>
                  <option value="converted">Converted</option>
                  <option value="stalled">Interest stalled</option>
                  <option value="survey-exit">Exited to survey later</option>
                </select>
              </FilterField>
              <FilterField label="Successful payment type">
                <select name="kpiSuccessType" defaultValue={kpiSuccessTypeFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment types</option>
                  <option value="CARD">Card</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                </select>
              </FilterField>
              <div className="md:col-span-5 flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=kpis"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Interactions"
                value={String(filteredKpiInteractions.length)}
                detail="Tracked journeys in the current KPI slice."
                href="/backoffice?tab=stalled"
              />
              <StatCard
                label="Details submitted"
                value={percentage(filteredKpiInteractionsWithDetails.length, filteredKpiInteractions.length)}
                detail={`${filteredKpiInteractionsWithDetails.length} customers reached submitted details.`}
                href="/backoffice?tab=details"
              />
              <StatCard
                label="Secure handoff"
                value={percentage(filteredKpiSecureHandoffs.length, filteredKpiInteractions.length)}
                detail={`${filteredKpiSecureHandoffs.length} customers entered secure payment.`}
                href="/backoffice?tab=journey&journeyOutcome=payment-handoff"
              />
              <StatCard
                label="Conversion rate"
                value={percentage(filteredKpiConverted.length, filteredKpiInteractions.length)}
                detail={`${filteredKpiConverted.length} journeys converted in this view.`}
                href="/backoffice"
              />
              <StatCard
                label="Successful value"
                value={formatMoney(sumPaymentAmounts(successfulKpiPayments))}
                detail={`${successfulKpiPayments.length} successful payment${successfulKpiPayments.length === 1 ? "" : "s"} in range.`}
                href="/backoffice"
              />
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <ChartCard
                title="Stage progression"
                detail="How far customers reached in the checkout journey."
              >
                <BarList
                  items={stageDistribution}
                  emptyMessage="No interactions match the current KPI filters."
                />
              </ChartCard>

              <ChartCard
                title="Outcome mix"
                detail="Current state of the filtered journeys."
              >
                <BarList
                  items={outcomeDistribution}
                  emptyMessage="No outcome data available for the current KPI filters."
                />
              </ChartCard>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <ChartCard
                title="Successful payment type"
                detail="Successful payment count and value by provider."
              >
                <ProviderMix
                  items={successfulPaymentMix}
                  emptyMessage="No successful payments match the current KPI filters."
                />
              </ChartCard>

              <ChartCard
                title="Daily trend"
                detail="Started journeys, details submitted, and conversions by day."
              >
                <DailyTrendChart
                  points={timelineData}
                  emptyMessage="No daily KPI activity is available for the current filters."
                />
              </ChartCard>
            </div>
            <LandingAnalytics range={readParam(params, "landingDays")} />
            <CheckoutClickAnalytics range={readParam(params, "clickDays")} />
          </section>
        ) : null}

        {activeTab === "survey" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Survey review queue
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Confirm surveys, manage customer status links, and prepare booking
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Use this queue to update survey status, attach Jumptech progress, and flag overdue surveys for customer contact, refund, or Frasers Plus reversal.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-5">
              <input type="hidden" name="tab" value="survey" />
              <FilterField label="Survey status">
                <select name="surveyStatus" defaultValue={surveyStatusFilter || "all"} className={filterInputClassName}>
                  <option value="all">All survey states</option>
                  {Array.from(new Set(surveyWorkflows.map((workflow) => workflow.surveyStatus))).sort().map((status) => (
                    <option key={status} value={status}>
                      {formatWorkflowStatus(status)}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Provider">
                <select name="surveyProvider" defaultValue={surveyProviderFilter || "all"} className={filterInputClassName}>
                  <option value="all">All payment routes</option>
                  <option value="CARD">Card</option>
                  <option value="FRASERS_PLUS">Frasers Plus</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="surveyQuery"
                  defaultValue={surveyQuery}
                  placeholder="Customer, charger, reference"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Submission date">
                <select name="surveySort" defaultValue={surveySort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=survey"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredSurveyWorkflows.length === 0 ? (
              <EmptyState message="No survey jobs match the current filters." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedSurveyWorkflows.items.map((workflow) => (
                    <SurveyWorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      topUpSession={
                        paymentById.get(workflow.topUpPaymentId ?? "") ??
                        paymentById.get(workflow.replacementPaymentId ?? "")
                      }
                      open={workflow.id === openSurveyId}
                      returnTo={buildBackofficeHref(
                        params,
                        {
                          tab: "survey",
                          openSurvey: workflow.id,
                          openBooking: null,
                        },
                        `survey-${workflow.id}`,
                      )}
                      bookingReturnTo={buildBackofficeHref(
                        params,
                        {
                          tab: "booking",
                          bookingStatus: "READY_FOR_BOOKING",
                          openBooking: workflow.id,
                          openSurvey: null,
                        },
                        `booking-${workflow.id}`,
                      )}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="survey jobs"
                  pagination={paginatedSurveyWorkflows}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "refunds" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Refund approval queue
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Customer cancellations awaiting provider action
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Approve cancellations here to reverse or refund through the original payment route.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="refunds" />
              <FilterField label="Refund status">
                <select name="refundStatus" defaultValue={refundStatusFilter || "all"} className={filterInputClassName}>
                  <option value="all">All refund states</option>
                  {Array.from(new Set(workflows.map((workflow) => workflow.refundStatus)))
                    .filter((status) => status !== "NONE")
                    .sort()
                    .map((status) => (
                      <option key={status} value={status}>
                        {formatRefundStatus(status)}
                      </option>
                    ))}
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="refundQuery"
                  defaultValue={refundQuery}
                  placeholder="Customer, reference, charger"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Submission date">
                <select name="refundSort" defaultValue={refundSort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=refunds"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredRefundWorkflows.length === 0 ? (
              <EmptyState message="No refund requests are waiting in the current filter view." />
            ) : (
              <>
                <div className="mt-6 grid gap-4">
                  {paginatedRefundWorkflows.items.map((workflow) => (
                    <RefundRequestCard
                      key={workflow.id}
                      workflow={workflow}
                      returnTo={buildBackofficeHref(params, { tab: "refunds" }, `refund-${workflow.id}`)}
                    />
                  ))}
                </div>
                <PaginationControls
                  label="refund requests"
                  pagination={paginatedRefundWorkflows}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === "products" ? (
          <section id="product-settings" className="mt-8 scroll-mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Product settings
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Manage installed pricing, guidance prompts, offers and voucher codes
                </h2>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-500">
                These settings drive the customer product cards, estimate flow, payment payload totals, and discount data passed through to the order record.
              </p>
            </div>

            {!isSuperAdmin ? (
              <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
                Only a super admin can change product settings.
              </div>
            ) : null}

            {productError ? (
              <div className="mt-6 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
                {productError}
              </div>
            ) : null}

            {productState && !productError ? (
              <div className="mt-6 rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
                Product settings updated.
              </div>
            ) : null}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
              <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Installed prices and standard adjustments
                </p>
                <form action="/api/admin/product-settings" method="post" className="mt-4 grid gap-4">
                  <input type="hidden" name="action" value="update-pricing" />
                  <label className="block text-sm font-medium text-slate-700">
                    Seven Pro Tethered installed price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="tetheredInstalledPrice"
                      defaultValue={productSettings.chargers.find((charger) => charger.slug === "seven-pro-tethered")?.installedPrice}
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Seven Pro Untethered installed price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="untetheredInstalledPrice"
                      defaultValue={productSettings.chargers.find((charger) => charger.slug === "seven-pro-untethered")?.installedPrice}
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                    Cable run 10m to 20m customer guidance
                    <textarea
                      name="cableRun10To20GuidanceText"
                      defaultValue={productSettings.adjustments.cableRun10To20.guidanceText ?? ""}
                      rows={3}
                      className={`${filterInputClassName} mt-2 min-h-24 resize-y leading-6`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                    Cable run over 20m customer guidance
                    <textarea
                      name="cableRunOver20GuidanceText"
                      defaultValue={productSettings.adjustments.cableRunOver20.guidanceText ?? ""}
                      rows={3}
                      className={`${filterInputClassName} mt-2 min-h-24 resize-y leading-6`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                    Street parking customer guidance
                    <textarea
                      name="streetParkingGuidanceText"
                      defaultValue={productSettings.adjustments.streetParking.guidanceText ?? ""}
                      rows={3}
                      className={`${filterInputClassName} mt-2 min-h-24 resize-y leading-6`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                    Flat / apartment customer guidance
                    <textarea
                      name="flatApartmentGuidanceText"
                      defaultValue={productSettings.adjustments.flatApartment.guidanceText ?? ""}
                      rows={3}
                      className={`${filterInputClassName} mt-2 min-h-24 resize-y leading-6`}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!isSuperAdmin}
                    className="admin-action-button inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save pricing
                  </button>
                </form>
              </section>

              <section className="grid gap-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <ProductDiscountForm
                    title="Create special offer"
                    kind="SPECIAL_OFFER"
                    isSuperAdmin={isSuperAdmin}
                  />
                  <ProductDiscountForm
                    title="Create voucher code"
                    kind="VOUCHER"
                    isSuperAdmin={isSuperAdmin}
                  />
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Active and scheduled discounts
                  </p>
                  <div className="mt-4 grid gap-3">
                    {productSettings.discounts.length === 0 ? (
                      <EmptyState message="No special offers or voucher codes have been created yet." />
                    ) : (
                      <>
                        {paginatedProductDiscounts.items.map((discount) => (
                          <ProductDiscountCard
                            key={discount.id}
                            discount={discount}
                            isSuperAdmin={isSuperAdmin}
                          />
                        ))}
                        <PaginationControls
                          label="discount records"
                          pagination={paginatedProductDiscounts}
                          params={params}
                        />
                      </>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeTab === "installers" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Installers
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Legal installer records for purchase orders
                </h2>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-500">
                Jumptech installer names are matched to this controlled directory before a work order PDF can be generated.
              </p>
            </div>

            {!isSuperAdmin ? (
              <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
                Only a super admin can manage installer legal records.
              </div>
            ) : null}

            {installerError ? (
              <div className="mt-6 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
                {installerError}
              </div>
            ) : null}

            {installerState && !installerError ? (
              <div className="mt-6 rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
                {installerState === "installer-deleted"
                  ? "Installer record deleted."
                  : "Installer records updated."}
              </div>
            ) : null}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,0.65fr)_minmax(0,1.35fr)]">
              <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Add installer
                </p>
                <InstallerForm isSuperAdmin={isSuperAdmin} />
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Installer directory
                </p>
                <div className="mt-4 grid gap-3">
                  {installerDirectory.installers.length === 0 ? (
                    <EmptyState message="No installer legal records have been added yet." />
                  ) : (
                    <>
                      {paginatedInstallers.items.map((installer) => (
                        <InstallerCard
                          key={installer.id}
                          installer={installer}
                          isSuperAdmin={isSuperAdmin}
                        />
                      ))}
                      <PaginationControls
                        label="installer records"
                        pagination={paginatedInstallers}
                        params={params}
                      />
                    </>
                  )}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeTab === "access" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Team access
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Create admin logins and define MFA per user
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                Managed users are stored in the application data store. The bootstrap env admin remains available as a fallback.
              </p>
            </div>

            {!isSuperAdmin ? (
              <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
                Only a super admin can create or manage other admin users.
              </div>
            ) : null}

            {isSuperAdmin && accessError ? (
              <div className="mt-6 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
                {accessError}
              </div>
            ) : null}

            {isSuperAdmin && accessAction && !accessError ? (
              <div className="mt-6 rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
                {accessAction === "created"
                  ? "Admin user created."
                  : accessAction === "updated"
                    ? "Admin user settings updated."
                    : accessAction === "password"
                      ? "Admin password updated."
                      : accessAction === "mfa"
                        ? "Admin authenticator secret rotated."
                        : "Admin access updated."}
              </div>
            ) : null}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,0.74fr)_minmax(0,1.26fr)]">
              <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Create managed admin
                </p>
                <form action="/api/admin/users" method="post" className="mt-4 grid gap-4">
                  <input type="hidden" name="action" value="create-user" />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={buildBackofficeHref(params, { tab: "access", accessState: null, accessError: null })}
                  />
                  <label className="block text-sm font-medium text-slate-700">
                    Username
                    <input
                      type="text"
                      name="username"
                      placeholder="ops-user"
                      required
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Password
                    <input
                      type="password"
                      name="password"
                      minLength={10}
                      required
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked
                      className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
                    />
                    Allow this user to sign in
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
                    <input
                      type="checkbox"
                      name="mfaRequired"
                      defaultChecked
                      className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
                    />
                    Require authenticator code on sign-in
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-slate-900">
                    <input
                      type="checkbox"
                      name="role"
                      value="super-admin"
                      className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
                    />
                    Grant super admin access
                  </label>
                  <button
                    type="submit"
                    disabled={!isSuperAdmin}
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Create admin user
                  </button>
                </form>

                <div className="mt-5 rounded-[20px] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                  New MFA-enabled users receive a generated TOTP secret immediately. Share the setup secret or URI with the user through a secure channel so they can add it to their authenticator app.
                </div>
              </section>

              <section className="grid gap-4">
                {bootstrapAdmin ? (
                  <BootstrapAdminCard username={bootstrapAdmin.username} />
                ) : null}

                {managedAdminUsers.length === 0 ? (
                  <EmptyState message="No managed admin users have been created yet." />
                ) : (
                  <>
                    {paginatedManagedAdminUsers.items.map((user) => (
                      <ManagedAdminUserCard
                        key={user.id}
                        user={user}
                        highlighted={accessUserId === user.id}
                        returnTo={buildBackofficeHref(
                          params,
                          { tab: "access", accessState: null, accessError: null },
                          `admin-user-${user.id}`,
                        )}
                        editable={isSuperAdmin}
                      />
                    ))}
                    <PaginationControls
                      label="managed admin users"
                      pagination={paginatedManagedAdminUsers}
                      params={params}
                    />
                  </>
                )}
              </section>
            </div>
          </section>
        ) : null}

        {activeTab === "audit" ? (
          <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                  Audit trail
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                  Security, payment, and webhook events
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                This captures backoffice sign-ins plus payment and webhook state transitions.
              </p>
            </div>

            <form method="get" className="mt-6 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
              <input type="hidden" name="tab" value="audit" />
              <FilterField label="Target">
                <select name="auditTarget" defaultValue={auditTargetFilter || "all"} className={filterInputClassName}>
                  <option value="all">All targets</option>
                  <option value="ADMIN">Admin</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="WEBHOOK">Webhook</option>
                  <option value="CARD">Card</option>
                </select>
              </FilterField>
              <FilterField label="Search">
                <input
                  name="auditQuery"
                  defaultValue={auditQuery}
                  placeholder="Action, actor, detail"
                  className={filterInputClassName}
                />
              </FilterField>
              <FilterField label="Submission date">
                <select name="auditSort" defaultValue={auditSort} className={filterInputClassName}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </FilterField>
              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Apply filters
                </button>
                <Link
                  href="/backoffice?tab=audit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                >
                  Reset
                </Link>
              </div>
            </form>

            {filteredAuditEvents.length === 0 ? (
              <EmptyState message="No audit events match the current filters." />
            ) : (
              <>
                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-700">
                    <thead>
                      <tr>
                        <th className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">Time</th>
                        <th className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">Action</th>
                        <th className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">Actor</th>
                        <th className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAuditEvents.items.map((event) => (
                        <AuditRow key={event.id} event={event} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  label="audit events"
                  pagination={paginatedAuditEvents}
                  params={params}
                />
              </>
            )}
          </section>
        ) : null}

        <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
                Conversion summary
              </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                Current conversion snapshot
                </h2>
            </div>
            <p className="text-sm leading-6 text-slate-500">
              Completed order value currently totals {formatMoney(completedValue)}.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function ManualPaidCustomerForm({
  chargerOptions,
  returnTo,
}: {
  chargerOptions: Array<{ slug: string; name: string; installedPrice: number }>;
  returnTo: string;
}) {
  return (
    <details className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00738a]">
              Manual recovery
            </p>
            <h3 className="mt-1 text-lg font-bold tracking-[-0.03em] text-slate-950">
              Enter a customer as paid
            </h3>
          </div>
          <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900">
            Open manual entry
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Use this only after a manual payment link has been paid and reconciled outside the hosted checkout.
        </p>
      </summary>

      <form
        method="post"
        action="/api/backoffice/manual-payment"
        className="mt-4 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2 xl:grid-cols-4"
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        <FilterField label="First name">
          <input name="customerFirstName" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Last name">
          <input name="customerLastName" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Email">
          <input name="customerEmail" type="email" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="UK mobile">
          <input name="customerPhone" inputMode="tel" placeholder="07..." required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Product">
          <select name="chargerSlug" required className={filterInputClassName}>
            <option value="">Select charger</option>
            {chargerOptions.map((charger) => (
              <option key={charger.slug} value={charger.slug}>
                {charger.name} ({formatMoney(charger.installedPrice)})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Amount paid">
          <input name="amount" inputMode="decimal" placeholder="875.00" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Manual payment reference">
          <input name="manualReference" placeholder="Manual link / bank / Square ref" className={filterInputClassName} />
        </FilterField>
        <FilterField label="Property">
          <input name="propertyType" placeholder="Semi-detached" className={filterInputClassName} />
        </FilterField>
        <FilterField label="Address line 1">
          <input name="billingLine1" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Address line 2">
          <input name="billingLine2" className={filterInputClassName} />
        </FilterField>
        <FilterField label="Town / city">
          <input name="billingCity" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Postcode">
          <input name="billingPostalCode" required className={filterInputClassName} />
        </FilterField>
        <FilterField label="Parking">
          <input name="parkingType" placeholder="Driveway" className={filterInputClassName} />
        </FilterField>
        <FilterField label="Cable run">
          <input name="fuseBoxDistance" placeholder="Up to 10m" className={filterInputClassName} />
        </FilterField>
        <input type="hidden" name="billingCountry" value="GB" />
        <div className="flex items-end md:col-span-2">
          <button
            type="submit"
            className="admin-action-button inline-flex min-h-12 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
          >
            Create paid customer record
          </button>
        </div>
      </form>
    </details>
  );
}

function JourneyCard({
  interaction,
  open = false,
  returnTo,
}: {
  interaction: CheckoutInteraction;
  open?: boolean;
  returnTo: string;
}) {
  const effectiveStatus = getCheckoutInteractionEffectiveStatus(interaction);
  const detailsSubmitted = hasSubmittedCheckoutDetails(interaction);
  const canRecordManualPayment = detailsSubmitted && effectiveStatus !== "PAYMENT_COMPLETED";
  const customerSummary =
    interaction.customerFirstName || interaction.customerLastName
      ? [interaction.customerFirstName, interaction.customerLastName].filter(Boolean).join(" ")
      : "Anonymous checkout interaction";
  const quickFacts = [
    {
      label: "Lifecycle",
      value: effectiveStatus.replaceAll("_", " "),
    },
    {
      label: "Loss point",
      value: getCheckoutInteractionLossPoint(interaction),
    },
    {
      label: "Payment choice",
      value: interaction.paymentChoice || "Not chosen",
    },
    {
      label: "Estimate",
      value: interaction.total !== undefined ? formatMoney(interaction.total) : "Not available",
    },
  ];

  return (
    <article id={`journey-${interaction.id}`} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <details className="group" open={open}>
        <summary className="list-none cursor-pointer">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex rounded-full border border-[#00eaff]/30 bg-[#00eaff]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#006c88]">
                  {getJourneyOutcomeLabel(interaction)}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {getStepLabel(interaction.lastStep)}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {detailsSubmitted ? "Details submitted" : "Pre-details"}
                </span>
                {interaction.paymentChoice ? (
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    {interaction.paymentChoice === "frasers-plus" ? "Frasers Plus interest" : "Card interest"}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <h3 className="text-2xl font-bold tracking-[-0.04em] text-slate-950">
                    {interaction.chargerName ?? "Checkout interaction"}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {customerSummary}
                    {interaction.customerEmail ? ` | ${interaction.customerEmail}` : ""}
                    {interaction.customerPhone ? ` | ${interaction.customerPhone}` : ""}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Ref {interaction.paymentId}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                  <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-right">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Last movement
                    </p>
                    <strong className="mt-2 block text-lg font-bold tracking-[-0.03em] text-slate-950">
                      {formatTimestamp(interaction.updatedAt)}
                    </strong>
                  </div>
                  <span className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition group-open:border-[#00c7ef] group-open:text-[#008fb5]">
                    {interaction.trace.length} event{interaction.trace.length === 1 ? "" : "s"} | View full interaction
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {quickFacts.map((fact) => (
              <DetailCard key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </div>
        </summary>

        <div className="mt-5 border-t border-slate-200 pt-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <DetailCard label="Tracking reference" value={interaction.paymentId} breakWord />
              <DetailCard label="Selected product" value={interaction.chargerName || "Not selected"} />
              <DetailCard label="Property" value={interaction.propertyType || "Not answered"} />
              <DetailCard label="Parking" value={interaction.parkingType || "Not answered"} />
              <DetailCard label="Cable run" value={interaction.fuseBoxDistance || "Not answered"} />
              <DetailCard label="Customer details state" value={detailsSubmitted ? "Submitted" : "Not submitted"} />
            </div>

            <div className="grid gap-4">
              <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Customer and installation details
                </p>
                <div className="mt-3 text-sm leading-7 text-slate-700">
                  <p>{customerSummary || "Name not submitted"}</p>
                  <p>{interaction.customerEmail || "Email not submitted"}</p>
                  <p>{interaction.customerPhone || "Mobile not submitted"}</p>
                  <p>{interaction.billingLine1 || "Address line 1 not submitted"}</p>
                  {interaction.billingLine2 ? <p>{interaction.billingLine2}</p> : null}
                  <p>{interaction.billingCity || "Town or city not submitted"}</p>
                  <p>{interaction.billingPostalCode || "Postcode not submitted"}</p>
                  <p>{interaction.billingCountry || "Country not submitted"}</p>
                </div>
              </div>

              {canRecordManualPayment ? (
                <form
                  method="post"
                  action="/api/backoffice/manual-payment"
                  className="rounded-[24px] border border-amber-200 bg-amber-50 p-4"
                >
                  <input type="hidden" name="sourcePaymentId" value={interaction.paymentId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="amount" value={interaction.total ?? ""} />
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                    Manual paid recovery
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-950">
                    If this customer paid via a manual link, record it here to move them into the paid flow.
                  </p>
                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">
                    Manual payment reference
                    <input
                      name="manualReference"
                      placeholder="Manual link / Square / bank ref"
                      className="mt-2 min-h-11 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-200"
                    />
                  </label>
                  <button
                    type="submit"
                    className="admin-action-button mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
                  >
                    Mark manually paid
                  </button>
                </form>
              ) : null}

              <details className="rounded-[24px] border border-slate-200 bg-white p-4" open>
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-950">
                  Journey trace
                </summary>
                <div className="mt-4 grid gap-3">
                  {interaction.trace.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-[18px] border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="text-sm text-slate-950">{entry.label}</strong>
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {formatTimestamp(entry.at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{entry.detail}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>
      </details>
    </article>
  );
}

function SurveyWorkflowCard({
  workflow,
  topUpSession,
  open = false,
  returnTo,
  bookingReturnTo,
}: {
  workflow: SurveyWorkflow;
  topUpSession?: PaymentSession;
  open?: boolean;
  returnTo: string;
  bookingReturnTo: string;
}) {
  const reviewLink = workflow.reviewToken
    ? `/survey-review/${encodeURIComponent(workflow.reviewToken)}`
    : null;
  const finalAmount = getResolvedWorkflowAmount(workflow);
  const surveyOverdue = isSurveyOverdue(workflow);
  const surveyDeadline = getSurveyResponseDeadline(workflow);
  const overdueActionDetail =
    workflow.provider === "FRASERS_PLUS"
      ? "Survey not received within 3 days. Contact the customer now or reverse/refund the Frasers Plus allocation if the order cannot proceed."
      : workflow.provider === "CARD"
        ? "Survey not received within 3 days. Contact the customer now or issue a card refund if the order cannot proceed."
        : "Survey not received within 3 days. Contact the customer now before closing the order.";
  const canApproveForBooking =
    workflow.surveyStatus === "SURVEY_RECEIVED" &&
    (workflow.amendedAmount ?? workflow.originalAmount) === workflow.originalAmount &&
    !workflow.amendmentNotes?.trim();
  const hasBalanceDue = Boolean(workflow.balanceDue && workflow.balanceDue > 0);

  return (
    <article id={`survey-${workflow.id}`} className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
      <details className="group" open={open}>
        <summary className="list-none cursor-pointer">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-[#00eaff]/30 bg-[#00eaff]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#006c88]">
                  {formatWorkflowStatus(workflow.surveyStatus)}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {workflow.provider === "FRASERS_PLUS"
                    ? "Frasers Plus"
                    : workflow.provider === "CARD"
                      ? "Card"
                      : "No payment yet"}
                </span>
                {workflow.reviewLinkExpiresAt ? (
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Review deadline {formatTimestamp(workflow.reviewLinkExpiresAt)}
                  </span>
                ) : null}
                {surveyOverdue ? (
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                    Survey overdue
                  </span>
                ) : null}
                {workflow.jumptech?.projectId ? (
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Jumptech linked
                  </span>
                ) : null}
                {workflow.refundStatus !== "NONE" ? (
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                    Refund {formatRefundStatus(workflow.refundStatus).toLowerCase()}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 break-all text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Order reference: {workflow.sourcePaymentId}
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-[-0.04em] text-slate-950">
                {workflow.chargerName ?? "Survey review case"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {workflow.customerName ?? "Customer not set"}
                {workflow.customerEmail ? ` | ${workflow.customerEmail}` : ""}
                {workflow.customerPhone ? ` | ${workflow.customerPhone}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Revised total
                </p>
                <strong className="mt-1 block text-xl font-bold tracking-[-0.03em] text-slate-950">
                  {formatMoney(finalAmount)}
                </strong>
              </div>
              <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition group-open:border-[#00c7ef] group-open:text-[#008fb5]">
                View survey actions
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-slate-200 pt-4 md:grid-cols-2 xl:grid-cols-5">
            <FlatField label="Order reference" value={workflow.sourcePaymentId} />
            <FlatField label="Original estimate" value={formatMoney(workflow.originalAmount)} />
            {hasBalanceDue ? (
              <FlatField label="Additional amount" value={formatMoney(workflow.balanceDue ?? 0)} />
            ) : workflow.discountAmount && workflow.discountAmount > 0 ? (
              <FlatField
                label="Discount applied"
                value={`${formatMoney(workflow.discountAmount)}${workflow.discountCode ? ` | ${workflow.discountCode}` : ""}${workflow.discountLabel ? ` | ${workflow.discountLabel}` : ""}`}
              />
            ) : (
              <FlatField label="Survey due by" value={formatTimestamp(surveyDeadline)} />
            )}
            {hasBalanceDue ? (
              <FlatField
                label="Top-up status"
                value={
                  topUpSession?.latestStatus?.status ||
                  formatTopUpStatus(workflow.topUpPaymentStatus)
                }
              />
            ) : (
              <FlatField
                label="Survey reviewed"
                value={workflow.surveyReviewedAt ? formatTimestamp(workflow.surveyReviewedAt) : "Awaiting review"}
              />
            )}
            {hasBalanceDue ? (
              <FlatField
                label="Top-up route"
                value={formatPaymentRoute(workflow.topUpPaymentChoice)}
              />
            ) : preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length ? (
              <FlatField
                label="Preferred dates"
                value={formatPreferredInstallationDates(workflow.preferredInstallationDates)}
              />
            ) : (
              <FlatField
                label="Jumptech status"
                value={workflow.jumptech?.currentStatusLabel || workflow.jumptech?.status || "Awaiting project update"}
              />
            )}
            {hasBalanceDue ? (
              <FlatField
                label="Jumptech status"
                value={workflow.jumptech?.currentStatusLabel || workflow.jumptech?.status || "Awaiting project update"}
              />
            ) : null}
          </div>
        </summary>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="space-y-5 xl:border-r xl:border-slate-200 xl:pr-6">
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Customer and installation details
                </p>
                <div className="mt-3 grid gap-1 text-sm leading-7 text-slate-700">
                  <p>{workflow.customerName || "Name not available"}</p>
                  <p>{workflow.customerEmail || "Email not available"}</p>
                  <p>{workflow.customerPhone || "Phone not available"}</p>
                  <p>{workflow.deliveryAddress?.line1 || workflow.billingAddress?.line1 || "Address not available"}</p>
                  {workflow.deliveryAddress?.line2 || workflow.billingAddress?.line2 ? (
                    <p>{workflow.deliveryAddress?.line2 || workflow.billingAddress?.line2}</p>
                  ) : null}
                  <p>{workflow.deliveryAddress?.city || workflow.billingAddress?.city || "Town not set"}</p>
                  <p>{workflow.deliveryAddress?.postalCode || workflow.billingAddress?.postalCode || "Postcode not set"}</p>
                </div>
              </section>

              {workflow.amendmentNotes ? (
                <section className="border-t border-slate-200 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Current amendment notes
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-700">{workflow.amendmentNotes}</p>
                </section>
              ) : null}

              {workflow.balanceDue ? (
                <section className="border-t border-slate-200 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Additional payment tracking
                  </p>
                  <div className="mt-3 grid gap-1 text-sm leading-7 text-slate-700">
                    <p>Additional amount: {formatMoney(workflow.balanceDue)}</p>
                    <p>Top-up route: {formatPaymentRoute(workflow.topUpPaymentChoice)}</p>
                    <p>
                      Top-up status:{" "}
                      {topUpSession?.latestStatus?.status || formatTopUpStatus(workflow.topUpPaymentStatus)}
                    </p>
                    <p>
                      Top-up payment reference:{" "}
                      {workflow.topUpPaymentId || workflow.replacementPaymentId || "Not created yet"}
                    </p>
                    {workflow.topUpUpr || workflow.replacementUpr ? (
                      <p>Top-up UPR: {workflow.topUpUpr || workflow.replacementUpr}</p>
                    ) : null}
                    {workflow.topUpRequestedAt ? (
                      <p>Top-up started: {formatTimestamp(workflow.topUpRequestedAt)}</p>
                    ) : null}
                    {workflow.topUpCompletedAt ? (
                      <p>Top-up completed: {formatTimestamp(workflow.topUpCompletedAt)}</p>
                    ) : null}
                    {workflow.topUpFailureReason ? (
                      <p className="text-amber-700">{workflow.topUpFailureReason}</p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length ? (
                <section className="border-t border-slate-200 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Preferred installation dates
                  </p>
                  <div className="mt-3 grid gap-1 text-sm leading-7 text-slate-700">
                    {workflow.preferredInstallationDates.map((value) => (
                      <p key={value}>{formatPreferredInstallationDate(value)}</p>
                    ))}
                    {workflow.preferredInstallationDatesUpdatedAt ? (
                      <p className="pt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                        Saved {formatTimestamp(workflow.preferredInstallationDatesUpdatedAt)}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {surveyOverdue ? (
                <section className="rounded-[20px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                    Action required
                  </p>
                  <p className="mt-2 text-sm leading-7 text-amber-900">{overdueActionDetail}</p>
                </section>
              ) : null}

              {reviewLink ? (
                <section className="border-t border-slate-200 pt-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Customer status link
                      </p>
                      <p className="mt-2 break-all text-sm leading-6 text-slate-700">{reviewLink}</p>
                    </div>
                    <Link
                      href={reviewLink}
                      className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#00eaff] px-5 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                      >
                        Open customer page
                      </Link>
                    </div>
                </section>
              ) : null}

              <BackofficeRefundActions workflow={workflow} returnTo={returnTo} />

              {workflow.jumptech ? (
                <section className="border-t border-slate-200 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Jumptech project
                  </p>
                  <div className="mt-3 grid gap-2 text-sm leading-7 text-slate-700">
                    <p>Project ID: {workflow.jumptech.projectId || "Pending"}</p>
                    <p>
                      Status: {workflow.jumptech.currentStatusLabel || workflow.jumptech.status || "Awaiting update"}
                    </p>
                    {workflow.jumptech.currentStatusDetail ? (
                      <p>{workflow.jumptech.currentStatusDetail}</p>
                    ) : null}
                    {workflow.jumptech.lastWebhookAt ? (
                      <p>Last webhook: {formatTimestamp(workflow.jumptech.lastWebhookAt)}</p>
                    ) : null}
                    {workflow.jumptech.lastError ? (
                      <p className="text-amber-700">{workflow.jumptech.lastError}</p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>

            <form
              action="/api/backoffice/post-survey"
              method="post"
              className="self-start"
            >
              <input type="hidden" name="workflowId" value={workflow.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="bookingReturnTo" value={bookingReturnTo} />
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Survey confirmation
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Mark the digital survey as received once the ops team has reviewed it.
                </p>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Ops note
                    <textarea
                      name="surveyAdminNotes"
                      rows={3}
                      defaultValue={workflow.adminNotes || ""}
                      className={`${filterInputClassName} mt-2 min-h-[84px] resize-y`}
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    name="action"
                    value="confirm-survey"
                    formAction="/api/backoffice/post-survey?action=confirm-survey"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                  >
                    {workflow.surveyReceivedAt ? "Update survey note" : "Confirm survey received"}
                  </button>
                  {canApproveForBooking ? (
                    <button
                      type="submit"
                      name="action"
                      value="approve-booking"
                      formAction="/api/backoffice/post-survey?action=approve-booking"
                      className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Approve for booking
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="mt-5 border-t border-slate-200 pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Update customer page
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Amended total
                    <input
                      name="amendedAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={workflow.amendedAmount ?? workflow.originalAmount}
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Link expiry (hours)
                    <input
                      name="expiresInHours"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={72}
                      className={`${filterInputClassName} mt-2`}
                    />
                  </label>
                </div>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Amendment notes shown to customer
                  <textarea
                    name="amendmentNotes"
                    rows={4}
                    defaultValue={workflow.amendmentNotes || ""}
                    className={`${filterInputClassName} mt-2 min-h-[100px] resize-y`}
                  />
                </label>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Internal note
                  <textarea
                      name="reviewAdminNotes"
                    rows={3}
                    defaultValue={workflow.adminNotes || ""}
                    className={`${filterInputClassName} mt-2 min-h-[84px] resize-y`}
                  />
                </label>
                <button
                  type="submit"
                  name="action"
                  value="save-review"
                  formAction="/api/backoffice/post-survey?action=save-review"
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Save customer update
                </button>
              </section>
            </form>

            <section className="rounded-[22px] border border-red-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-500">
                Back office cleanup
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Remove this record from operational views and KPI totals. Provider records and audit history are retained.
              </p>
              <div className="mt-4">
                <DeleteWorkflowButton
                  workflowId={workflow.id}
                  returnTo={returnTo}
                  reference={workflow.sourcePaymentId}
                />
              </div>
            </section>
          </div>
        </div>
      </details>
    </article>
  );
}

function BookingWorkflowCard({
  workflow,
  topUpSession,
  open = false,
  returnTo,
  bookedReturnTo,
  installers,
  installerMatch,
  workOrder,
  workOrderInstaller,
}: {
  workflow: SurveyWorkflow;
  topUpSession?: PaymentSession;
  open?: boolean;
  returnTo: string;
  bookedReturnTo: string;
  installers: InstallerRecord[];
  installerMatch?: InstallerMatch | null;
  workOrder?: WorkOrderRecord | null;
  workOrderInstaller?: InstallerRecord | null;
}) {
  const reviewLink = workflow.reviewToken
    ? `/survey-review/${encodeURIComponent(workflow.reviewToken)}`
    : null;
  const isBookedStage = workflow.surveyStatus === "BOOKED_FOR_INSTALLATION";
  const hasDispatchInfo = Boolean(workflow.chargerDispatchedAt || workflow.chargerExpectedDeliveryDate);
  const showDispatchControls = isBookedStage || hasDispatchInfo;
  const showAdditionalPaymentSummary = Boolean(workflow.balanceDue) && !isBookedStage;
  const installationAddressSummary =
    [
      workflow.deliveryAddress?.line1 || workflow.billingAddress?.line1,
      workflow.deliveryAddress?.line2 || workflow.billingAddress?.line2,
      workflow.deliveryAddress?.city || workflow.billingAddress?.city,
      workflow.deliveryAddress?.postalCode || workflow.billingAddress?.postalCode,
    ]
      .filter(Boolean)
      .join(", ") || "Address not available";
  const dispatchSummary = workflow.chargerDispatchedAt
    ? workflow.chargerExpectedDeliveryDate
      ? `Dispatched, expected ${formatPreferredInstallationDate(workflow.chargerExpectedDeliveryDate)}`
      : `Dispatched ${formatTimestamp(workflow.chargerDispatchedAt)}`
    : "Awaiting dispatch";
  const jumptechStatusSummary =
    workflow.jumptech?.currentStatusLabel ||
    workflow.jumptech?.status ||
    "Awaiting project update";
  const topUpStatusSummary =
    topUpSession?.latestStatus?.status || formatTopUpStatus(workflow.topUpPaymentStatus);

  return (
    <article id={`booking-${workflow.id}`} className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
      <details className="group" open={open}>
        <summary className="list-none cursor-pointer">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-[#00eaff]/30 bg-[#00eaff]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#006c88]">
                  {formatWorkflowStatus(workflow.surveyStatus)}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {workflow.provider === "FRASERS_PLUS"
                    ? "Frasers Plus"
                    : workflow.provider === "CARD"
                      ? "Card"
                      : "No payment route"}
                </span>
                {workflow.jumptech?.projectId ? (
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Jumptech linked
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 text-xl font-bold tracking-[-0.04em] text-slate-950">
                {workflow.chargerName ?? "Order ready for booking"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {workflow.customerName ?? "Customer not set"}
                {workflow.customerEmail ? ` | ${workflow.customerEmail}` : ""}
                {workflow.customerPhone ? ` | ${workflow.customerPhone}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Confirmed total
                </p>
                <strong className="mt-1 block text-xl font-bold tracking-[-0.03em] text-slate-950">
                  {formatMoney(getResolvedWorkflowAmount(workflow))}
                </strong>
              </div>
              <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition group-open:border-[#00c7ef] group-open:text-[#008fb5]">
                {isBookedStage ? "View job actions" : "View booking actions"}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-slate-200 pt-4 md:grid-cols-2 xl:grid-cols-4">
            <FlatField
              label={isBookedStage ? "Installation date" : "Approved for booking"}
              value={
                isBookedStage
                  ? workflow.installationDate || "Date not set"
                  : formatTimestamp(workflow.bookingApprovedAt)
              }
            />
            {isBookedStage ? (
              <FlatField label="Installer" value={workflow.installerName || "Installer not assigned"} />
            ) : preferredDatesEnabledForWorkflow(workflow) ? (
              <FlatField
                label="Preferred dates"
                value={formatPreferredInstallationDates(workflow.preferredInstallationDates)}
              />
            ) : <FlatField label="Installer" value={workflow.installerName || "Installer not assigned"} />}
            <FlatField
              label={isBookedStage ? "Charger dispatch" : "Work order"}
              value={
                isBookedStage
                  ? workflow.chargerDispatchedAt
                    ? `Dispatched ${formatTimestamp(workflow.chargerDispatchedAt)}`
                    : "Awaiting dispatch"
                  : workOrder
                    ? `${workOrder.purchaseOrderNumber} ${workOrder.sentAt ? "sent" : "ready"}`
                    : "Not generated yet"
              }
            />
            <FlatField
              label={isBookedStage ? "Jumptech status" : "Booking status"}
              value={workflow.jumptech?.currentStatusLabel || workflow.jumptech?.status || "Awaiting project update"}
            />
          </div>
        </summary>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DetailCard label="Installation address" value={installationAddressSummary} />
            <DetailCard label="Installer" value={workflow.installerName || "Installer not assigned"} />
            <DetailCard label="Charger dispatch" value={dispatchSummary} />
            <DetailCard label="Jumptech status" value={jumptechStatusSummary} />
            {showAdditionalPaymentSummary ? (
              <DetailCard
                label="Additional payment"
                value={`${formatMoney(workflow.balanceDue ?? 0)} | ${topUpStatusSummary}`}
              />
            ) : null}
            {!isBookedStage && preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length ? (
              <DetailCard
                label="Preferred dates"
                value={formatPreferredInstallationDates(workflow.preferredInstallationDates)}
              />
            ) : null}
          </div>

          <div className="mt-5 grid items-start gap-4 xl:grid-cols-3">
            <form
              action="/api/backoffice/post-survey"
              method="post"
              className="rounded-[24px] border border-slate-200 bg-white p-5"
            >
              <input type="hidden" name="workflowId" value={workflow.id} />
              <input type="hidden" name="action" value="mark-booked" />
              <input
                type="hidden"
                name="returnTo"
                value={workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" ? bookedReturnTo : returnTo}
              />
              <input type="hidden" name="bookingReturnTo" value={bookedReturnTo} />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Booking details
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Installation date
                  <input
                    type="text"
                    name="installationDate"
                    defaultValue={workflow.installationDate || ""}
                    placeholder="e.g. 28 Apr 2026, AM"
                    className={`${filterInputClassName} mt-2`}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Installer name
                  <input
                    type="text"
                    name="installerName"
                    defaultValue={workflow.installerName || ""}
                    className={`${filterInputClassName} mt-2`}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Installer email
                  <input
                    type="email"
                    name="installerEmail"
                    defaultValue={workflow.installerEmail || ""}
                    className={`${filterInputClassName} mt-2`}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Installer phone
                  <input
                    type="text"
                    name="installerPhone"
                    defaultValue={workflow.installerPhone || ""}
                    className={`${filterInputClassName} mt-2`}
                  />
                </label>
              </div>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Installer notes
                <textarea
                  name="installerNotes"
                  rows={3}
                  defaultValue={workflow.installerNotes || ""}
                  className={`${filterInputClassName} mt-2 min-h-[84px] resize-y`}
                />
              </label>
              <button
                type="submit"
                formAction="/api/backoffice/post-survey?action=mark-booked"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {workflow.surveyStatus === "BOOKED_FOR_INSTALLATION"
                  ? "Update booking details"
                  : "Mark as booked"}
              </button>
            </form>

            <WorkOrderPanel
              workflow={workflow}
              installers={installers}
              installerMatch={installerMatch}
              workOrder={workOrder}
              workOrderInstaller={workOrderInstaller}
            />

            {showDispatchControls ? (
              <form
                action="/api/backoffice/post-survey"
                method="post"
                className="rounded-[24px] border border-slate-200 bg-white p-5"
              >
              <input type="hidden" name="workflowId" value={workflow.id} />
              <input type="hidden" name="returnTo" value="/backoffice?tab=installed" />
              <input type="hidden" name="bookingReturnTo" value={bookedReturnTo} />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Charger dispatch
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Tick this once the charger has been dispatched to the customer address.
                The expected delivery date is shown on the portal link. Online cancellation closes after dispatch is confirmed.
              </p>
              <label className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  name="chargerDispatched"
                  defaultChecked={Boolean(workflow.chargerDispatchedAt)}
                  className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
                />
                Charger dispatched to customer
              </label>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Expected delivery date
                <input
                  type="date"
                  name="chargerExpectedDeliveryDate"
                  defaultValue={workflow.chargerExpectedDeliveryDate || ""}
                  className={`${filterInputClassName} mt-2`}
                />
              </label>
              <button
                type="submit"
                name="action"
                value="save-dispatch"
                formAction="/api/backoffice/post-survey?action=save-dispatch"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {workflow.chargerDispatchedAt ? "Update dispatch status" : "Save dispatch status"}
              </button>
              </form>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {reviewLink || isBookedStage ? (
              <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  {reviewLink ? (
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Customer status link
                      </p>
                      <p className="mt-2 truncate text-sm leading-6 text-slate-700">{reviewLink}</p>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Installation completion
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        Mark complete if the install has finished before the Jumptech installed update arrives.
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {reviewLink ? (
                      <Link
                        href={reviewLink}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[#00eaff] px-5 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
                      >
                        Open customer page
                      </Link>
                    ) : null}
                    {isBookedStage ? (
                      <form action="/api/backoffice/post-survey" method="post">
                        <input type="hidden" name="workflowId" value={workflow.id} />
                        <input type="hidden" name="returnTo" value="/backoffice?tab=installed" />
                        <input type="hidden" name="bookingReturnTo" value={bookedReturnTo} />
                        <button
                          type="submit"
                          name="action"
                          value="mark-installed"
                          formAction="/api/backoffice/post-survey?action=mark-installed"
                          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                        >
                          Mark installed
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {workflow.jumptech ? (
              <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Jumptech project
                </p>
                <div className="mt-2 grid gap-1 text-sm leading-6 text-slate-700">
                  <p className="break-all">Project ID: {workflow.jumptech.projectId || "Pending"}</p>
                  <p>Status: {jumptechStatusSummary}</p>
                  {workflow.jumptech.lastWebhookAt ? (
                    <p>Last webhook: {formatTimestamp(workflow.jumptech.lastWebhookAt)}</p>
                  ) : null}
                  {workflow.jumptech.lastError ? (
                    <p className="text-amber-700">{workflow.jumptech.lastError}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          <BackofficeRefundActions workflow={workflow} returnTo={returnTo} />
          <section className="mt-4 rounded-[22px] border border-red-100 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-500">
                  Back office cleanup
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Remove this record from operational views and KPI totals. Provider records and audit history are retained.
                </p>
              </div>
              <DeleteWorkflowButton
                workflowId={workflow.id}
                returnTo={returnTo}
                reference={workflow.sourcePaymentId}
              />
            </div>
          </section>
        </div>
      </details>
    </article>
  );
}

function InstalledWorkflowCard({
  workflow,
  installers,
  installerMatch,
  workOrder,
  workOrderInstaller,
  returnTo,
}: {
  workflow: SurveyWorkflow;
  installers: InstallerRecord[];
  installerMatch?: InstallerMatch | null;
  workOrder?: WorkOrderRecord | null;
  workOrderInstaller?: InstallerRecord | null;
  returnTo: string;
}) {
  const reviewLink = workflow.reviewToken
    ? `/survey-review/${encodeURIComponent(workflow.reviewToken)}`
    : null;
  const address = workflow.deliveryAddress ?? workflow.billingAddress;

  return (
    <article id={`installed-${workflow.id}`} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Installed
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
              {workflow.provider === "FRASERS_PLUS"
                ? "Frasers Plus"
                : workflow.provider === "CARD"
                  ? "Card"
                  : "No payment route"}
            </span>
          </div>
          <h3 className="mt-3 text-xl font-bold tracking-[-0.04em] text-slate-950">
            {workflow.chargerName ?? "Installed charger"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {workflow.customerName ?? "Customer not set"}
            {workflow.customerEmail ? ` | ${workflow.customerEmail}` : ""}
            {workflow.customerPhone ? ` | ${workflow.customerPhone}` : ""}
          </p>
        </div>

        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Completed
          </p>
          <strong className="mt-1 block text-base font-bold text-slate-950">
            {formatTimestamp(workflow.jumptech?.completedAt || workflow.installationDate || workflow.bookedAt)}
          </strong>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailCard label="Order reference" value={workflow.sourcePaymentId} breakWord />
        <DetailCard label="Jumptech project" value={workflow.jumptech?.projectId || "Not linked"} breakWord />
        <DetailCard label="Installer" value={workflow.installerName || "Not assigned"} />
        <DetailCard label="Installation date" value={workflow.installationDate || "Not recorded"} />
        <DetailCard
          label="Address"
          value={
            address
              ? [address.line1, address.line2, address.city, address.postalCode]
                  .filter(Boolean)
                  .join(", ")
              : "Not available"
          }
        />
        <DetailCard label="Final total" value={formatMoney(getResolvedWorkflowAmount(workflow))} />
        <DetailCard
          label="Charger dispatch"
          value={
            workflow.chargerDispatchedAt
              ? workflow.chargerExpectedDeliveryDate
                ? `Expected ${formatPreferredInstallationDate(workflow.chargerExpectedDeliveryDate)}`
                : "Dispatched"
              : "Not recorded"
          }
        />
        <DetailCard
          label="Customer link"
          value={reviewLink || "Not available"}
          breakWord
        />
      </div>

      {workflow.jumptech?.currentStatusDetail || workflow.installerNotes ? (
        <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Notes
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-700">
            {workflow.installerNotes || workflow.jumptech?.currentStatusDetail}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <WorkOrderPanel
          workflow={workflow}
          installers={installers}
          installerMatch={installerMatch}
          workOrder={workOrder}
          workOrderInstaller={workOrderInstaller}
        />
      </div>

      <BackofficeRefundActions workflow={workflow} returnTo={returnTo} />
      <section className="mt-4 rounded-[22px] border border-red-100 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-500">
              Back office cleanup
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Remove this record from operational views and KPI totals. Provider records and audit history are retained.
            </p>
          </div>
          <DeleteWorkflowButton
            workflowId={workflow.id}
            returnTo={returnTo}
            reference={workflow.sourcePaymentId}
          />
        </div>
      </section>
    </article>
  );
}

function WorkOrderPanel({
  workflow,
  installers,
  installerMatch,
  workOrder,
  workOrderInstaller,
}: {
  workflow: SurveyWorkflow;
  installers: InstallerRecord[];
  installerMatch?: InstallerMatch | null;
  workOrder?: WorkOrderRecord | null;
  workOrderInstaller?: InstallerRecord | null;
}) {
  const enabledInstallers = installers.filter((installer) => installer.enabled);
  const ready = Boolean(workflow.installerName?.trim());
  const downloadHref = `/api/backoffice/work-orders/${encodeURIComponent(workflow.id)}`;
  const hasManualWorkOrder = workOrder?.installerMatchedName === "Manual selection";
  const canDownloadWorkOrder = Boolean(installerMatch || (workOrder && workOrderInstaller));
  const hasStaleWorkOrder = Boolean(workOrder && !workOrderInstaller);
  const workOrderReturnTo =
    workflow.surveyStatus === "INSTALLED"
      ? "/backoffice?tab=installed"
      : workflow.surveyStatus === "BOOKED_FOR_INSTALLATION"
        ? "/backoffice?tab=booked"
        : workflow.surveyStatus === "READY_FOR_BOOKING"
          ? "/backoffice?tab=booking"
          : "/backoffice?tab=survey";

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Installer work order / PO
      </p>
      <div className="mt-3 grid gap-2 text-sm leading-7 text-slate-700">
        {workOrder && workOrderInstaller ? (
          <p>
            PO {workOrder.purchaseOrderNumber} is ready to download using{" "}
            <strong>{workOrderInstaller.legalName}</strong>
            {hasManualWorkOrder ? " (manually selected)." : "."}
          </p>
        ) : workOrder ? (
          <p>
            PO {workOrder.purchaseOrderNumber} is ready to download
            {hasManualWorkOrder
              ? " using the manually selected installer legal record."
              : ` for installer record ${workOrder.installerMatchedName}.`}
          </p>
        ) : ready ? (
          <p>Generate a PDF purchase order once installer legal details are matched.</p>
        ) : (
          <p>
            Work order generation unlocks as soon as an installer is assigned, regardless of the
            project&apos;s current Jumptech stage.
          </p>
        )}
        {workflow.installerName ? (
          <p>
            Jumptech installer: <strong>{workflow.installerName}</strong>
          </p>
        ) : (
          <p>Jumptech installer has not been assigned yet.</p>
        )}
        {workOrderInstaller ? (
          <p>
            PO installer: <strong>{workOrderInstaller.legalName}</strong>
            {hasManualWorkOrder ? " (manual selection)" : null}
          </p>
        ) : null}
        {installerMatch ? (
          <p className="text-emerald-700">
            Matched to {installerMatch.installer.legalName} (
            {Math.round(installerMatch.score * 100)}%).
          </p>
        ) : hasStaleWorkOrder ? (
          <p className="text-amber-700">
            The saved PO references an installer legal record that is no longer available. Select the installer manually before downloading.
          </p>
        ) : ready && !workOrder ? (
          <p className="text-amber-700">
            No confident installer match yet. Select the installer manually before downloading.
          </p>
        ) : null}
      </div>

      {ready ? (
        <div className="mt-4 grid gap-3">
          {canDownloadWorkOrder ? (
            <form
              method="get"
              action={downloadHref}
              className="grid gap-3 rounded-[20px] border border-slate-200 bg-white p-4"
            >
              {installerMatch && !workOrder ? (
                <input type="hidden" name="installerId" value={installerMatch.installer.id} />
              ) : null}
              <label className="block text-sm font-medium text-slate-700">
                WO number
                <input
                  name="workOrderNumber"
                  className={`${filterInputClassName} mt-2`}
                  defaultValue={workOrder?.purchaseOrderNumber ?? ""}
                  placeholder="Auto-generates as VD2C26_0001"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                Leave blank to use the next automatic VD2C sequence. Enter a value here if the WO number needs to be amended.
              </p>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
              >
                {workOrder ? "Download PO PDF" : "Generate and download PO"}
              </button>
            </form>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-full bg-slate-200 px-5 text-center text-sm font-semibold text-slate-500"
              >
                Download PO PDF
              </button>
              <p className="text-xs leading-5 text-slate-500">
                {hasStaleWorkOrder
                  ? "The saved PO needs a valid installer legal record before it can be downloaded. Select the installer below to regenerate it."
                  : "Installer legal details could not be matched automatically. Select the installer below to generate the PO."}
              </p>
            </div>
          )}

          {!installerMatch && enabledInstallers.length ? (
            <form
              method="get"
              action={downloadHref}
              className="grid gap-3 rounded-[20px] border border-slate-200 bg-white p-4"
            >
              <label className="block text-sm font-medium text-slate-700">
                Select installer legal record
                <select
                  name="installerId"
                  className={`${filterInputClassName} mt-2`}
                  defaultValue={workOrderInstaller?.id ?? ""}
                  required
                >
                  <option value="">Choose installer</option>
                  {enabledInstallers.map((installer) => (
                    <option key={installer.id} value={installer.id}>
                      {installer.legalName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                WO number
                <input
                  name="workOrderNumber"
                  className={`${filterInputClassName} mt-2`}
                  defaultValue={workOrder?.purchaseOrderNumber ?? ""}
                  placeholder="Auto-generates as VD2C26_0001"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                Leave blank to use the next automatic VD2C sequence, or enter a manual WO number if needed.
              </p>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Generate PO with selected installer
              </button>
            </form>
          ) : null}

          {workOrder ? (
            <form
              action="/api/backoffice/post-survey"
              method="post"
              className="grid gap-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4"
            >
              <input type="hidden" name="workflowId" value={workflow.id} />
              <input type="hidden" name="action" value="mark-po-sent" />
              <input type="hidden" name="returnTo" value={workOrderReturnTo} />
              <input type="hidden" name="bookingReturnTo" value={workOrderReturnTo} />
              <label className="flex items-start gap-3 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  name="poSent"
                  required={!workOrder.sentAt}
                  defaultChecked={Boolean(workOrder.sentAt)}
                  disabled={Boolean(workOrder.sentAt)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
                />
                <span>
                  PO sent to installer
                  <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                    {workOrder.sentAt
                      ? `Confirmed ${formatTimestamp(workOrder.sentAt)} by ${workOrder.sentBy || "back office"}.`
                      : "Tick to confirm the PO has been sent. This will notify the operations Google Chat channel."}
                  </span>
                </span>
              </label>
              <button
                type="submit"
                name="action"
                value="mark-po-sent"
                formAction="/api/backoffice/post-survey?action=mark-po-sent"
                disabled={Boolean(workOrder.sentAt)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {workOrder.sentAt ? "PO sent confirmed" : "Confirm PO sent"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RefundRequestCard({
  workflow,
  returnTo,
}: {
  workflow: SurveyWorkflow;
  returnTo: string;
}) {
  return (
    <article id={`refund-${workflow.id}`} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full border border-[#00eaff]/30 bg-[#00eaff]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#006c88]">
              {formatRefundStatus(workflow.refundStatus)}
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
              {workflow.provider === "FRASERS_PLUS"
                ? "Frasers Plus"
                : workflow.provider === "CARD"
                  ? "Card"
                  : "No payment provider"}
            </span>
          </div>
          <h3 className="mt-4 text-2xl font-bold tracking-[-0.04em] text-slate-950">
            {workflow.chargerName ?? "Refund request"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {workflow.customerName ?? "Customer not set"}
            {workflow.customerEmail ? ` | ${workflow.customerEmail}` : ""}
            {workflow.customerPhone ? ` | ${workflow.customerPhone}` : ""}
          </p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Amount
          </p>
          <strong className="mt-2 block text-2xl font-bold tracking-[-0.03em] text-slate-950">
            {formatMoney(getResolvedWorkflowAmount(workflow))}
          </strong>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="grid gap-4 md:grid-cols-2">
          <DetailCard label="Source reference" value={workflow.sourcePaymentId} breakWord />
          <DetailCard label="Current payment" value={workflow.currentPaymentId} breakWord />
          <DetailCard label="Survey status" value={formatWorkflowStatus(workflow.surveyStatus)} />
          <DetailCard label="Refund requested" value={formatTimestamp(workflow.refundRequestedAt)} />
          <DetailCard
            label="Provider refund call"
            value={
              workflow.refundProviderResult === "SUCCEEDED"
                ? "Successful"
                : workflow.refundProviderResult === "FAILED"
                  ? "Failed"
                  : "Not run yet"
            }
          />
          <DetailCard
            label="Provider attempt"
            value={formatTimestamp(workflow.refundProviderAttemptedAt)}
          />
          {workflow.refundProviderAction ? (
            <DetailCard label="Provider action" value={workflow.refundProviderAction} />
          ) : null}
          {workflow.refundProviderDetail ? (
            <DetailCard label="Provider response" value={workflow.refundProviderDetail} />
          ) : null}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Customer reason
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            {workflow.refundReason || "No reason provided."}
          </p>
          {workflow.refundStatus !== "COMPLETED" ? <div className="mt-5 flex flex-wrap gap-3">
            <div className="w-full"><ProviderRefundForm workflow={workflow} returnTo={returnTo} /></div>
            <form action="/api/backoffice/refunds" method="post">
              <input type="hidden" name="workflowId" value={workflow.id} />
              <input type="hidden" name="action" value="reject-refund" />
              <input type="hidden" name="adminNotes" value="Refund request rejected by backoffice." />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              >
                Reject refund
              </button>
            </form>
            <DeleteWorkflowButton
              workflowId={workflow.id}
              returnTo={returnTo}
              reference={workflow.sourcePaymentId}
            />
          </div> : null}
          <div className="mt-4">{workflow.refundStatus === "COMPLETED" ? <BackofficeRefundActions workflow={workflow} returnTo={returnTo} /> : <ManualRefundForm workflow={workflow} returnTo={returnTo} />}</div>
        </div>
      </div>
    </article>
  );
}

function InstallerForm({
  installer,
  isSuperAdmin,
}: {
  installer?: InstallerRecord;
  isSuperAdmin: boolean;
}) {
  return (
    <form action="/api/admin/installers" method="post" className="mt-5 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2">
      <input type="hidden" name="action" value="upsert-installer" />
      {installer ? <input type="hidden" name="installerId" value={installer.id} /> : null}
      <label className="block text-sm font-medium text-slate-700">
        Display name / Jumptech name
        <input name="displayName" defaultValue={installer?.displayName || ""} required className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Legal name
        <input name="legalName" defaultValue={installer?.legalName || ""} required className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
        Aliases (comma separated)
        <input name="aliases" defaultValue={installer?.aliases.join(", ") || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Address line 1
        <input name="addressLine1" defaultValue={installer?.address.line1 || ""} required className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Address line 2
        <input name="addressLine2" defaultValue={installer?.address.line2 || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Town
        <input name="town" defaultValue={installer?.address.town || ""} required className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        County
        <input name="county" defaultValue={installer?.address.county || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Postcode
        <input name="postcode" defaultValue={installer?.address.postcode || ""} required className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Country
        <input name="country" defaultValue={installer?.address.country || "United Kingdom"} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        VAT number
        <input name="vatNumber" defaultValue={installer?.vatNumber || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Email
        <input type="email" name="email" defaultValue={installer?.email || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Phone
        <input name="phone" defaultValue={installer?.phone || ""} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Default PO amount including VAT
        <input type="number" min="0" step="0.01" name="defaultNetAmount" defaultValue={installer?.defaultNetAmount || 0} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        VAT rate %
        <input type="number" min="0" max="100" step="0.01" name="vatRate" defaultValue={installer?.vatRate ?? 20} className={`${filterInputClassName} mt-2`} />
      </label>
      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
        <input type="checkbox" name="enabled" defaultChecked={installer?.enabled ?? true} className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]" />
        Installer can be matched for PO generation
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={!isSuperAdmin} className="admin-action-button inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
          {installer ? "Save installer" : "Add installer"}
        </button>
      </div>
    </form>
  );
}

function InstallerCard({
  installer,
  isSuperAdmin,
}: {
  installer: InstallerRecord;
  isSuperAdmin: boolean;
}) {
  return (
    <details id={`installer-${installer.id}`} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <summary className="list-none cursor-pointer">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
                {installer.enabled ? "Active" : "Paused"}
              </span>
              {installer.vatNumber ? (
                <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
                  VAT {installer.vatNumber}
                </span>
              ) : null}
            </div>
            <h4 className="mt-3 text-lg font-bold text-slate-950">{installer.legalName}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {installer.displayName}
              {installer.aliases.length ? ` | ${installer.aliases.join(", ")}` : ""}
            </p>
          </div>
          <div className="text-sm font-semibold text-slate-900">
            Default PO {formatMoney(installer.defaultNetAmount)} inc VAT
          </div>
        </div>
      </summary>
      <div className="mt-4 border-t border-slate-200 pt-4">
        <InstallerForm installer={installer} isSuperAdmin={isSuperAdmin} />
        <div className="mt-4 flex flex-wrap gap-3">
          <form action="/api/admin/installers" method="post">
            <input type="hidden" name="action" value="toggle-installer" />
            <input type="hidden" name="installerId" value={installer.id} />
            <input type="hidden" name="enabled" value={installer.enabled ? "" : "on"} />
            <button type="submit" disabled={!isSuperAdmin} className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:opacity-50">
              {installer.enabled ? "Pause installer" : "Activate installer"}
            </button>
          </form>
          <form action="/api/admin/installers" method="post">
            <input type="hidden" name="action" value="delete-installer" />
            <input type="hidden" name="installerId" value={installer.id} />
            <button type="submit" disabled={!isSuperAdmin} className="inline-flex min-h-11 items-center justify-center rounded-full border border-rose-200 bg-white px-5 text-sm font-semibold text-rose-700 transition hover:border-rose-400 disabled:opacity-50">
              Delete installer
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}

function ProductDiscountForm({
  title,
  kind,
  isSuperAdmin,
}: {
  title: string;
  kind: "SPECIAL_OFFER" | "VOUCHER";
  isSuperAdmin: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <form action="/api/admin/product-settings" method="post" className="mt-4 grid gap-4">
        <input type="hidden" name="action" value="create-discount" />
        <input type="hidden" name="kind" value={kind} />
        <label className="block text-sm font-medium text-slate-700">
          Label
          <input
            type="text"
            name="label"
            placeholder={kind === "VOUCHER" ? "Friends and family" : "Summer installation offer"}
            required
            className={`${filterInputClassName} mt-2`}
          />
        </label>
        {kind === "VOUCHER" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Code
              <input
                type="text"
                name="code"
                placeholder="Leave blank to generate"
                className={`${filterInputClassName} mt-2 uppercase`}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Generated prefix
              <input
                type="text"
                name="codePrefix"
                defaultValue="VCHRGD"
                className={`${filterInputClassName} mt-2 uppercase`}
              />
            </label>
          </div>
        ) : null}
        {kind === "SPECIAL_OFFER" ? (
          <>
        <label className="block text-sm font-medium text-slate-700">
          Banner content
          <textarea
            name="bannerContent"
            placeholder="Example: ⚡ £200 off installed chargers this month"
            rows={3}
            className={`${filterInputClassName} mt-2 min-h-24`}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-500">
            Used as the promotional banner on the charger selection step. Emoji and plain text are supported.
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Disclaimer text
          <textarea
            name="disclaimerContent"
            placeholder="Example: Offer applies to new online orders only and cannot be used with voucher codes."
            rows={3}
            className={`${filterInputClassName} mt-2 min-h-24`}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-500">
            Shown in smaller text directly under the banner.
          </span>
        </label>
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Discount value
            <input
              type="number"
              min="0"
              step="0.01"
              name="amount"
              required
              className={`${filterInputClassName} mt-2`}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Applies to
            <select name="appliesTo" defaultValue="all" className={`${filterInputClassName} mt-2`}>
              <option value="all">Both models</option>
              <option value="seven-pro-tethered">Seven Pro Tethered</option>
              <option value="seven-pro-untethered">Seven Pro Untethered</option>
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Runs from
            <input type="date" name="startsAt" className={`${filterInputClassName} mt-2`} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Runs to / expires
            <input type="date" name="expiresAt" className={`${filterInputClassName} mt-2`} />
          </label>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked
            className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
          />
          Enabled
        </label>
        <button
          type="submit"
          disabled={!isSuperAdmin}
          className="admin-action-button inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {kind === "VOUCHER" ? "Create voucher" : "Create offer"}
        </button>
      </form>
    </section>
  );
}

function formatDiscountAppliesTo(discount: ProductDiscount) {
  if (discount.appliesTo === "seven-pro-tethered") {
    return "Seven Pro Tethered";
  }

  if (discount.appliesTo === "seven-pro-untethered") {
    return "Seven Pro Untethered";
  }

  return "Both models";
}

function ProductDiscountCard({
  discount,
  isSuperAdmin,
}: {
  discount: ProductDiscount;
  isSuperAdmin: boolean;
}) {
  return (
    <article className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
              {discount.kind === "VOUCHER" ? "Voucher" : "Special offer"}
            </span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
              discount.enabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-500"
            }`}>
              {discount.enabled ? "Enabled" : "Paused"}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-bold tracking-[-0.03em] text-slate-950">
            {discount.label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {formatMoney(discount.amount)} off | {formatDiscountAppliesTo(discount)}
            {discount.code ? ` | Code: ${discount.code}` : ""}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {discount.startsAt ? `From ${formatPreferredInstallationDate(discount.startsAt)}` : "Starts immediately"}
            {" | "}
            {discount.expiresAt ? `Until ${formatPreferredInstallationDate(discount.expiresAt)}` : "No expiry"}
          </p>
          {discount.bannerContent ? (
            <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
              {discount.bannerContent}
            </p>
          ) : null}
          {discount.disclaimerContent ? (
            <p className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600">
              {discount.disclaimerContent}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/admin/product-settings" method="post">
            <input type="hidden" name="action" value="toggle-discount" />
            <input type="hidden" name="discountId" value={discount.id} />
            <input type="hidden" name="enabled" value={discount.enabled ? "" : "on"} />
            <button
              type="submit"
              disabled={!isSuperAdmin}
              className="admin-action-button inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {discount.enabled ? "Pause" : "Enable"}
            </button>
          </form>
          <form action="/api/admin/product-settings" method="post">
            <input type="hidden" name="action" value="delete-discount" />
            <input type="hidden" name="discountId" value={discount.id} />
            <button
              type="submit"
              disabled={!isSuperAdmin}
              className="admin-action-button inline-flex min-h-11 items-center justify-center rounded-full border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
          </form>
        </div>
      </div>
      <details className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-950">
          Edit {discount.kind === "VOUCHER" ? "voucher" : "discount"}
        </summary>
        <form action="/api/admin/product-settings" method="post" className="mt-4 grid gap-4">
          <input type="hidden" name="action" value="update-discount" />
          <input type="hidden" name="discountId" value={discount.id} />
          <input type="hidden" name="kind" value={discount.kind} />
          <label className="block text-sm font-medium text-slate-700">
            Label
            <input
              type="text"
              name="label"
              defaultValue={discount.label}
              required
              className={`${filterInputClassName} mt-2`}
            />
          </label>
          {discount.kind === "VOUCHER" ? (
            <label className="block text-sm font-medium text-slate-700">
              Code
              <input
                type="text"
                name="code"
                defaultValue={discount.code}
                required
                className={`${filterInputClassName} mt-2 uppercase`}
              />
            </label>
          ) : null}
          {discount.kind === "SPECIAL_OFFER" ? (
            <>
          <label className="block text-sm font-medium text-slate-700">
            Banner content
            <textarea
              name="bannerContent"
              defaultValue={discount.bannerContent ?? ""}
              rows={3}
              className={`${filterInputClassName} mt-2 min-h-24`}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Disclaimer text
            <textarea
              name="disclaimerContent"
              defaultValue={discount.disclaimerContent ?? ""}
              rows={3}
              className={`${filterInputClassName} mt-2 min-h-24`}
            />
          </label>
            </>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Discount value
              <input
                type="number"
                min="0"
                step="0.01"
                name="amount"
                defaultValue={discount.amount}
                required
                className={`${filterInputClassName} mt-2`}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Applies to
              <select name="appliesTo" defaultValue={discount.appliesTo} className={`${filterInputClassName} mt-2`}>
                <option value="all">Both models</option>
                <option value="seven-pro-tethered">Seven Pro Tethered</option>
                <option value="seven-pro-untethered">Seven Pro Untethered</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Runs from
              <input type="date" name="startsAt" defaultValue={discount.startsAt ?? ""} className={`${filterInputClassName} mt-2`} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Runs to / expires
              <input type="date" name="expiresAt" defaultValue={discount.expiresAt ?? ""} className={`${filterInputClassName} mt-2`} />
            </label>
          </div>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={discount.enabled}
              className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
            />
            Enabled
          </label>
          <button
            type="submit"
            disabled={!isSuperAdmin}
            className="admin-action-button inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save changes
          </button>
        </form>
      </details>
    </article>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  return (
    <tr>
      <td className="border-b border-slate-100 px-4 py-3 align-top">
        {formatTimestamp(event.createdAt)}
      </td>
      <td className="border-b border-slate-100 px-4 py-3 align-top">
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
          {event.action}
        </span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 align-top">{event.actor}</td>
      <td className="border-b border-slate-100 px-4 py-3 align-top">
        <div className="max-w-[620px] text-sm leading-6 text-slate-600">
          {event.detail}
          {event.paymentId ? (
            <div className="mt-1 text-xs text-slate-500">Payment ID: {event.paymentId}</div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function SnapshotBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "positive" | "attention" | "danger";
}) {
  const toneClassName = {
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
    positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
    attention: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];

  return (
    <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${toneClassName}`}>
      {children}
    </span>
  );
}

function SnapshotStatus({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "positive" | "attention" | "danger";
}) {
  const dotClassName = {
    neutral: "bg-slate-400",
    positive: "bg-emerald-500",
    attention: "bg-amber-500",
    danger: "bg-rose-500",
  }[tone];

  return (
    <p className="flex items-start gap-2 text-xs font-semibold leading-5 text-slate-800">
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dotClassName}`} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function MobileTableLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#008fb5] xl:hidden">
      {children}
    </p>
  );
}

function SortableOrderHeading({
  label,
  sortKey,
  currentSortKey,
  direction,
  params,
  edge,
}: {
  label: string;
  sortKey: OrderSortKey;
  currentSortKey: OrderSortKey;
  direction: SortDirection;
  params: SearchParamRecord;
  edge?: "left" | "right";
}) {
  const active = currentSortKey === sortKey;
  const nextDirection = active
    ? direction === "asc" ? "desc" : "asc"
    : sortKey === "ordered" || sortKey === "amount" ? "desc" : "asc";
  const ariaSort = active
    ? direction === "asc" ? "ascending" : "descending"
    : "none";

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`sticky top-0 z-10 bg-slate-950 px-4 py-3 ${edge === "left" ? "rounded-l-2xl" : ""} ${edge === "right" ? "rounded-r-2xl" : ""}`}
    >
      <Link
        href={buildBackofficeHref(params, {
          tab: "orders",
          orderSortBy: sortKey,
          orderSort: nextDirection,
          orderPage: null,
          viewState: null,
          viewError: null,
        })}
        className="group inline-flex w-full items-center justify-between gap-2 py-1 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-white"
        title={`Sort by ${label.toLowerCase()} ${nextDirection === "asc" ? "ascending" : "descending"}`}
      >
        <span>{label}</span>
        <span className={`text-sm ${active ? "text-[#00eaff]" : "text-slate-500 group-hover:text-white"}`} aria-hidden="true">
          {active ? direction === "asc" ? "↑" : "↓" : "↕"}
        </span>
      </Link>
    </th>
  );
}

function AllOrdersTable({
  entries,
  params,
  sortBy,
  sortDirection,
}: {
  entries: AllOrdersEntry[];
  params: SearchParamRecord;
  sortBy: OrderSortKey;
  sortDirection: SortDirection;
}) {
  return (
    <table className="mt-6 block w-full border-separate border-spacing-0 lg:table lg:table-fixed">
      <caption className="sr-only">Paid customer orders with current stage, urgent next step, and action</caption>
      <colgroup className="hidden lg:table-column-group">
        <col className="w-[32%]" />
        <col className="w-[14%]" />
        <col className="w-[19%]" />
        <col className="w-[25%]" />
        <col className="w-[10%]" />
      </colgroup>
      <thead className="hidden lg:table-header-group">
        <tr className="bg-slate-950 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          <SortableOrderHeading label="Customer and order" sortKey="customer" currentSortKey={sortBy} direction={sortDirection} params={params} edge="left" />
          <SortableOrderHeading label="Amount" sortKey="amount" currentSortKey={sortBy} direction={sortDirection} params={params} />
          <SortableOrderHeading label="Stage" sortKey="stage" currentSortKey={sortBy} direction={sortDirection} params={params} />
          <th scope="col" className="sticky top-0 z-10 bg-slate-950 px-4 py-3">What needs attention</th>
          <th scope="col" className="sticky top-0 z-10 rounded-r-2xl bg-slate-950 px-4 py-3 text-right">Action</th>
        </tr>
      </thead>
      <tbody className="block space-y-3 lg:table-row-group lg:space-y-0">
        {entries.map((entry) => {
          if (entry.kind === "stalled") {
            return null;
          }

          const { workflow, payment } = entry;
          const stage = getAllOrdersStage(workflow);
          const provider = payment?.provider ?? workflow.provider;
          const sla = getOrderSla(entry);
          const stageLabel = workflow.refundStatus === "COMPLETED" ? "Refunded" : {
            "awaiting-survey": "Awaiting survey",
            review: "Survey for review",
            ready: "Ready for booking",
            booked: "Booked",
            installed: "Installed",
            declined: "Declined",
          }[stage];
          const stageTone = stage === "installed"
            ? "positive"
            : stage === "declined"
              ? "danger"
              : stage === "review" || stage === "ready"
                ? "attention"
                : "neutral";
          const actionLabel = stage === "review"
            ? "Review"
            : stage === "ready"
              ? "Assign"
              : "Open";
          const detailHref = getAllOrdersDetailHref(workflow, params);

          return (
            <tr
              key={workflow.id}
              className={`block rounded-[20px] border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] lg:table-row lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none ${
                sla.level === "overdue" ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"
              }`}
            >
              <td className={`block border-b border-slate-100 py-3 align-middle lg:table-cell lg:border-l-4 lg:px-4 ${sla.level === "overdue" ? "lg:border-l-rose-500" : sla.level === "attention" ? "lg:border-l-amber-400" : "lg:border-l-emerald-400"}`}>
                <MobileTableLabel>Customer and order</MobileTableLabel>
                <p className="text-sm font-bold text-slate-950">{workflow.customerName || "Customer not set"}</p>
                <Link
                  href={detailHref}
                  className="mt-1 inline-flex break-all text-xs font-semibold leading-5 text-[#006c88] underline decoration-[#00c7ef] underline-offset-4 transition hover:text-[#004b5f]"
                  title="Open this order's action tab"
                >
                  {workflow.sourcePaymentId}
                </Link>
                <p className="mt-1 truncate text-xs text-slate-500" title={workflow.customerEmail}>{workflow.customerEmail || workflow.customerPhone || "Contact details unavailable"}</p>
              </td>

              <td className="block border-b border-slate-100 py-3 align-middle lg:table-cell lg:px-4">
                <MobileTableLabel>Amount</MobileTableLabel>
                <p className="text-base font-bold text-slate-950">{formatMoney(getResolvedWorkflowAmount(workflow), payment?.currency)}</p>
                <p className="mt-1 text-xs text-slate-500">{provider === "FRASERS_PLUS" ? "Frasers Plus" : "Card"}</p>
              </td>

              <td className="block border-b border-slate-100 py-3 align-middle lg:table-cell lg:px-4">
                <MobileTableLabel>Stage</MobileTableLabel>
                <SnapshotBadge tone={stageTone}>{stageLabel}</SnapshotBadge>
                {workflow.jumptech?.currentStatusLabel || workflow.jumptech?.status ? (
                  <p className="mt-2 truncate text-xs text-slate-500" title={workflow.jumptech.currentStatusLabel || workflow.jumptech.status}>
                    Jumptech: {workflow.jumptech.currentStatusLabel || workflow.jumptech.status}
                  </p>
                ) : null}
              </td>

              <td className="block border-b border-slate-100 py-3 align-middle lg:table-cell lg:px-4">
                <MobileTableLabel>What needs attention</MobileTableLabel>
                <SnapshotStatus tone={sla.level === "overdue" ? "danger" : sla.level === "attention" ? "attention" : "positive"}>
                  {sla.level === "clear" ? sla.label : sla.detail}
                </SnapshotStatus>
              </td>

              <td className="block py-3 align-middle lg:table-cell lg:border-b lg:border-slate-100 lg:px-4 lg:text-right">
                <MobileTableLabel>Action</MobileTableLabel>
                <Link
                  href={detailHref}
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                  style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
                >
                  {actionLabel}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-12 min-w-fit items-center justify-center rounded-full border px-5 text-sm font-semibold transition ${
        active
          ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)]"
          : "border-slate-200 bg-white text-slate-900 hover:border-[#00c7ef] hover:text-[#008fb5]"
      }`}
      style={active ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}
      aria-current={active ? "page" : undefined}
    >
      <span
        className={`whitespace-nowrap leading-none ${active ? "text-white" : "text-current"}`}
        style={active ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}
      >
        {label}
      </span>
    </Link>
  );
}

function QuickViewLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
        active
          ? "border-[#006c88] bg-[#006c88] text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-[#008fb5] hover:text-[#006c88]"
      }`}
      style={active ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}
    >
      {label}
    </Link>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-sm leading-7 text-slate-600">
      {message}
    </div>
  );
}

function PaginationControls({
  label,
  pagination,
  params,
}: {
  label: string;
  pagination: PaginationState;
  params: SearchParamRecord;
}) {
  if (pagination.totalItems <= pagination.pageSize) {
    return null;
  }

  const pages = getPaginationPages(pagination.currentPage, pagination.totalPages);
  const previousPage = Math.max(1, pagination.currentPage - 1);
  const nextPage = Math.min(pagination.totalPages, pagination.currentPage + 1);

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-slate-600">
        Showing {pagination.startIndex + 1}-{pagination.endIndex} of {pagination.totalItems} {label}
      </p>
      <nav className="flex flex-wrap items-center gap-2" aria-label={`${label} pagination`}>
        {pagination.currentPage === 1 ? (
          <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-300">
            Previous
          </span>
        ) : (
          <Link
            href={buildPaginationHref(params, pagination, previousPage)}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
          >
            Previous
          </Link>
        )}

        {pages.map((page, index) => (
          <span key={page} className="flex items-center gap-2">
            {index > 0 && page - pages[index - 1] > 1 ? (
              <span className="px-1 text-sm font-semibold text-slate-400">...</span>
            ) : null}
            {page === pagination.currentPage ? (
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                {page}
              </span>
            ) : (
              <Link
                href={buildPaginationHref(params, pagination, page)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              >
                {page}
              </Link>
            )}
          </span>
        ))}

        {pagination.currentPage === pagination.totalPages ? (
          <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-300">
            Next
          </span>
        ) : (
          <Link
            href={buildPaginationHref(params, pagination, nextPage)}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
          >
            Next
          </Link>
        )}
      </nav>
    </div>
  );
}

function ChartCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00738a]">{title}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function BarList({
  items,
  emptyMessage,
}: {
  items: Array<{ label: string; value: number }>;
  emptyMessage: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  if (!items.some((item) => item.value > 0)) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <div key={item.label} className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-slate-900">{item.label}</span>
            <span className="text-sm text-slate-500">
              {item.value} | {percentage(item.value, total)}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#00eaff_0%,#00c7ef_100%)]"
              style={{ width: `${maxValue ? (item.value / maxValue) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderMix({
  items,
  emptyMessage,
}: {
  items: Array<{ label: string; value: number; detail: string }>;
  emptyMessage: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  if (!items.some((item) => item.value > 0)) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">{item.label}</p>
              <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
            </div>
            <strong className="text-xl font-bold tracking-[-0.03em] text-slate-950">
              {item.value}
            </strong>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#00eaff_0%,#00c7ef_100%)]"
              style={{ width: `${maxValue ? (item.value / maxValue) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyTrendChart({
  points,
  emptyMessage,
}: {
  points: Array<{ day: string; started: number; details: number; converted: number }>;
  emptyMessage: string;
}) {
  const maxValue = Math.max(
    ...points.flatMap((point) => [point.started, point.details, point.converted]),
    0,
  );

  if (!points.length || maxValue === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 md:grid-cols-7">
        {points.map((point) => (
          <div key={point.day} className="rounded-[22px] border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {formatDateLabel(point.day)}
            </p>
            <div className="mt-4 flex min-h-[150px] items-end justify-center gap-2">
              {[
                { value: point.started, color: "bg-slate-300", label: "Started" },
                { value: point.details, color: "bg-[#7fefff]", label: "Details" },
                { value: point.converted, color: "bg-[#00c7ef]", label: "Converted" },
              ].map((bar) => (
                <div key={bar.label} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-5 rounded-t-full ${bar.color}`}
                    style={{ height: `${maxValue ? Math.max((bar.value / maxValue) * 110, bar.value > 0 ? 10 : 0) : 0}px` }}
                    title={`${bar.label}: ${bar.value}`}
                  />
                  <span className="text-[11px] font-semibold text-slate-500">{bar.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-slate-300" />
          Started
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#7fefff]" />
          Details submitted
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#00c7ef]" />
          Converted
        </span>
      </div>
    </div>
  );
}

function BootstrapAdminCard({ username }: { username: string }) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          Super admin
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          Env managed
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          MFA required
        </span>
      </div>
      <h3 className="mt-4 text-xl font-bold tracking-[-0.04em] text-slate-950">{username}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        This env-backed account remains the super admin. It can manage team access while managed admin users can continue to work across the rest of back office.
      </p>
    </article>
  );
}

function ManagedAdminUserCard({
  user,
  highlighted = false,
  returnTo,
  editable,
}: {
  user: ManagedAdminUser;
  highlighted?: boolean;
  returnTo: string;
  editable: boolean;
}) {
  const otpSetupUri =
    user.mfaRequired && user.totpSecret
      ? buildManagedAdminOtpAuthUri(user.username, user.totpSecret)
      : "";

  return (
    <article
      id={`admin-user-${user.id}`}
      className={`rounded-[28px] border p-5 ${
        highlighted
          ? "border-[#00eaff] bg-[#f2fdff] shadow-[0_18px_40px_rgba(0,199,239,0.12)]"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          {user.role === "super-admin" ? "Super admin" : "Managed admin"}
        </span>
        {user.role === "super-admin" ? (
          <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-800">
            Can manage team access
          </span>
        ) : null}
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
            user.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {user.enabled ? "Enabled" : "Disabled"}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          {user.mfaRequired ? "MFA required" : "No MFA"}
        </span>
      </div>

      <h3 className="mt-4 text-xl font-bold tracking-[-0.04em] text-slate-950">{user.username}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        Created {formatTimestamp(user.createdAt)} by {user.createdBy}. Last updated {formatTimestamp(user.updatedAt)} by {user.updatedBy}.
      </p>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form
          action="/api/admin/users"
          method="post"
          className="rounded-[24px] border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="action" value="update-user" />
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Access settings
          </p>
          <div className="mt-4 grid gap-3">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={user.enabled}
                disabled={!editable}
                className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
              />
              Allow this user to sign in
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
              <input
                type="checkbox"
                name="mfaRequired"
                defaultChecked={user.mfaRequired}
                disabled={!editable}
                className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
              />
              Require authenticator code
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-slate-900">
              <input
                type="checkbox"
                name="role"
                value="super-admin"
                defaultChecked={user.role === "super-admin"}
                disabled={!editable}
                className="h-4 w-4 rounded border-slate-300 text-[#00c7ef] focus:ring-[#00c7ef]"
              />
              Super admin access
            </label>
          </div>
          <button
            type="submit"
            disabled={!editable}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save access settings
          </button>
        </form>

        <div className="grid gap-4">
          <form
            action="/api/admin/users"
            method="post"
            className="rounded-[24px] border border-slate-200 bg-white p-4"
          >
            <input type="hidden" name="action" value="reset-password" />
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Reset password
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              New password
              <input
                type="password"
                name="password"
                minLength={10}
                required
                disabled={!editable}
                className={`${filterInputClassName} mt-2 disabled:cursor-not-allowed disabled:bg-slate-100`}
              />
            </label>
            <button
              type="submit"
              disabled={!editable}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save new password
            </button>
          </form>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Authenticator setup
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {user.mfaRequired
                    ? "Use the secret or URI below to enrol this user in an authenticator app."
                    : "MFA is disabled for this account. Enabling it will generate a new setup secret."}
                </p>
              </div>
              <form action="/api/admin/users" method="post">
                <input type="hidden" name="action" value="rotate-mfa" />
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  disabled={!editable}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {user.mfaRequired ? "Rotate authenticator secret" : "Enable MFA and create secret"}
                </button>
              </form>
            </div>

            {user.mfaRequired && user.totpSecret ? (
              <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-700">
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Base32 secret
                  </p>
                  <p className="mt-2 break-all font-semibold text-slate-950">{user.totpSecret}</p>
                </div>
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Authenticator URI
                  </p>
                  <p className="mt-2 break-all text-slate-700">{otpSetupUri}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function StatCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00738a]">{label}</p>
      <strong className="mt-3 block text-3xl font-bold tracking-[-0.04em] text-slate-950">
        {value}
      </strong>
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
    </>
  );
  const className = "block rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]";

  return href ? (
    <Link href={href} className={`${className} transition hover:-translate-y-0.5 hover:border-[#008fb5] hover:shadow-[0_22px_45px_rgba(15,23,42,0.09)]`}>
      {content}
    </Link>
  ) : (
    <div className={className}>
      {content}
    </div>
  );
}

function FlatField({
  label,
  value,
  breakWord = false,
}: {
  label: string;
  value: string;
  breakWord?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-sm font-semibold text-slate-950 ${breakWord ? "break-all" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}

function DetailCard({
  label,
  value,
  breakWord = false,
}: {
  label: string;
  value: string;
  breakWord?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <strong className={`mt-3 block text-sm font-semibold text-slate-950 ${breakWord ? "break-all" : ""}`}>
        {value}
      </strong>
    </div>
  );
}
