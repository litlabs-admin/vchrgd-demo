"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function normaliseTarget(target: string) {
  if (!target) return "/";
  try {
    return new URL(target, window.location.origin).toString();
  } catch {
    return "/";
  }
}

export function CardHandoffClient({
  target,
  paymentId,
  customerName,
  total,
  chargerName,
  addressLine1,
  addressLine2,
  city,
  postalCode,
  country,
  propertyType,
  parkingType,
  cableRun,
  autostart,
}: {
  target: string;
  paymentId: string;
  customerName: string;
  total: string;
  chargerName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
  propertyType: string;
  parkingType: string;
  cableRun: string;
  autostart: string;
}) {
  const parsedTotal = Number(total);
  const displayTotal =
    Number.isFinite(parsedTotal) && parsedTotal > 0
      ? money.format(parsedTotal)
      : "To be confirmed";
  const targetUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return target || "/";
    }
    return normaliseTarget(target);
  }, [target]);
  const paymentOptionsUrl = paymentId
    ? `/?resume=payment&paymentId=${encodeURIComponent(paymentId)}`
    : "/";
  const installationAddress = [addressLine1, addressLine2, city, postalCode, country]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");

  useEffect(() => {
    if (autostart !== "1") {
      return;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("autostart");
    window.history.replaceState(window.history.state, "", cleanUrl.toString());

    const timer = setTimeout(() => {
      window.location.replace(targetUrl);
    }, 240);

    return () => clearTimeout(timer);
  }, [autostart, targetUrl]);

  if (autostart === "1") {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4"
        aria-hidden="true"
      >
        <div className="flex flex-col items-center gap-4 rounded-[24px] border border-slate-200 bg-white px-8 py-7 text-slate-950 shadow-[0_24px_60px_rgba(15,23,42,0.1)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f3ff] text-[#1559b7]">
            <LoaderCircle className="h-7 w-7 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold tracking-[0.04em]">Opening secure card checkout</p>
            <p className="mt-1 text-xs text-slate-500">Please wait a moment…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-6 text-slate-950 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.08)] sm:rounded-[32px]">
          <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#0b1220_0%,#14213c_54%,#12326d_100%)] px-5 py-6 text-white sm:px-8 sm:py-7">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8bb9ff]">
              VCHRGD secure card checkout
            </p>
            <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.5rem)] font-bold leading-[0.95] tracking-[-0.06em]">
              Review your total before secure checkout
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
              You are about to continue to secure checkout to authorise the card payment for your
              VCHRGD order. Please confirm you are happy with the current estimated total before
              continuing. The quote may still change if the digital survey shows that the
              installation is non-standard or that additional works are required to make the
              property suitable for installation.
            </p>
          </div>

          <div className="grid gap-6 px-5 py-6 sm:px-8 sm:py-8">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5 sm:rounded-[26px] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0f7adf]">
                    Before you continue
                  </p>
                  <p className="mt-3 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                    Secure checkout will request card authorisation now
                  </p>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                    Payment is not captured immediately. Your order remains subject to the digital
                    survey being received and approved by VCHRGD, and the quoted amount may still
                    change if the survey identifies a non-standard installation or additional works
                    required to make the property suitable for installation.
                  </p>
                </div>
                <div className="inline-flex rounded-full border border-[#bfddff] bg-white px-4 py-2 text-sm font-semibold text-[#0f4e92]">
                  Hosted secure payment
                </div>
              </div>
              <div className="mt-6 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_16px_36px_rgba(15,23,42,0.05)] sm:rounded-[22px] sm:p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0f7adf]">
                  Order and installation summary
                </p>
                <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <SummaryRow label="Order reference" value={paymentId || "Not available"} />
                  <SummaryRow label="Customer" value={customerName || "VCHRGD customer"} />
                  <SummaryRow label="Selected product" value={chargerName || "Not selected"} />
                  <SummaryRow label="Estimated total" value={displayTotal} strong />
                  <SummaryRow
                    label="Installation address"
                    value={installationAddress || "Installation address not provided"}
                  />
                  <SummaryRow label="Payment route" value="Secure card checkout" />
                  <SummaryRow
                    label="Installation summary"
                    value={[propertyType, parkingType, cableRun].filter(Boolean).join(" · ") || "Survey summary not available"}
                  />
                </div>
                <div className="mt-5 border-t border-slate-200 pt-5 text-sm leading-7 text-slate-600">
                  <p>
                    Your card payment is taken now for the quoted amount, but the order still
                    depends on the digital survey being received and reviewed by VCHRGD.
                  </p>
                  <p className="mt-3">
                    If the digital survey is not received within 3 days, the order may be
                    cancelled and refunded.
                  </p>
                  <p className="mt-3">
                    If the installation turns out to be non-standard or different to the information
                    provided, or if additional works are required to make the property suitable for
                    installation, VCHRGD will confirm any revised price before proceeding.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => window.location.replace(targetUrl)}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#121d34] px-6 text-sm font-semibold text-white transition hover:bg-[#1b2f57] sm:w-auto"
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  Continue to secure checkout
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
              <Link
                href={paymentOptionsUrl}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#92c0ff] hover:text-[#0f4e92] sm:w-auto"
              >
                Back to payment options
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`m-0 text-sm break-words ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"}`}>
        {value}
      </dd>
    </div>
  );
}
