import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import {
  getPostSurveyWorkflowByToken,
  getPreferredInstallationWindowStart,
  normalisePreferredInstallationDateList,
  saveSurveyWorkflowPreferredInstallationDates,
} from "@/lib/post-survey-workflows";
import { isSameOriginRequest } from "@/lib/request-guards";
import { preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const rawDates = Array.isArray(body?.dates)
    ? body.dates.filter((value: unknown): value is string => typeof value === "string")
    : [];

  if (!token) {
    return NextResponse.json({ error: "Missing workflow token." }, { status: 400 });
  }

  const workflow = await getPostSurveyWorkflowByToken(token);
  if (!workflow) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (!preferredDatesEnabledForWorkflow(workflow)) {
    return NextResponse.json(
      { error: "Your installation date will be arranged with the installation team." },
      { status: 409 },
    );
  }

  if (workflow.surveyStatus === "BOOKED_FOR_INSTALLATION" || workflow.surveyStatus === "INSTALLED") {
    return NextResponse.json(
      { error: "Installation is already booked. Preferred dates can no longer be changed." },
      { status: 409 },
    );
  }

  if (workflow.surveyStatus === "DECLINED") {
    return NextResponse.json(
      { error: "This order is no longer active." },
      { status: 409 },
    );
  }

  const dates = normalisePreferredInstallationDateList(rawDates);
  if (!dates.length || dates.length > 3) {
    return NextResponse.json(
      { error: "Select between one and three preferred dates." },
      { status: 400 },
    );
  }

  const minimumDate = getPreferredInstallationWindowStart(workflow);
  if (dates.some((value) => value < minimumDate)) {
    return NextResponse.json(
      { error: `Please choose dates on or after ${minimumDate}.` },
      { status: 400 },
    );
  }

  const updated = await saveSurveyWorkflowPreferredInstallationDates(
    workflow.id,
    "customer",
    dates,
  );

  await recordAdminAuditEvent({
    action: "customer.preferred_installation_dates.saved",
    actor: "customer",
    detail: `Preferred installation dates saved for workflow ${workflow.id}: ${dates.join(", ")}.`,
  });

  return NextResponse.json({
    ok: true,
    preferredInstallationDates: updated?.preferredInstallationDates ?? dates,
    preferredInstallationDatesUpdatedAt: updated?.preferredInstallationDatesUpdatedAt,
    minimumDate,
  });
}
