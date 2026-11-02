import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { tryReserveDedupeKey, releaseDedupeKey } from "@/lib/server-data";
import {
  parseJumptechWebhookEvent,
  verifyJumptechWebhookSignature,
} from "@/lib/jumptech";
import {
  isQuoteApprovedJumptechStatus,
  sendAdditionalCostsEmailForWorkflow,
} from "@/lib/additional-costs-email-sender";
import { sendUniqueGoogleChatNotification } from "@/lib/google-chat-notifications";
import {
  buildSurveyReviewUrl,
  recordJumptechProjectUpdate,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";
import { syncJumptechProjectDetails } from "@/lib/workflow-sync";

const FOLLOW_UP_SYNC_DELAYS_MS = [60_000];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseStatus(value?: string) {
  return `${value || ""}`.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function isSurveyReceivedStatus(status?: string, currentStatusLabel?: string) {
  const normalised = normaliseStatus(status || currentStatusLabel);
  return (
    (normalised.includes("SURVEY") &&
      (normalised.includes("RECEIVED") ||
        normalised.includes("SUBMITTED") ||
        normalised.includes("COMPLETE") ||
        normalised.includes("COMPLETED"))) ||
    (normalised.includes("QUESTIONNAIRE") &&
      (normalised.includes("SUBMITTED") ||
        normalised.includes("COMPLETE") ||
        normalised.includes("COMPLETED"))) ||
    normalised === "IN_REVIEW"
  );
}

function isNoisyJumptechStatus(status?: string, currentStatusLabel?: string) {
  const normalised = normaliseStatus(status || currentStatusLabel);
  return (
    normalised === "CREATED" ||
    normalised === "ARCHIVED" ||
    normalised === "PENDING_APPLICATION"
  );
}

function hasActionableAdditionalCosts(cost?: number, detail?: string) {
  if (cost !== undefined && cost > 0) {
    return true;
  }

  const normalisedDetail = detail?.trim();
  return Boolean(normalisedDetail && !/^additional installation costs:\s*£?0(?:\.00)?$/i.test(normalisedDetail));
}

function shouldSendGenericJumptechNotification({
  status,
  currentStatusLabel,
  additionalInstallationCosts,
  additionalInstallationCostDetail,
}: {
  status?: string;
  currentStatusLabel?: string;
  additionalInstallationCosts?: number;
  additionalInstallationCostDetail?: string;
}) {
  if (isNoisyJumptechStatus(status, currentStatusLabel)) {
    return false;
  }

  return hasActionableAdditionalCosts(additionalInstallationCosts, additionalInstallationCostDetail);
}

function formatCustomerLine(workflow?: SurveyWorkflow | null) {
  const parts = [
    workflow?.customerName,
    workflow?.customerEmail,
    workflow?.customerPhone,
  ].filter(Boolean);

  return parts.length ? `Customer: ${parts.join(" | ")}` : null;
}

function buildSurveyReceivedMessage({
  workflow,
  projectId,
  request,
  status,
  detail,
}: {
  workflow?: SurveyWorkflow | null;
  projectId: string;
  request: Request;
  status?: string;
  detail?: string;
}) {
  const address = workflow?.deliveryAddress ?? workflow?.billingAddress;
  const customerLink = workflow?.reviewToken
    ? buildSurveyReviewUrl(new URL(request.url).origin, workflow.reviewToken)
    : null;

  return [
    "Survey received",
    formatCustomerLine(workflow),
    workflow?.sourcePaymentId ? `Order reference: ${workflow.sourcePaymentId}` : null,
    workflow?.chargerName ? `Product: ${workflow.chargerName}` : null,
    address
      ? `Address: ${[
          address.line1,
          address.line2,
          address.city,
          address.postalCode,
        ]
          .filter(Boolean)
          .join(", ")}`
      : null,
    status ? `Jumptech status: ${status}` : null,
    detail ? `Detail: ${detail}` : null,
    customerLink ? `Customer link: ${customerLink}` : null,
    `Jumptech project: ${projectId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function scheduleJumptechFollowUpSync(projectId: string) {
  after(async () => {
    try {
      await syncJumptechProjectDetails(projectId, "jumptech-webhook-immediate-sync");

      for (const delayMs of FOLLOW_UP_SYNC_DELAYS_MS) {
        await wait(delayMs);
        await syncJumptechProjectDetails(projectId, `jumptech-webhook-follow-up-${delayMs}`);
      }
    } catch (error) {
      console.error("Jumptech follow-up sync failed", {
        projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  });
}

function scheduleAdditionalCostsEmail(
  workflow: SurveyWorkflow | null,
  requestUrl: string,
  status?: string,
  currentStatusLabel?: string,
) {
  if (!workflow || !isQuoteApprovedJumptechStatus(status, currentStatusLabel)) {
    return;
  }

  after(async () => {
    try {
      await sendAdditionalCostsEmailForWorkflow({ workflow, requestUrl });
    } catch (error) {
      console.error("Automatic additional costs email failed", {
        orderReference: workflow.sourcePaymentId,
        projectId: workflow.jumptech?.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  });
}

export async function POST(request: Request) {
  const rawPayload = await request.text();
  const signature = request.headers.get("x-jt-sig-256") ?? "";
  const signatureTime = request.headers.get("x-jt-sig-time") ?? "";
  const subscriptionType = request.headers.get("x-jt-subscription-type") ?? "STATUS";

  if (!verifyJumptechWebhookSignature(rawPayload, signature, signatureTime)) {
    return NextResponse.json({ error: "Jumptech webhook verification failed." }, { status: 400 });
  }

  let replayKey: string | undefined;
  try {
    const payload = JSON.parse(rawPayload) as unknown;
    const event = parseJumptechWebhookEvent(payload, subscriptionType);

    if (!event?.projectId) {
      return NextResponse.json({ received: true });
    }

    const key = createHash("sha256").update(`${signatureTime}:${rawPayload}`).digest("hex");
    if (!await tryReserveDedupeKey("jumptech-signed-request", key)) return NextResponse.json({ received: true, duplicate: true });
    replayKey = key;

    const workflow = await recordJumptechProjectUpdate(event.projectId, "jumptech", {
      integrationId: event.integrationId,
      applicationId: event.applicationId,
      projectType: event.projectType,
      status: event.status,
      currentStatusLabel: event.currentStatusLabel,
      currentStatusDetail: event.currentStatusDetail,
      externalOwnerId: event.externalOwnerId,
      jobs: event.jobs,
      completedAt: event.completedAt,
      quoteTotal: event.quoteTotal,
      additionalInstallationCosts: event.additionalInstallationCosts,
      additionalInstallationCostDetail: event.additionalInstallationCostDetail,
      lastWebhookAt: event.receivedAt,
      lastSyncedAt: event.receivedAt,
    });
    scheduleAdditionalCostsEmail(
      workflow,
      request.url,
      event.status,
      event.currentStatusLabel,
    );
    scheduleJumptechFollowUpSync(event.projectId);

    if (workflow && isSurveyReceivedStatus(event.status, event.currentStatusLabel)) {
      await sendUniqueGoogleChatNotification(
        ["jumptech-survey-received", event.projectId].join(":"),
        buildSurveyReceivedMessage({
          workflow,
          projectId: event.projectId,
          request,
          status: event.currentStatusLabel || event.status,
          detail: event.currentStatusDetail,
        }),
      );
    } else if (
      workflow &&
      shouldSendGenericJumptechNotification({
        status: event.status,
        currentStatusLabel: event.currentStatusLabel,
        additionalInstallationCosts: event.additionalInstallationCosts,
        additionalInstallationCostDetail: event.additionalInstallationCostDetail,
      })
    ) {
      await sendUniqueGoogleChatNotification(
        [
          "jumptech",
          event.projectId,
          event.status || "",
          event.currentStatusLabel || "",
          event.currentStatusDetail || "",
          event.additionalInstallationCosts?.toFixed(2) || "",
          event.additionalInstallationCostDetail || "",
        ].join(":"),
        [
          "Jumptech project update",
          workflow?.customerName ? `Customer: ${workflow.customerName}` : null,
          workflow?.sourcePaymentId ? `Order reference: ${workflow.sourcePaymentId}` : null,
          `Project: ${event.projectId}`,
          `Status: ${event.currentStatusLabel || event.status || "Updated"}`,
          event.currentStatusDetail ? `Detail: ${event.currentStatusDetail}` : null,
          event.additionalInstallationCosts !== undefined
            ? `Additional installation costs: £${event.additionalInstallationCosts.toFixed(2)}`
            : null,
          event.additionalInstallationCostDetail
            ? `Additional cost detail: ${event.additionalInstallationCostDetail}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    return NextResponse.json({ received: true, projectId: event.projectId });
  } catch (error) {
    if (replayKey) await releaseDedupeKey("jumptech-signed-request", replayKey);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to process Jumptech webhook.",
      },
      { status: 400 },
    );
  }
}
