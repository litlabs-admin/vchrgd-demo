"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export function MockCardCheckoutClient({
  paymentId,
  orderId,
  session,
}: {
  paymentId: string;
  orderId: string;
  session: PaymentSession;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"success" | "cancel" | null>(null);

  async function finish(decision: "success" | "cancel") {
    setBusy(decision);
    const response = await fetch("/api/mock-card-checkout/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentId,
        orderId,
        decision,
      }),
    });
    const data = await response.json();
    if (response.ok && data.redirectUrl) {
      router.push(data.redirectUrl);
      return;
    }

    setBusy(null);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f3f6fb_0%,#edf2f8_100%)] px-4 py-10 text-slate-950">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.1)]">
          <div className="bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_55%,#334155_100%)] px-8 py-7 text-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200/80">
                  Revolut Business
                </p>
                <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-white">
                  Confirm card authorisation
                </h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-slate-200">
                  Review your VCHRGD order and continue through a secure Revolut
                  Business checkout to authorise the quoted amount. The quote may still
                  change if the digital survey shows that the installation is non-standard
                  or that additional works are required to make the property suitable for
                  installation.
                </p>
              </div>
              <div className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-sm font-medium text-white/90">
                Hosted checkout
              </div>
            </div>
          </div>

          <div className="p-8">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#3869ff]">
              Secure payment details
            </p>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              Your card authorisation is requested up front, but the payment is only
              processed once the digital survey has been received, reviewed and approved
              by VCHRGD. The quoted amount may still change if the survey identifies a
              non-standard installation or additional works required to make the property
              suitable for installation.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <Field label="Card number" value="4242 4242 4242 4242" />
              <Field label="Name on card" value={session.customerName || "VCHRGD customer"} />
              <Field label="Expiry date" value="12 / 28" />
              <Field label="Security code" value="123" />
            </div>

            <div className="mt-8 rounded-[24px] border border-[#d8e0f0] bg-[linear-gradient(135deg,#f8fbff_0%,#eef5ff_100%)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#3869ff]">
                Before you continue
              </p>
              <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-700">
                <li>Revolut Business will take your card payment for the quoted amount now.</li>
                <li>The quoted amount is an estimate and may change if the installation is non-standard or if additional works are required to make the property suitable for installation.</li>
                <li>Your order still depends on the digital survey being received and approved by VCHRGD.</li>
                <li>If the survey is not received within 3 days, the order may be cancelled and refunded.</li>
              </ul>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => finish("success")}
                disabled={busy !== null}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold text-white transition hover:bg-[#0f1116] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "success" ? "Authorising..." : "Continue with Revolut Business"}
              </button>
              <button
                type="button"
                onClick={() => finish("cancel")}
                disabled={busy !== null}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#3869ff] hover:text-[#2749d8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "cancel" ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#3869ff]">
            Order summary
          </p>
          <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm text-slate-500">Order reference</p>
            <strong className="mt-2 block break-all text-2xl font-bold tracking-[-0.04em] text-slate-950">
              {paymentId}
            </strong>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Revolut order reference: {orderId}
            </p>
          </div>
          <div className="mt-5 grid gap-4">
            <Summary label="Customer" value={session.customerName || "Not available"} />
            <Summary label="Email" value={session.customerEmail || "Not available"} />
            <Summary label="Product" value={session.chargerName || "Not available"} />
            <Summary label="Unit only" value={money.format(session.hardwarePrice ?? 0)} />
            <Summary label="Installed package" value={money.format(session.installPrice ?? 0)} />
            <Summary label="Survey adjustment" value={money.format(session.surveyAdjustment ?? 0)} />
            <Summary label="Estimated total" value={money.format(session.amount ?? 0)} strong />
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-2 min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950">
        {value}
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`m-0 text-right text-sm ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"}`}>
        {value}
      </dd>
    </div>
  );
}
