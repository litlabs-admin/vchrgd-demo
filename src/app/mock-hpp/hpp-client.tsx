"use client";

import { ArrowRight, Clock3, LoaderCircle, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const APPROVAL_COUNTDOWN_SECONDS = 15;
const APPROVAL_RING_RADIUS = 54;
const APPROVAL_RING_CIRCUMFERENCE = 2 * Math.PI * APPROVAL_RING_RADIUS;

function resultFromDecision(decision: "approved" | "declined" | "pending") {
  if (decision === "approved") return "COMPLETED";
  if (decision === "declined") return "DECLINED";
  return "PENDING";
}

function formatCountdown(secondsRemaining: number) {
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function HppClient({
  upr,
  redirect,
  scenario,
  profile,
  session,
  orderOverview,
}: {
  upr: string;
  redirect: string;
  scenario: string;
  profile: string;
  session?: PaymentSession;
  orderOverview?: string;
}) {
  const [submitting, setSubmitting] = useState<"approved" | "declined" | "pending" | null>(
    null,
  );
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    scenario === "declined" || scenario === "pending" ? 0 : APPROVAL_COUNTDOWN_SECONDS,
  );
  const completionStartedRef = useRef(false);
  const scenarioKey = scenario === "declined" || scenario === "pending" ? scenario : "approved";
  const profileHint =
    profile === "partial-match"
      ? "A quick detail check may still happen inside the Frasers Plus app before approval is confirmed."
      : profile === "new-customer"
        ? "This mock stands in for the Frasers Plus app setup and eligibility checks before the approval comes back to VCHRGD."
        : "This mock represents the standard Frasers Plus app approval step before the customer is returned to VCHRGD.";

  const customerName = session?.customerName || "VCHRGD customer";
  const orderReference = session?.paymentId || `VCHRGD-DEMO-${upr.slice(0, 8).toUpperCase()}`;
  const totalAmount =
    typeof session?.amount === "number" ? money.format(session.amount) : "To be confirmed";
  const isTopUpFlow = Boolean(orderOverview);
  const orderOverviewHref = orderOverview || "";
  const paymentChoiceHref = orderReference
    ? `/?resume=payment&paymentId=${encodeURIComponent(orderReference)}`
    : "/";

  const approvalRingOffset = useMemo(() => {
    return (
      APPROVAL_RING_CIRCUMFERENCE -
      (secondsRemaining / APPROVAL_COUNTDOWN_SECONDS) * APPROVAL_RING_CIRCUMFERENCE
    );
  }, [secondsRemaining]);

  const complete = useCallback(async (decision: "approved" | "declined" | "pending") => {
    if (completionStartedRef.current) {
      return;
    }
    completionStartedRef.current = true;
    setSubmitting(decision);

    const response = await fetch(`/api/mock-tymit/payment/${upr}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });

    if (!response.ok) {
      completionStartedRef.current = false;
      setSubmitting(null);
      return;
    }

    const url = new URL(redirect, window.location.origin);
    url.searchParams.set("paymentResult", resultFromDecision(decision));
    url.searchParams.set("upr", upr);
    if (!url.searchParams.get("paymentId")) {
      url.searchParams.set("paymentId", orderReference);
    }
    window.location.assign(url.toString());
  }, [orderReference, redirect, upr]);

  useEffect(() => {
    if (scenarioKey !== "approved") {
      return;
    }

    completionStartedRef.current = false;

    const interval = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(current - 1, 0));
    }, 1000);
    const autoContinue = window.setTimeout(() => {
      void complete("approved");
    }, APPROVAL_COUNTDOWN_SECONDS * 1000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(autoContinue);
    };
  }, [complete, scenarioKey]);

  function returnToStore() {
    window.location.assign(orderOverviewHref || paymentChoiceHref);
  }

  if (scenarioKey === "approved") {
    return (
      <main className="min-h-screen bg-white px-5 py-6 text-slate-950 sm:px-8 sm:py-8">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[760px] flex-col">
          <div className="flex justify-center sm:justify-end">
            <FrasersWordmark />
          </div>

          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="relative flex h-40 w-40 items-center justify-center">
              <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r={APPROVAL_RING_RADIUS}
                  stroke="#ebe7f7"
                  strokeWidth="8"
                  fill="none"
                />
                <defs>
                  <linearGradient id="frasers-approval-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#c44fff" />
                    <stop offset="100%" stopColor="#7d3cff" />
                  </linearGradient>
                </defs>
                <circle
                  cx="64"
                  cy="64"
                  r={APPROVAL_RING_RADIUS}
                  stroke="url(#frasers-approval-ring)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={APPROVAL_RING_CIRCUMFERENCE}
                  strokeDashoffset={approvalRingOffset}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="text-[2rem] font-semibold tracking-[-0.05em] text-slate-950">
                  {formatCountdown(secondsRemaining)}
                </span>
              </div>
            </div>

            <h1 className="mt-10 max-w-[420px] text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.05em] text-slate-950">
              Confirm your payment in the Frasers Plus app
            </h1>

            <button
              type="button"
              onClick={() => void complete("approved")}
              disabled={submitting !== null}
              className="mt-8 inline-flex min-h-14 w-full max-w-[420px] items-center justify-center rounded-[12px] bg-[linear-gradient(90deg,#c44fff_0%,#8d3dff_100%)] px-6 text-base font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                {submitting === "approved" ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Continuing
                  </>
                ) : (
                  <>
                    Continue in app
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </span>
            </button>

            <p className="mt-5 max-w-[420px] text-sm leading-6 text-slate-500">
              You will be returned to VCHRGD automatically after 15 seconds if approval is not
              completed sooner.
            </p>
            <p className="mt-3 max-w-[460px] text-sm leading-6 text-slate-500">{profileHint}</p>

            <button
              type="button"
              onClick={() => void complete("approved")}
              disabled={submitting !== null}
              className="mt-6 text-base font-medium text-[#8d3dff] underline decoration-transparent transition hover:decoration-[#8d3dff] disabled:opacity-60"
            >
              Do not have the Frasers Plus app yet? Confirm the payment here
            </button>

            <button
              type="button"
              onClick={returnToStore}
              disabled={submitting !== null}
              className="mt-6 text-base font-medium text-[#8d3dff] underline decoration-transparent transition hover:decoration-[#8d3dff] disabled:opacity-60"
            >
              {isTopUpFlow ? "Cancel and return to order overview" : "Cancel and return to store"}
            </button>

            <OrderMeta
              orderReference={orderReference}
              customerName={customerName}
              totalAmount={totalAmount}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-5 py-6 text-slate-950 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[760px] flex-col">
        <div className="flex justify-center sm:justify-end">
          <FrasersWordmark />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <section className="w-full rounded-[28px] border border-slate-200 bg-white px-6 py-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:px-10 sm:py-10">
            <div className="mx-auto max-w-[520px] text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#f6f1ff]">
                {scenarioKey === "pending" ? (
                  <Clock3 className="h-10 w-10 text-[#8d3dff]" />
                ) : (
                  <XCircle className="h-10 w-10 text-[#b42318]" />
                )}
              </div>

              <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-[#8d3dff]">
                {scenarioKey === "pending" ? "Awaiting confirmation" : "Application not approved"}
              </p>
              <h1 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.05em] text-slate-950">
                {scenarioKey === "pending"
                  ? "We are still waiting for confirmation in the Frasers Plus app"
                  : "We could not confirm this Frasers Plus payment"}
              </h1>
              <p className="mt-5 text-base leading-7 text-slate-600">
                {scenarioKey === "pending"
                  ? "This mock keeps the Frasers Plus request open and returns you to VCHRGD with a pending status so the journey can be reviewed."
                  : "This mock returns a not approved outcome to VCHRGD so the customer can choose another payment route."}
              </p>

              <OrderMeta
                orderReference={orderReference}
                customerName={customerName}
                totalAmount={totalAmount}
              />

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => void complete(scenarioKey)}
                  disabled={submitting !== null}
                  className={`inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    scenarioKey === "pending"
                      ? "bg-[linear-gradient(90deg,#c44fff_0%,#8d3dff_100%)] text-white"
                      : "bg-slate-950 text-white"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {submitting === scenarioKey ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Returning
                      </>
                    ) : (
                      <>
                        Return to VCHRGD
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={returnToStore}
                  disabled={submitting !== null}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTopUpFlow ? "Cancel and return to order overview" : "Cancel and return to store"}
                </button>
              </div>

              {scenarioKey === "declined" ? (
                <div className="mt-8 rounded-[20px] border border-[#f3d0d3] bg-[#fff5f6] px-5 py-4 text-left text-sm leading-7 text-slate-700">
                  The customer can still return to VCHRGD and complete the installation order
                  using another payment route.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function FrasersWordmark() {
  return (
    <div className="text-[1.8rem] uppercase leading-none tracking-[-0.07em] text-slate-950 sm:text-[2rem]">
      <span className="font-semibold">Frasers</span>
      <span className="font-light">Plus</span>
    </div>
  );
}

function OrderMeta({
  orderReference,
  customerName,
  totalAmount,
}: {
  orderReference: string;
  customerName: string;
  totalAmount: string;
}) {
  return (
    <div className="mt-10 grid w-full gap-3 border-t border-slate-200 pt-6 text-left sm:grid-cols-3">
      <MetaStat label="Order reference" value={orderReference} />
      <MetaStat label="Customer" value={customerName} />
      <MetaStat label="Amount" value={totalAmount} />
    </div>
  );
}

function MetaStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
