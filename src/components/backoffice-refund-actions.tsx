"use client";

import { useState, type FormEvent } from "react";
import type { SurveyWorkflow } from "@/lib/post-survey-workflows";

type Props = { workflow: SurveyWorkflow; returnTo: string };
const field = "mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950";
const money = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount);

export function ProviderRefundForm({ workflow, returnTo }: Props) {
  const [busy, setBusy] = useState(false);
  if (workflow.refundStatus === "COMPLETED") return null;
  const submitted = workflow.refundStatus === "APPROVED" && workflow.refundProviderResult !== "FAILED";
  const separatePayments = (workflow.topUpPaymentStatus === "COMPLETED" && (workflow.amendedAmount ?? workflow.originalAmount) > workflow.originalAmount) || workflow.currentPaymentId !== workflow.sourcePaymentId || Boolean(workflow.replacementPaymentId);
  return <details className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-900" open={submitted || undefined}>
    <summary className="cursor-pointer font-semibold text-amber-950">Refund through payment provider</summary>
    {submitted ? <div className="mt-3 text-sm leading-6">
      <p className="font-semibold">Provider refund: {workflow.refundProviderResult === "PENDING" ? "processing" : "awaiting confirmation"}</p>
      <p>{workflow.refundProviderDetail || "Check the existing refund before taking further action."}</p>
      {workflow.refundProviderReference ? <p>Reference: {workflow.refundProviderReference}</p> : null}
      <form className="mt-3" action="/api/backoffice/refunds" method="post">
        <input type="hidden" name="workflowId" value={workflow.id} /><input type="hidden" name="action" value="check-provider-refund" /><input type="hidden" name="returnTo" value={returnTo} />
        <button className="min-h-11 rounded-full border border-amber-800 bg-white px-5 font-semibold text-amber-950">Check provider refund status</button>
      </form>
      <p className="mt-2">This checks the existing request. It does not issue another refund.</p>
    </div> : separatePayments ? <p className="mt-3 text-sm leading-6">This order includes separate or replacement payments. Reconcile and refund all relevant transactions in the provider dashboard, then use &ldquo;Refund processed manually&rdquo; below. This prevents a partial refund from incorrectly closing the whole order.</p> : <>
      <p className="mt-3 text-sm leading-6">Refund <strong>{money(workflow.originalAmount)}</strong> to the original payment method{workflow.provider === "FRASERS_PLUS" ? " through Frasers Plus (or reverse an uncaptured authorisation)" : " through the original card processor"}. Unlike the manual option, this sends a real payment-provider request.</p>
      <p className="mt-2 text-sm leading-6">Only use this if no bank or dashboard refund has already been made. Installer bookings and dispatched chargers must be handled separately.</p>
      {workflow.refundProviderResult === "FAILED" ? <p role="alert" className="mt-2 text-sm font-semibold">Previous attempt: {workflow.refundProviderDetail}</p> : null}
      <form action="/api/backoffice/refunds" method="post" className="mt-4 grid gap-4" onSubmit={event => {
        if (!window.confirm(`Send a real ${money(workflow.originalAmount)} refund request for ${workflow.customerName || workflow.sourcePaymentId}? Do not continue if you have already refunded this payment elsewhere.`)) { event.preventDefault(); return; }
        setBusy(true);
      }}>
        <input type="hidden" name="workflowId" value={workflow.id} /><input type="hidden" name="action" value="approve-refund" /><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="providerRefundAmount" value={workflow.originalAmount.toFixed(2)} />
        <label className="text-sm font-medium">Refund reason<textarea className={field} name="adminNotes" maxLength={2000} required /></label>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0" name="providerRefundConfirmed" type="checkbox" value="yes" required /><span>I have checked that no refund has already been made, and authorise this refund to the original payment method.</span></label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ color: "#fff", WebkitTextFillColor: "#fff" }}>{busy ? "Submitting refund..." : `Confirm provider refund ${money(workflow.originalAmount)}`}</button>
      </form>
    </>}
  </details>;
}

export function ManualRefundForm({ workflow, returnTo }: Props) {
  const [busy, setBusy] = useState(false);
  const amount = workflow.originalAmount + (workflow.topUpPaymentStatus === "COMPLETED" ? Math.max((workflow.amendedAmount ?? workflow.originalAmount) - workflow.originalAmount, 0) : 0);
  if (workflow.refundStatus === "COMPLETED") return null;
  function confirmRefund(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Record the full refund for ${workflow.customerName || workflow.sourcePaymentId} as already completed? This closes the order but does not send money or call a payment provider.`)) {
      event.preventDefault();
      return;
    }
    setBusy(true);
  }
  return (
    <details className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-slate-900">
      <summary className="cursor-pointer font-semibold text-emerald-900">Refund processed manually</summary>
      <p className="mt-3 text-sm leading-6">Use only after a full refund has already been completed through the bank or payment-provider dashboard. This records the refund and closes the order. It does not send money, cancel an installer booking in Jumptech, or recall a dispatched charger.</p>
      <form action="/api/backoffice/refunds" method="post" onSubmit={confirmRefund} className="mt-4 grid gap-4">
        <input type="hidden" name="workflowId" value={workflow.id} />
        <input type="hidden" name="action" value="manual-refund-completed" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Amount refunded (GBP)
            <input className={field} name="refundAmount" type="number" min="0.01" step="0.01" defaultValue={amount.toFixed(2)} required />
            <span className="mt-1 block text-xs font-normal text-slate-600">Full recorded payment: {money(amount)}. Unpaid extra costs are excluded. Partial refunds must not close the order using this action.</span>
          </label>
          <label className="text-sm font-medium">Refund date<input className={field} name="refundDate" type="date" required /></label>
          <label className="text-sm font-medium">Refund method<select className={field} name="refundMethod" defaultValue="BANK_TRANSFER" required><option value="BANK_TRANSFER">Bank transfer</option><option value="PROVIDER_DASHBOARD">Payment-provider dashboard</option><option value="OTHER">Other external refund</option></select></label>
          <label className="text-sm font-medium">Refund / bank reference<input className={field} name="refundReference" maxLength={120} required placeholder="Transaction reference, not bank account details" /></label>
        </div>
        <label className="text-sm font-medium">Reason / notes<textarea className={field} name="adminNotes" maxLength={2000} required placeholder="For example: customer requested cancellation by telephone." /></label>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" name="refundConfirmed" value="yes" required /><span>I have verified that the full refund has completed outside this platform and this order should be closed. No further refund should be issued here.</span></label>
        {workflow.refundStatus === "APPROVED" && workflow.refundProviderResult !== "FAILED" ? <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" name="providerOutcomeVerified" value="yes" required /><span>I have also checked the existing provider refund in its dashboard and verified the completed outcome. I am recording that outcome, not sending a second refund.</span></label> : null}
        <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-emerald-800 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ color: "#fff", WebkitTextFillColor: "#fff" }}>{busy ? "Recording refund..." : "Confirm manual refund processed"}</button>
      </form>
    </details>
  );
}

export function BackofficeRefundActions({ workflow, returnTo }: Props) {
  return (
    <section className="mt-4 rounded-[22px] border border-slate-200 bg-white p-5" aria-label="Cancellation and refund">
      <h3 className="text-base font-semibold text-slate-950">Cancellation and refund</h3>
      {workflow.refundStatus === "COMPLETED" ? (
        <div className="mt-3 text-sm leading-7 text-emerald-900">
          <p className="font-semibold">{workflow.manualRefund ? "Refund processed manually" : "Refund completed"}</p>
          {workflow.manualRefund ? <><p>{money(workflow.manualRefund.amount)} | {workflow.manualRefund.method.replaceAll("_", " ").toLowerCase()} | {workflow.manualRefund.refundedOn}</p><p>Reference: {workflow.manualRefund.reference}</p><p>Recorded by {workflow.manualRefund.recordedBy}</p><p>{workflow.manualRefund.notes}</p></> : <p>{workflow.refundCompletedAt || "Completion recorded"}</p>}
          <p>No further refund can be issued from this order.</p>
        </div>
      ) : (
        <div className="mt-3 grid gap-4">
          <ProviderRefundForm workflow={workflow} returnTo={returnTo} />
          {workflow.refundStatus === "NONE" || workflow.refundStatus === "REJECTED" ? (
            <form action="/api/backoffice/refunds" method="post">
              <input type="hidden" name="workflowId" value={workflow.id} /><input type="hidden" name="action" value="request-refund" /><input type="hidden" name="returnTo" value={returnTo} />
              <button className="min-h-11 rounded-full border border-amber-300 bg-amber-50 px-5 text-sm font-semibold text-amber-900" type="submit">Move to refund queue</button>
              <p className="mt-2 text-xs leading-5 text-slate-600">For a refund that has not yet been made. An agent reviews it before any provider refund is attempted.</p>
            </form>
          ) : <a className="font-semibold text-[#00738a] underline" href={`/backoffice?tab=refunds&refundQuery=${encodeURIComponent(workflow.sourcePaymentId)}`}>Open refund request</a>}
          <ManualRefundForm workflow={workflow} returnTo={returnTo} />
        </div>
      )}
    </section>
  );
}
