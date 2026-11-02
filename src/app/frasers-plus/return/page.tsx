import { ReturnClient } from "./return-client";
import { preferredDatesEnabledForWorkflow } from "@/lib/preferred-installation-dates-policy";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getPostSurveyWorkflowByPaymentId,
  getPreferredInstallationWindowStart,
} from "@/lib/post-survey-workflows";
import {
  getPaymentSessionByPaymentId,
  getPaymentSessionByUpr,
} from "@/lib/frasers-plus-merchant-state";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import { syncWorkflowStateFromCurrentData } from "@/lib/workflow-sync";

const PENDING_RETURN_COOKIE = "vchrgd_fp_pending_return";

function readPendingReturnContext(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as {
      paymentId?: unknown;
      returnTo?: unknown;
      returnToken?: unknown;
    };

    const paymentId =
      typeof parsed.paymentId === "string" ? parsed.paymentId : "";
    const returnTo =
      typeof parsed.returnTo === "string" &&
      parsed.returnTo.startsWith("/") &&
      !parsed.returnTo.startsWith("//")
        ? parsed.returnTo
        : "";
    const returnToken =
      typeof parsed.returnToken === "string" ? parsed.returnToken : "";

    return paymentId && verifyFrasersPlusReturnToken(paymentId, returnToken)
      ? { paymentId, returnTo, returnToken }
      : null;
  } catch {
    return null;
  }
}

export default async function FrasersPlusReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const pendingReturn = readPendingReturnContext(
    cookieStore.get(PENDING_RETURN_COOKIE)?.value,
  );
  const uprFromQuery = typeof params.upr === "string" ? params.upr : "";
  const paymentId =
    (typeof params.paymentId === "string" ? params.paymentId : "") ||
    pendingReturn?.paymentId ||
    "";
  const returnToken =
    (typeof params.rt === "string" ? params.rt : "") ||
    pendingReturn?.returnToken ||
    "";
  const requestedReturnTo =
    typeof params.returnTo === "string" &&
    params.returnTo.startsWith("/") &&
    !params.returnTo.startsWith("//")
      ? params.returnTo
      : pendingReturn?.returnTo || "";
  const paymentResult =
    typeof params.paymentResult === "string"
      ? params.paymentResult.toUpperCase()
      : "UNKNOWN";

  if (!paymentId || !verifyFrasersPlusReturnToken(paymentId, returnToken)) redirect("/");

  if (paymentResult === "UNKNOWN") {
    redirect(
      (requestedReturnTo.startsWith("/survey-review/") && !requestedReturnTo.includes("\\") ? requestedReturnTo : "") ||
        (paymentId
          ? `/?resume=payment&paymentId=${encodeURIComponent(paymentId)}&rt=${encodeURIComponent(returnToken)}&retry=1`
          : "/"),
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    (!paymentId || !verifyFrasersPlusReturnToken(paymentId, returnToken))
  ) {
    redirect("/");
  }

  const session =
    (uprFromQuery ? await getPaymentSessionByUpr(uprFromQuery) : undefined) ??
    (paymentId ? await getPaymentSessionByPaymentId(paymentId) : undefined);
  if (session && session.paymentId !== paymentId) redirect("/");
  if (uprFromQuery && session?.uniquePaymentReference !== uprFromQuery) redirect("/");
  const upr = uprFromQuery || session?.uniquePaymentReference || "";
  const workflow =
    (paymentId ? await getPostSurveyWorkflowByPaymentId(paymentId) : undefined) ??
    (paymentId
      ? (await syncWorkflowStateFromCurrentData()).find(
          (entry) =>
            entry.sourcePaymentId === paymentId ||
            entry.currentPaymentId === paymentId ||
            entry.topUpPaymentId === paymentId ||
            entry.replacementPaymentId === paymentId,
        )
      : undefined);
  const isTopUpReturn =
    workflow &&
    (workflow.topUpPaymentId === paymentId || workflow.replacementPaymentId === paymentId);
  const customerStatusHref = workflow?.reviewToken
    ? `/survey-review/${encodeURIComponent(workflow.reviewToken)}`
    : null;

  return (
    <ReturnClient
      upr={upr}
      paymentId={paymentId}
      paymentResult={paymentResult}
      returnToken={returnToken}
      session={session}
      isTopUpReturn={Boolean(isTopUpReturn)}
      originalAmount={workflow?.originalAmount}
      revisedAmount={workflow?.amendedAmount ?? workflow?.originalAmount}
      topUpAmount={
        workflow
          ? Math.max((workflow.amendedAmount ?? workflow.originalAmount) - workflow.originalAmount, 0)
          : undefined
      }
      customerStatusHref={customerStatusHref}
      preferredDateToken={workflow && preferredDatesEnabledForWorkflow(workflow) ? workflow.reviewToken ?? null : null}
      preferredDateWindowStart={
        workflow ? getPreferredInstallationWindowStart(workflow) : null
      }
      preferredInstallationDates={workflow?.preferredInstallationDates ?? []}
    />
  );
}
