import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getAdditionalCostsEmailIneligibilityReason,
  sendAdditionalCostsEmailForWorkflow,
} from "@/lib/additional-costs-email-sender";
import {
  getPostSurveyWorkflowByPaymentId,
  getOutstandingWorkflowBalance,
  listPostSurveyWorkflows,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const accepted = [
    process.env.ADDITIONAL_COSTS_EMAIL_ADMIN_TOKEN,
    process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value?.trim()));

  return Boolean(supplied && accepted.some((value) => safeEqual(supplied, value.trim())));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function findWorkflow(input: { paymentId?: string; customerQuery?: string }) {
  const paymentId = clean(input.paymentId);
  if (paymentId) {
    return await getPostSurveyWorkflowByPaymentId(paymentId);
  }

  const customerQuery = clean(input.customerQuery).toLowerCase();
  if (customerQuery.length < 3) {
    return null;
  }

  return (await listPostSurveyWorkflows())
    .filter(
      (workflow) =>
        workflow.customerName?.toLowerCase().includes(customerQuery) ||
        workflow.customerEmail?.toLowerCase().includes(customerQuery),
    )
    .filter((workflow) => !getAdditionalCostsEmailIneligibilityReason(workflow))[0];
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { paymentId?: string; customerQuery?: string; recovery?: boolean; dryRun?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (body.recovery === true && !clean(body.paymentId)) {
    return NextResponse.json({ error: "A recovery send requires an exact paymentId." }, { status: 400 });
  }

  const workflow = await findWorkflow(body);
  if (!workflow) {
    return NextResponse.json(
      { error: "No eligible quote-approved order matched the request." },
      { status: 404 },
    );
  }

  try {
    if (body.dryRun === true) {
      const reason = getAdditionalCostsEmailIneligibilityReason(workflow, {
        allowProgressedOrder: body.recovery === true,
      });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        eligible: !reason,
        reason,
        orderReference: workflow.sourcePaymentId,
        balance: getOutstandingWorkflowBalance(workflow),
        sentAt: workflow.additionalCostsEmailSentAt,
        messageId: workflow.additionalCostsEmailMessageId,
      });
    }

    const result = await sendAdditionalCostsEmailForWorkflow({
      workflow: workflow as SurveyWorkflow,
      requestUrl: request.url,
      oidcToken: request.headers.get("x-vercel-oidc-token"),
      allowProgressedOrder: body.recovery === true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to send additional costs email.",
      },
      { status: 500 },
    );
  }
}
