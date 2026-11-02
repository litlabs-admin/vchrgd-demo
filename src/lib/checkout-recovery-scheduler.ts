import {
  getCheckoutInteractionEffectiveStatus,
  hasSubmittedCheckoutDetails,
  listCheckoutInteractions,
  markCheckoutRecoveryEmailSent,
  type CheckoutInteraction,
} from "@/lib/checkout-interactions";
import { renderCheckoutRecoveryEmail, type CheckoutRecoveryEmailStage } from "@/lib/checkout-recovery-email";
import { createCheckoutRecoveryToken } from "@/lib/checkout-recovery-token";
import { isGmailSenderConfigured, sendGmailMessage } from "@/lib/gmail-sender";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { getCustomerAppUrl } from "@/lib/app-url";

const DEFAULT_ACTIVE_FROM = "2026-07-22T00:00:00+01:00";
const DAY_MS = 24 * 60 * 60 * 1000;

type RecoveryCandidate = {
  interaction: CheckoutInteraction;
  stage: CheckoutRecoveryEmailStage;
};

function clean(value: string | null | undefined) {
  return value?.trim() || "";
}

function isEnabled() {
  return process.env.CHECKOUT_RECOVERY_EMAILS_ENABLED === "true";
}

function getActiveFromMs() {
  const configured = process.env.CHECKOUT_RECOVERY_ACTIVE_FROM || DEFAULT_ACTIVE_FROM;
  const parsed = new Date(configured).getTime();
  return Number.isFinite(parsed) ? parsed : new Date(DEFAULT_ACTIVE_FROM).getTime();
}

function formatCurrency(amount: number | undefined) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(typeof amount === "number" ? amount : 0);
}

function formatExpiryLabel(detailsSubmittedAt: string | null | undefined) {
  const baseTime = detailsSubmittedAt ? new Date(detailsSubmittedAt).getTime() : Date.now();
  const expiry = new Date(baseTime + 5 * DAY_MS);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(expiry);
}

function isPaid(interaction: CheckoutInteraction) {
  return (
    interaction.status === "PAYMENT_COMPLETED" ||
    getCheckoutInteractionEffectiveStatus(interaction) === "PAYMENT_COMPLETED"
  );
}

function isEligibleInteraction(interaction: CheckoutInteraction, nowMs: number) {
  if (!hasSubmittedCheckoutDetails(interaction) || isPaid(interaction)) {
    return false;
  }

  if (!clean(interaction.customerEmail)) {
    return false;
  }

  const detailsSubmittedMs = interaction.detailsSubmittedAt
    ? new Date(interaction.detailsSubmittedAt).getTime()
    : NaN;
  if (!Number.isFinite(detailsSubmittedMs) || detailsSubmittedMs < getActiveFromMs()) {
    return false;
  }

  const ageMs = nowMs - detailsSubmittedMs;
  return ageMs >= DAY_MS && ageMs < 5 * DAY_MS;
}

function getDueStage(interaction: CheckoutInteraction, nowMs: number): CheckoutRecoveryEmailStage | null {
  const detailsSubmittedMs = interaction.detailsSubmittedAt
    ? new Date(interaction.detailsSubmittedAt).getTime()
    : NaN;
  if (!Number.isFinite(detailsSubmittedMs)) {
    return null;
  }

  const ageMs = nowMs - detailsSubmittedMs;
  if (ageMs >= 3 * DAY_MS && !interaction.recoveryEmails?.sent72hAt) {
    return "72h";
  }

  if (ageMs >= DAY_MS && !interaction.recoveryEmails?.sent24hAt) {
    return "24h";
  }

  return null;
}

function buildEmailForInteraction(
  interaction: CheckoutInteraction,
  stage: CheckoutRecoveryEmailStage,
  requestUrl: string,
) {
  const firstName = clean(interaction.customerFirstName) || "there";
  const customerName =
    [interaction.customerFirstName, interaction.customerLastName].filter(Boolean).join(" ") ||
    "VCHRGD customer";
  const customerAppUrl = getCustomerAppUrl(requestUrl);
  const recoveryLink = `${customerAppUrl}/checkout/recover/${createCheckoutRecoveryToken(
    interaction.paymentId,
  )}`;

  return renderCheckoutRecoveryEmail({
    stage,
    firstName,
    customerName,
    chargerName: clean(interaction.chargerName) || "VCHRGD home charger",
    totalAmount: formatCurrency(interaction.total),
    postcode: clean(interaction.billingPostalCode) || "-",
    orderReference: interaction.paymentId,
    recoveryLink,
    expiresAtLabel: formatExpiryLabel(interaction.detailsSubmittedAt),
    brandLogoUrl: `${customerAppUrl}/content/vchrgd-email-logo.png`,
  });
}

export async function sendDueCheckoutRecoveryEmails({
  requestUrl,
  oidcToken,
  limit = 20,
}: {
  requestUrl: string;
  oidcToken?: string | null;
  limit?: number;
}) {
  if (!isEnabled()) {
    return { sent: 0, skipped: 0, disabled: true };
  }

  if (!isGmailSenderConfigured()) {
    throw new Error("Gmail sender configuration is incomplete.");
  }

  const nowMs = Date.now();
  const candidates: RecoveryCandidate[] = (await listCheckoutInteractions())
    .filter((interaction) => isEligibleInteraction(interaction, nowMs))
    .map((interaction) => ({ interaction, stage: getDueStage(interaction, nowMs) }))
    .filter((candidate): candidate is RecoveryCandidate => Boolean(candidate.stage))
    .slice(0, limit);

  let sent = 0;
  for (const { interaction, stage } of candidates) {
    const email = buildEmailForInteraction(interaction, stage, requestUrl);
    const result = await sendGmailMessage({
      to: clean(interaction.customerEmail),
      subject: email.subject,
      html: email.html,
      text: email.text,
      oidcToken,
    });

    await markCheckoutRecoveryEmailSent(
      interaction.paymentId,
      stage,
      `Gmail message ${result.id || "unknown"} sent to ${interaction.customerEmail}.`,
    );
    await recordAdminAuditEvent({
      action: "checkout_recovery.email_sent",
      actor: "system",
      detail: `${stage} checkout recovery email sent for ${interaction.paymentId} to ${interaction.customerEmail}.`,
    });
    sent += 1;
  }

  return { sent, skipped: Math.max(0, candidates.length - sent), disabled: false };
}
