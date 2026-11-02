"use client";

import { useState } from "react";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

type CancelOrderRequestDialogProps = {
  token: string;
  originalAmount: number;
  paymentRouteLabel: string;
  reason: string;
  buttonLabel?: string;
  buttonClassName?: string;
};

export function CancelOrderRequestDialog({
  token,
  originalAmount,
  paymentRouteLabel,
  reason,
  buttonLabel = "Cancel order and request refund",
  buttonClassName = "inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]",
}: CancelOrderRequestDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_32px_80px_rgba(15,23,42,0.24)]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00a7cf]">
              Cancel order request
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Are you sure you want to cancel this order?
            </h2>
            <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              <p>
                If you continue, VCHRGD will review your request to cancel the
                order and arrange a refund or reversal of the original{" "}
                {paymentRouteLabel.toLowerCase()} amount of{" "}
                {money.format(originalAmount)} if approved.
              </p>
              <p>
                No additional balance will be taken as part of this request.
                Once approved, refunds or reversals usually appear within 3
                working days, although timings can vary by bank or payment
                provider.
              </p>
              <p>
                If you still want to proceed with the installation, choose one
                of the balance payment options instead.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              >
                Keep order
              </button>
              <form action="/api/survey-review/action" method="post">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="decline" />
                <input type="hidden" name="reason" value={reason} />
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold text-white transition hover:bg-[#0f1116]"
                >
                  Request cancellation
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
