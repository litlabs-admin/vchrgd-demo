import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getCustomerAppUrl } from "@/lib/app-url";
import { listPaymentSessions, type PaymentSession } from "@/lib/frasers-plus-merchant-state";
import {
  getPostSurveyWorkflowById, isWorkflowBooked,
  listPostSurveyWorkflows, type SurveyWorkflow, type SurveyWorkflowStatus,
} from "@/lib/post-survey-workflows";
import { getDataStoreMode, readJsonFile, releaseDedupeKey, tryReserveDedupeKey, writeJsonFile } from "@/lib/server-data";
import { getSurveyStageEnteredAt, trackSurveyStage } from "@/lib/survey-stage-clock";

export const PREBOOKING_ALERT_AFTER_MS = 72 * 60 * 60 * 1000;
const BATCH_LIMIT = 20;
const DELIVERY_SCOPE = "prebooking-stage-alert-delivery-v1";
const STAGES: Partial<Record<SurveyWorkflowStatus, { label: string; action: string }>> = {
  AWAITING_SURVEY: { label: "Awaiting survey", action: "Contact the customer about their outstanding survey." },
  SURVEY_RECEIVED: { label: "Survey awaiting review", action: "Review the survey and confirm the next step." },
  REVIEW_READY: { label: "Awaiting customer review", action: "Follow up on the customer's review of the installation quote." },
  BALANCE_PENDING: { label: "Additional payment outstanding", action: "Check the balance and follow up with the customer." },
  READY_FOR_BOOKING: { label: "Ready for booking", action: "Contact the installer and arrange the installation date." },
};

type AlertReceipt = { text: string; preparedAt: string; requestId?: string; deliveryMode?: "webhook"; attemptedAt?: string; sentAt?: string; messageName?: string };
type AlertCandidate = { workflow: SurveyWorkflow; enteredAt: number; key: string };
type DeliveryFailure = { category: string; httpStatus?: number; apiStatus?: string; hint?: string };
class AlertDeliveryError extends Error {
  constructor(readonly diagnostic: DeliveryFailure, readonly retrySafe = false) {
    super(diagnostic.category);
  }
}

function safeDeliveryFailure(error: unknown): DeliveryFailure {
  if (error instanceof AlertDeliveryError) return error.diagnostic;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
    return { category: "timeout" };
  }
  return { category: "delivery_or_receipt_failure" };
}
type Observations = Record<string, NonNullable<SurveyWorkflow["stageClock"]>>;
const OBSERVATIONS_FILE = "prebooking-stage-observations.json";
const ACTIVATION_FILE = "prebooking-stage-alert-activation.json";

function cleanText(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[<>&*`_~\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function isConfirmedPaidPayment(payment: PaymentSession) {
  const status = payment.latestStatus?.status?.toUpperCase() || "";
  const type = payment.latestStatus?.currentType?.toUpperCase() || "";
  if (!["COMPLETED", "PAID", "CAPTURED"].includes(status)) return false;
  if (["CREDIT", "REFUND", "REVERSAL", "CANCELLATION", "AUTHORIZATION", "AUTHORISATION"].includes(type)) return false;
  // A completed Frasers authorisation is not settlement. Require the confirmed
  // CAPTURE recorded by the capture flow, rather than the approval webhook.
  return payment.provider !== "FRASERS_PLUS" || type === "CAPTURE";
}

function hasActiveOrderPayment(workflow: SurveyWorkflow, payments: Map<string, PaymentSession>) {
  // Top-ups alone must not make an abandoned checkout an operational order.
  const topUpIds = [workflow.topUpPaymentId, workflow.replacementPaymentId].filter(Boolean);
  return [workflow.sourcePaymentId, workflow.currentPaymentId]
    .filter((id): id is string => typeof id === "string" && !topUpIds.includes(id) && !/-(?:topup|balance)(?:-|$)/i.test(id))
    .some((id) => {
      const payment = payments.get(id);
      return Boolean(payment && isConfirmedPaidPayment(payment));
    });
}

function hasBookedOrClosedJumptechJob(workflow: SurveyWorkflow) {
  const normalise = (value?: string) => (value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const statuses = [workflow.jumptech?.status, workflow.jumptech?.currentStatusLabel];
  const closed = new Set(["BOOKED", "SCHEDULED", "INSTALLATION_BOOKED", "APPOINTMENT_SET",
    "INSTALLED", "COMPLETED", "CLOSED", "CANCELLED", "CANCELED", "ARCHIVED"]);
  return Boolean(workflow.jumptech?.completedAt) || statuses.some((status) => closed.has(normalise(status))) ||
    Boolean(workflow.jumptech?.jobs?.some((job) => job.scheduledFor || job.completedAt || closed.has(normalise(job.status))));
}

function isActivePrebookingOrder(workflow: SurveyWorkflow, payments: Map<string, PaymentSession>) {
  return !(!STAGES[workflow.surveyStatus] || workflow.archivedAt || isWorkflowBooked(workflow) ||
    workflow.customerDecision === "DECLINED" ||
    ["REQUESTED", "APPROVED", "COMPLETED"].includes(workflow.refundStatus) ||
    hasBookedOrClosedJumptechJob(workflow) || !hasActiveOrderPayment(workflow, payments));
}

function applyFirstObservation(workflow: SurveyWorkflow, observations: Observations, now: number) {
  trackSurveyStage(workflow, workflow.surveyStatus, new Date(now).toISOString());
  const clock = workflow.stageClock!;
  if (clock.source !== "first-observed") return;
  const previous = observations[workflow.id];
  if (previous?.status === clock.status && Number.isFinite(Date.parse(previous.enteredAt)) &&
    Date.parse(previous.enteredAt) <= Date.parse(clock.enteredAt)) {
    workflow.stageClock = previous;
  } else {
    observations[workflow.id] = clock;
  }
}

export function getPrebookingAlertCandidate(
  workflow: SurveyWorkflow, payments: Map<string, PaymentSession>, now: number, includeExisting = false,
  notBefore = 0,
): AlertCandidate | null {
  if (!isActivePrebookingOrder(workflow, payments)) return null;
  const recordedAt = getSurveyStageEnteredAt(workflow, includeExisting);
  if (recordedAt === null) return null;
  const enteredAt = includeExisting ? recordedAt : Math.max(recordedAt, notBefore);
  if (!Number.isFinite(now) || now - enteredAt < PREBOOKING_ALERT_AFTER_MS) return null;
  const key = createHash("sha256").update(JSON.stringify([
    process.env.APP_DATA_NAMESPACE || "", workflow.id, workflow.surveyStatus, workflow.stageClock?.enteredAt,
  ])).digest("hex");
  return { workflow, enteredAt, key };
}

export function buildPrebookingAlertMessage(candidate: AlertCandidate, now: number) {
  const { workflow, enteredAt } = candidate;
  const stage = STAGES[workflow.surveyStatus]!;
  const hours = Math.floor((now - enteredAt) / 3_600_000);
  const duration = `${Math.floor(hours / 24)} days${hours % 24 ? ` ${hours % 24} hours` : ""}`;
  const since = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(enteredAt));
  const origin = getCustomerAppUrl();
  const url = new URL("/backoffice", origin);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid back-office origin.");
  url.searchParams.set("tab", "orders");
  url.searchParams.set("focusOrder", workflow.id);
  return [
    "*ACTION REQUIRED: job unchanged for 72+ hours*",
    `*Customer:* ${cleanText(workflow.customerName, "Name not recorded")}`,
    `*Order:* ${cleanText(workflow.sourcePaymentId, workflow.id)}`,
    `*Stage:* ${stage.label}`,
    `*Time at stage:* ${duration} (since ${since}, UK time)`,
    `*Installer:* ${cleanText(workflow.installerName, "Not assigned")}`,
    `*Jumptech:* ${cleanText(workflow.jumptech?.currentStatusLabel || workflow.jumptech?.status, "Not linked")}`,
    `*Next action:* ${stage.action}`,
    `<${url.toString()}|Open this order in the back office>`,
    "One alert per unchanged stage. No customer message or payment action has been triggered.",
  ].join("\n");
}

async function deliverAlert(webhook: string, text: string, legacyRequestId?: string): Promise<{ messageName: string; deliveryMode: "webhook" }> {
  const url = new URL(webhook);
  if (url.protocol !== "https:" || url.hostname !== "chat.googleapis.com" ||
    !/^\/v1\/spaces\/[^/]+\/messages$/.test(url.pathname)) {
    throw new AlertDeliveryError({ category: "invalid_webhook_configuration" }, true);
  }
  // Incoming webhooks use the plain message API. Datastore reservations, not
  // the app-authentication requestId parameter, guard concurrent delivery.
  url.searchParams.delete("requestId");
  if (legacyRequestId) url.searchParams.set("requestId", legacyRequestId);
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }), cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const diagnostic: DeliveryFailure = { category: "google_chat_http_error", httpStatus: response.status };
    try {
      const body = await response.json() as { error?: { status?: string; message?: string } };
      const status = body.error?.status;
      if (status && ["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
        "RESOURCE_EXHAUSTED", "ALREADY_EXISTS", "UNAVAILABLE", "INTERNAL"].includes(status)) diagnostic.apiStatus = status;
      // Classify the error without logging the response, message text or webhook URL.
      const message = body.error?.message || "";
      if (/request.?id|uuid/i.test(message)) {
        diagnostic.hint = /unsupported|not supported|not allowed|must not/i.test(message) ? "request_id_unsupported" : "request_id";
      }
    } catch { /* The HTTP status is sufficient if the error body is not JSON. */ }
    // Only a confirmed rejection allows migration of an old pending receipt.
    if (legacyRequestId && response.status === 400 && diagnostic.hint?.startsWith("request_id")) {
      console.info("prebooking_stage_alert_legacy_id_rejected", JSON.stringify(diagnostic));
      await delay(1100);
      return deliverAlert(webhook, text);
    }
    throw new AlertDeliveryError(diagnostic, [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status));
  }
  const result = await response.json() as { name?: string };
  if (!result.name?.startsWith("spaces/")) throw new AlertDeliveryError({ category: "unconfirmed_delivery" });
  return { messageName: result.name, deliveryMode: "webhook" };
}

export async function sendDuePrebookingStageAlerts(options: { dryRun?: boolean; now?: number } = {}) {
  const stopStartingDeliveriesAt = Date.now() + 45_000;
  const result = { enabled: process.env.PREBOOKING_STAGE_ALERTS_ENABLED === "true", dryRun: Boolean(options.dryRun),
    checked: 0, due: 0, sent: 0, alreadySent: 0, skipped: 0, failed: 0, deferred: 0 };
  if (!result.enabled && !result.dryRun) return result;
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim();
  if (!result.dryRun && !webhook) throw new Error("Google Chat webhook is not configured.");
  const mode = getDataStoreMode();
  if (!result.dryRun && process.env.NODE_ENV === "production" &&
    (mode === "memory" || (process.env.VERCEL && mode === "file"))) {
    throw new Error("Stage alerts require a durable shared datastore in production.");
  }
  const now = options.now ?? Date.now();
  const includeExisting = process.env.PREBOOKING_STAGE_ALERTS_INCLUDE_EXISTING === "true";
  const activation = await readJsonFile<{ startedAt: string } | null>(ACTIVATION_FILE, null);
  const activationTime = Date.parse(activation?.startedAt || "");
  const startedAt = Number.isFinite(activationTime) ? activationTime : now;
  if (!result.dryRun && !Number.isFinite(activationTime)) {
    await writeJsonFile(ACTIVATION_FILE, { startedAt: new Date(startedAt).toISOString() });
  }
  const workflows = await listPostSurveyWorkflows();
  const observations = await readJsonFile<Observations>(OBSERVATIONS_FILE, {});
  const previousObservations = JSON.stringify(observations);
  const paymentMap = new Map((await listPaymentSessions()).map((payment) => [payment.paymentId, payment]));
  const candidates: AlertCandidate[] = [];
  for (const workflow of workflows) {
    if (!isActivePrebookingOrder(workflow, paymentMap)) continue;
    // Only mutate the read snapshot. The scheduled alert never writes order data.
    applyFirstObservation(workflow, observations, now);
    const candidate = getPrebookingAlertCandidate(workflow, paymentMap, now, includeExisting, startedAt);
    if (candidate) candidates.push(candidate);
  }
  if (!result.dryRun && JSON.stringify(observations) !== previousObservations) {
    await writeJsonFile(OBSERVATIONS_FILE, observations);
  }
  candidates.sort((a, b) => a.enteredAt - b.enteredAt);
  result.checked = workflows.length;
  result.due = candidates.length;
  let attempted = 0;
  for (const candidate of candidates) {
    const filename = `prebooking-stage-alert-${candidate.key}.json`;
    let receipt = await readJsonFile<AlertReceipt | null>(filename, null);
    if (receipt?.sentAt) { result.alreadySent++; continue; }
    if (result.dryRun) continue;
    if (attempted >= BATCH_LIMIT || Date.now() >= stopStartingDeliveriesAt) { result.deferred++; continue; }
    if (attempted) await delay(1100);
    // Stage or payment may have changed while earlier alerts were being delivered.
    const latest = await getPostSurveyWorkflowById(candidate.workflow.id);
    const freshPayments = new Map((await listPaymentSessions()).map((payment) => [payment.paymentId, payment]));
    if (latest) applyFirstObservation(latest, observations, now);
    const fresh = latest && getPrebookingAlertCandidate(latest, freshPayments, now, includeExisting, startedAt);
    if (!fresh || fresh.key !== candidate.key) { result.skipped++; continue; }
    if (!(await tryReserveDedupeKey(DELIVERY_SCOPE, candidate.key))) {
      const current = await readJsonFile<AlertReceipt | null>(filename, null);
      if (current?.sentAt) { result.alreadySent++; continue; }
      const attemptedAt = Date.parse(current?.attemptedAt || "");
      if (Number.isFinite(attemptedAt) && now - attemptedAt < 120_000) { result.deferred++; continue; }
      // A crash or lost response might follow a successful send. Never resend
      // an uncertain plain webhook automatically, and never report it as sent.
      console.error("prebooking_stage_alert_delivery_failed", JSON.stringify({ phase: "reservation", category: "unconfirmed_delivery_requires_review", alertKey: candidate.key }));
      result.failed++;
      continue;
    }
    attempted++;
    let phase = "prepare";
    try {
      receipt = await readJsonFile<AlertReceipt | null>(filename, null);
      if (receipt?.sentAt) { result.alreadySent++; continue; }
      receipt ??= { text: buildPrebookingAlertMessage(fresh, now), preparedAt: new Date(now).toISOString(), deliveryMode: "webhook" };
      receipt = { ...receipt, attemptedAt: new Date(now).toISOString() };
      await writeJsonFile(filename, receipt);
      phase = "delivery";
      const delivered = await deliverAlert(webhook!, receipt.text, receipt.deliveryMode === "webhook" ? undefined : receipt.requestId || candidate.key);
      phase = "receipt";
      await writeJsonFile(filename, { ...receipt, ...delivered, sentAt: new Date().toISOString() });
      result.sent++;
    } catch (error) {
      const retrySafe = phase === "prepare" || (phase === "delivery" && error instanceof AlertDeliveryError && error.retrySafe);
      if (retrySafe) await releaseDedupeKey(DELIVERY_SCOPE, candidate.key);
      console.error("prebooking_stage_alert_delivery_failed", JSON.stringify({ phase, ...safeDeliveryFailure(error), retrySafe, alertKey: candidate.key }));
      result.failed++;
      result.deferred = candidates.length - result.sent - result.alreadySent - result.skipped - result.failed;
      break;
    }
  }
  return result;
}
