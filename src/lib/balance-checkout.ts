import { createHash } from "node:crypto";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { attachTopUpPaymentToWorkflow, canPayWorkflowBalance, getOutstandingWorkflowBalance, getPostSurveyWorkflowByToken, isSurveyReviewLinkExpired } from "@/lib/post-survey-workflows";
import { createCardCheckoutForWorkflow, createFrasersAuthorizationForWorkflow } from "@/lib/post-survey-payments";

type Method = "card" | "frasers-plus";
type Attempt = { paymentId: string; method: Method; amount: number; phase: "CREATING" | "READY" | "UNKNOWN"; redirectUrl?: string };
export class BalanceCheckoutError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function startOrResumeBalanceCheckout(origin: string, token: string, method: Method) {
  const initial = await getPostSurveyWorkflowByToken(token);
  if (!initial || isSurveyReviewLinkExpired(initial)) throw new BalanceCheckoutError("This order link is unavailable.", 404);
  const filename = `balance-checkout-${createHash("sha256").update(initial.id).digest("hex")}.json`;
  const reservation = await withJsonFileTransaction(filename, async () => {
    const workflow = await getPostSurveyWorkflowByToken(token);
    if (!workflow || isSurveyReviewLinkExpired(workflow) || !canPayWorkflowBalance(workflow)) {
      throw new BalanceCheckoutError("This order has no payable balance. Refresh your order status.");
    }
    const amount = getOutstandingWorkflowBalance(workflow);
    const existing = await readJsonFile<Attempt | null>(filename, null);
    if (existing) {
      if (existing.method !== method || existing.amount !== amount) {
        throw new BalanceCheckoutError("A balance checkout already exists. Use its original payment route, or contact VCHRGD to reconcile it before changing payment method or amount.");
      }
      if (existing.phase !== "READY" || !existing.redirectUrl) {
        throw new BalanceCheckoutError("Your balance checkout is being prepared or its outcome needs checking. Please wait and refresh, or contact VCHRGD. No second payment has been created.");
      }
      return { workflow, attempt: existing, create: false };
    }
    // Adopt pre-release pending attempts. Never create another payable link merely
    // because its durable reservation did not exist in the previous deployment.
    if (workflow.topUpPaymentId && !["FAILED", "CANCELLED"].includes(workflow.topUpPaymentStatus)) {
      const session = await getPaymentSessionByPaymentId(workflow.topUpPaymentId);
      const legacy: Attempt = { paymentId: workflow.topUpPaymentId,
        method: workflow.topUpPaymentChoice === "frasers-plus" ? "frasers-plus" : "card", amount,
        phase: session?.redirectUrl && session.amount === amount ? "READY" : "UNKNOWN", redirectUrl: session?.redirectUrl };
      await writeJsonFile(filename, legacy);
      return { workflow, attempt: legacy, create: false };
    }
    const attempt: Attempt = { paymentId: `${workflow.sourcePaymentId}-topup-${method === "card" ? "card" : "frasers"}-${Date.now()}`, method, amount, phase: "CREATING" };
    await writeJsonFile(filename, attempt);
    return { workflow, attempt, create: true };
  });
  const { attempt, workflow } = reservation;
  if (!reservation.create) {
    if (attempt.method !== method || attempt.phase !== "READY" || !attempt.redirectUrl) {
      throw new BalanceCheckoutError("An existing balance attempt needs reconciliation before another payment can be created. Please contact VCHRGD.");
    }
    return attempt.redirectUrl;
  }
  try {
    // Persist the child link before the provider call: an early callback can be
    // associated with this workflow. No database transaction spans a network call.
    await attachTopUpPaymentToWorkflow(workflow.id, "system", { paymentId: attempt.paymentId, paymentChoice: method });
    let redirectUrl: string | undefined;
    if (method === "frasers-plus") {
      const result = await createFrasersAuthorizationForWorkflow(origin, workflow, attempt.amount, {
        paymentId: attempt.paymentId, paymentIdSuffix: "topup-frasers",
        redirectUrl: `${origin}/frasers-plus/return`,
        metadata: { workflowId: workflow.id, reviewToken: token, orderOverviewPath: `/survey-review/${encodeURIComponent(token)}`, paymentPhase: "post_survey_top_up" },
      });
      if (result.response.ok && result.data?.uniquePaymentReference && result.data.redirectUrl) {
        redirectUrl = result.data.redirectUrl;
        await attachTopUpPaymentToWorkflow(workflow.id, "system", { paymentId: attempt.paymentId, paymentChoice: method, uniquePaymentReference: result.data.uniquePaymentReference });
      }
    } else {
      const result = await createCardCheckoutForWorkflow(origin, workflow, attempt.amount, attempt.paymentId);
      if (result.response.ok) redirectUrl = result.redirectUrl;
    }
    if (!redirectUrl) throw new Error("Provider did not confirm checkout creation.");
    await withJsonFileTransaction(filename, async () => {
      await writeJsonFile(filename, { ...attempt, phase: "READY", redirectUrl });
    });
    return redirectUrl;
  } catch {
    await withJsonFileTransaction(filename, async () => {
      await writeJsonFile(filename, { ...attempt, phase: "UNKNOWN" });
    });
    throw new BalanceCheckoutError("The payment provider outcome needs checking. Contact VCHRGD before starting another balance payment.", 502);
  }
}
