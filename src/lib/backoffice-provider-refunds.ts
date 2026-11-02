import { createHash } from "node:crypto";
import { getPaymentSessionByPaymentId, updateCardCheckoutStatus, updateFrasersPlusPaymentState } from "@/lib/frasers-plus-merchant-state";
import { frasersPlusRequest, type UpdatePayload } from "@/lib/frasers-plus";
import { buildFrasersPlusCreditBasket } from "@/lib/frasers-plus-capture";
import { refundRevolutOrder, retrieveRevolutOrder } from "@/lib/revolut";
import { refundSquarePayment, resolveSquareOrderPaymentStatus, squareRequest } from "@/lib/square";
import type { SurveyWorkflow } from "@/lib/post-survey-workflows";

export type ProviderRefundResult = {
  outcome: "COMPLETED" | "PENDING" | "FAILED" | "UNKNOWN";
  detail: string;
  reference?: string;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const pennies = (amount: number) => Math.round(amount * 100);
const failed = (detail: string): ProviderRefundResult => ({ outcome: "FAILED", detail });

async function originalSession(workflow: SurveyWorkflow) {
  if ((workflow.topUpPaymentStatus === "COMPLETED" && (workflow.amendedAmount ?? workflow.originalAmount) > workflow.originalAmount) || workflow.currentPaymentId !== workflow.sourcePaymentId || workflow.replacementPaymentId) {
    throw new Error("This order has separate or replacement payments. Reconcile all payments in the provider dashboard, then record the full refund manually.");
  }
  const session = await getPaymentSessionByPaymentId(workflow.sourcePaymentId);
  if (!session || !Number.isFinite(session.amount) || pennies(session.amount ?? 0) !== pennies(workflow.originalAmount) || workflow.originalAmount <= 0 || session.currency?.toUpperCase() !== "GBP" || session.provider !== workflow.provider) {
    throw new Error("A matching original GBP payment could not be verified. Check the provider dashboard before refunding.");
  }
  if (session.provider === "CARD" && !["SQUARE", "REVOLUT"].includes(session.cardProcessor || "")) {
    throw new Error("This payment has no supported original processor. Refund through its provider dashboard and record it manually.");
  }
  return session;
}

export async function validateProviderRefund(workflow: SurveyWorkflow) {
  try { await originalSession(workflow); return null; } catch (error) { return (error as Error).message; }
}

function cardOutcome(data: unknown, square: boolean): ProviderRefundResult {
  const refund = square ? object(object(data).refund) : object(data);
  const state = String(refund[square ? "status" : "state"] || "").toUpperCase();
  const reference = typeof refund.id === "string" ? refund.id : undefined;
  if (state === "COMPLETED") return { outcome: "COMPLETED", detail: "Payment provider confirmed the refund completed.", reference };
  if (["FAILED", "REJECTED", "CANCELLED", "CANCELED", "DECLINED"].includes(state)) return { outcome: "FAILED", detail: "The provider reports that this refund failed. Check its dashboard before taking further action.", reference };
  return { outcome: reference ? "PENDING" : "UNKNOWN", detail: reference ? "Refund submitted; provider completion is still pending." : "Provider outcome could not be confirmed. Check the provider dashboard; do not issue another refund.", reference };
}

export async function processProviderRefund(workflow: SurveyWorkflow, checkOnly = false): Promise<ProviderRefundResult> {
  let sending = false;
  try {
    const session = await originalSession(workflow);
    if (session.provider === "FRASERS_PLUS") {
      if (!session.uniquePaymentReference) return failed("Original Frasers Plus reference is missing.");
      const url = `/v1/payment/${encodeURIComponent(session.uniquePaymentReference)}`;
      const current = await frasersPlusRequest(url, { method: "GET" });
      if (!current.response.ok) return checkOnly ? { outcome: "UNKNOWN", detail: "Could not check the existing Frasers Plus refund. No new request was sent." } : failed("Could not verify the Frasers Plus payment before refunding.");
      const payment = object(current.data);
      const history = Array.isArray(payment.history) ? payment.history.map(object) : [];
      const last = history.at(-1) ?? {};
      const type = String(payment.type || last.type || "").toUpperCase();
      const amount = object(payment.paymentAmount ?? last.paymentAmount);
      if (["CREDIT", "REVERSAL"].includes(type)) {
        if (typeof amount.amount !== "number" || pennies(amount.amount) !== pennies(workflow.originalAmount)) return { outcome: "UNKNOWN", detail: "An existing credit or reversal needs reconciliation in the Frasers Plus dashboard." };
        await updateFrasersPlusPaymentState({ paymentId: session.paymentId, uniquePaymentReference: session.uniquePaymentReference, currentType: type, status: type === "REVERSAL" ? "CANCELLED" : "COMPLETED" });
        return { outcome: "COMPLETED", detail: `Frasers Plus confirmed ${type.toLowerCase()} of the original payment.`, reference: session.uniquePaymentReference };
      }
      if (checkOnly) return { outcome: "UNKNOWN", detail: "Frasers Plus has not confirmed the refund or reversal. No new request was sent.", reference: session.uniquePaymentReference };
      if (!["CAPTURE", "AUTHORIZATION"].includes(type)) return failed("The current Frasers Plus payment is not eligible for a refund or reversal.");
      const captured = [...history].reverse().find(entry => String(entry.type).toUpperCase() === "CAPTURE");
      const paid = object(captured?.paymentAmount ?? payment.paymentAmount ?? last.paymentAmount);
      if (typeof paid.amount !== "number" || pennies(paid.amount) !== pennies(workflow.originalAmount) || String(paid.currency).toUpperCase() !== "GBP") return failed("Frasers Plus amount differs from the order. Reconcile it before refunding.");
      const refundType = type === "CAPTURE" ? "CREDIT" : "REVERSAL";
      const payload: UpdatePayload = { type: refundType, paymentAmount: { amount: workflow.originalAmount, currency: "GBP" }, ...(refundType === "CREDIT" ? { basket: buildFrasersPlusCreditBasket(session, workflow.originalAmount) } : {}), metadata: { paymentId: session.paymentId, sourcePaymentId: workflow.sourcePaymentId } };
      sending = true;
      const result = await frasersPlusRequest(url, { method: "PUT", body: JSON.stringify(payload) });
      if (!result.response.ok) return { outcome: "UNKNOWN", detail: "Frasers Plus did not confirm the outcome. Check the existing refund before taking further action.", reference: session.uniquePaymentReference };
      // A successful submission is not proof of completion: verify with a fresh GET.
      return processProviderRefund(workflow, true);
    }

    const square = session.cardProcessor === "SQUARE";
    const paymentReference = session.providerPaymentReference ?? session.stripeSessionId;
    if (!paymentReference) return failed("Original card payment reference is missing.");
    let result;
    if (checkOnly) {
      if (!workflow.refundProviderReference) return { outcome: "UNKNOWN", detail: "No provider refund reference was returned. Check the provider dashboard and record a confirmed completed refund manually. No new refund was sent." };
      result = square
        ? await squareRequest(`/v2/refunds/${encodeURIComponent(workflow.refundProviderReference)}`, { method: "GET" })
        : await retrieveRevolutOrder(workflow.refundProviderReference);
      if (!result.response.ok) return { outcome: "UNKNOWN", detail: "Unable to check the existing provider refund. No new refund was sent.", reference: workflow.refundProviderReference };
    } else {
      // Stable across retries; never create a second refund key after a timeout.
      const key = createHash("sha256").update(`full-refund:${session.paymentId}:${paymentReference}`).digest("hex").slice(0, 40);
      if (square) {
        const current = await resolveSquareOrderPaymentStatus(paymentReference);
        const payment = object(object(current.data).payment);
        const paid = object(payment.amount_money);
        const refunded = object(payment.refunded_money);
        if (!current.response.ok || current.status !== "COMPLETED" || !current.paymentId || paid.amount !== pennies(workflow.originalAmount) || paid.currency !== "GBP" || Number(refunded.amount || 0) > 0) return failed("A completed, unrefunded Square payment for this amount could not be verified. Check the provider dashboard.");
        sending = true;
        result = await refundSquarePayment(current.paymentId, workflow.originalAmount, "GBP", key);
      } else {
        const current = await retrieveRevolutOrder(paymentReference);
        const payment = object(current.data);
        if (!current.response.ok || payment.state !== "completed" || payment.amount !== pennies(workflow.originalAmount) || payment.currency !== "GBP" || Number(payment.refunded_amount || 0) > 0) return failed("A completed, unrefunded Revolut payment for this amount could not be verified. Check the provider dashboard.");
        sending = true;
        result = await refundRevolutOrder(paymentReference, workflow.originalAmount, "GBP", key);
      }
      if (!result.response.ok) return { outcome: "UNKNOWN", detail: "The provider did not confirm the refund outcome. Check its dashboard before issuing any other refund." };
    }
    const outcome = cardOutcome(result.data, square);
    if (outcome.outcome === "COMPLETED") await updateCardCheckoutStatus({ paymentId: session.paymentId, providerPaymentReference: paymentReference, status: "REFUNDED" });
    return outcome;
  } catch (error) {
    return sending || checkOnly
      ? { outcome: "UNKNOWN", detail: "Provider outcome could not be verified. Check the existing refund in the provider dashboard; do not issue another refund." }
      : failed(error instanceof Error && error.message.startsWith("This order") ? error.message : "Payment verification failed; no refund request was sent.");
  }
}
