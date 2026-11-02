"use client";

import Image from "next/image";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  WalletCards,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type MockApprovalOutcome = "pending" | "approved" | "declined";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const profileMessages = {
  "fast-track": {
    badge: "Existing account recognised",
    detail:
      "If Frasers Plus recognise your account, you may be asked to approve the purchase in the app.",
  },
  "partial-match": {
    badge: "Details may need checking",
    detail:
      "Frasers Plus may ask you to verify a few details before approval can continue.",
  },
  "new-customer": {
    badge: "New Frasers Plus customer",
    detail:
      "Frasers Plus can guide you through account setup and eligibility checks before approval without affecting your credit score.",
  },
} as const;

const stages = [
  "Preparing your secure handoff",
  "Connecting to Frasers Plus",
  "Opening the approval page",
];

const sandboxOutcomeOptions: Array<{
  value: MockApprovalOutcome;
  title: string;
  detail: string;
  shortLabel: string;
  icon: typeof CheckCircle2;
}> = [
  {
    value: "approved",
    title: "Approval confirmed",
    detail:
      "Continue as though the Frasers Plus payment has been authorised.",
    shortLabel: "Approved",
    icon: CheckCircle2,
  },
  {
    value: "pending",
    title: "Still awaiting confirmation",
    detail:
      "Show the payment as still awaiting confirmation.",
    shortLabel: "Pending",
    icon: Clock3,
  },
  {
    value: "declined",
    title: "Not approved",
    detail:
      "Show the next step where another payment option is needed.",
    shortLabel: "Not approved",
    icon: XCircle,
  },
];

const sandboxApprovalOutcomes = {
  pending: {
    uniquePaymentReference: "7232fb1e-2140-4848-bf13-8045a974a8d0",
    paymentResult: "PENDING",
    label: "Authorization pending",
  },
  approved: {
    uniquePaymentReference: "c7680b93-f014-4ccb-9338-9aef4f4d4eed",
    paymentResult: "COMPLETED",
    label: "Authorization approved",
  },
  declined: {
    uniquePaymentReference: "e0ecc8b5-9b34-4f63-a6b1-c25cf921e9b8",
    paymentResult: "DECLINED",
    label: "Authorization declined",
  },
} as const;

function normaliseTarget(target: string) {
  if (!target) return "/";
  try {
    return new URL(target, window.location.origin).toString();
  } catch {
    return "/";
  }
}

function resolveMockOutcome(value: string): MockApprovalOutcome {
  return value === "pending" || value === "declined" ? value : "approved";
}

export function HandoffClient({
  target,
  paymentId,
  customerName,
  total,
  profile,
  autostart,
  mock,
  mockOutcome,
  sessionUpr,
  orderOverview,
}: {
  target: string;
  paymentId: string;
  customerName: string;
  total: string;
  profile: string;
  autostart: string;
  mock: string;
  mockOutcome: string;
  sessionUpr: string;
  orderOverview: string;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedMockOutcome, setSelectedMockOutcome] = useState<MockApprovalOutcome>(
    resolveMockOutcome(mockOutcome),
  );
  const [submittingOutcome, setSubmittingOutcome] = useState<MockApprovalOutcome | null>(null);
  const [mockError, setMockError] = useState("");

  const isMockFlow = mock === "1";
  const profileKey =
    profile === "partial-match" || profile === "new-customer" ? profile : "fast-track";
  const profileMessage = profileMessages[profileKey];
  const parsedTotal = Number(total);
  const displayTotal =
    Number.isFinite(parsedTotal) && parsedTotal > 0 ? money.format(parsedTotal) : "To be confirmed";
  const selectedFixture = sandboxApprovalOutcomes[selectedMockOutcome];
  const selectedOutcome =
    sandboxOutcomeOptions.find((option) => option.value === selectedMockOutcome) ??
    sandboxOutcomeOptions[0];

  const targetUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return target || "/";
    }
    return normaliseTarget(target);
  }, [target]);
  const orderOverviewUrl = useMemo(() => {
    if (!orderOverview) {
      return "";
    }

    if (typeof window === "undefined") {
      return orderOverview;
    }

    return normaliseTarget(orderOverview);
  }, [orderOverview]);

  useEffect(() => {
    setSelectedMockOutcome(resolveMockOutcome(mockOutcome));
  }, [mockOutcome]);

  useEffect(() => {
    if (isMockFlow) {
      return;
    }

    if (autostart === "1") {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("autostart");
      window.history.replaceState(window.history.state, "", cleanUrl.toString());

      const timer = setTimeout(() => {
        window.location.replace(targetUrl);
      }, 240);

      return () => clearTimeout(timer);
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    timers.push(setTimeout(() => setStageIndex(1), 550));
    timers.push(setTimeout(() => setStageIndex(2), 1150));
    timers.push(
      setTimeout(() => {
        window.location.replace(targetUrl);
      }, 1750),
    );

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [autostart, isMockFlow, targetUrl]);

  async function completeMockOutcome() {
    setSubmittingOutcome(selectedMockOutcome);
    setMockError("");

    try {
      if (sessionUpr) {
        const hostedUrl = new URL("/mock-hpp", window.location.origin);
        hostedUrl.searchParams.set("upr", sessionUpr);
        hostedUrl.searchParams.set("redirect", targetUrl);
        hostedUrl.searchParams.set("scenario", selectedMockOutcome);
        hostedUrl.searchParams.set("profile", profileKey);
        if (paymentId) {
          hostedUrl.searchParams.set("paymentId", paymentId);
        }
        if (orderOverviewUrl) {
          hostedUrl.searchParams.set("orderOverview", orderOverviewUrl);
        }

        window.location.assign(hostedUrl.toString());
        return;
      }

      const redirectUrl = new URL(targetUrl);
      redirectUrl.searchParams.set("paymentResult", selectedFixture.paymentResult);
      redirectUrl.searchParams.set("upr", selectedFixture.uniquePaymentReference);
      if (paymentId && !redirectUrl.searchParams.get("paymentId")) {
        redirectUrl.searchParams.set("paymentId", paymentId);
      }

      window.location.assign(redirectUrl.toString());
    } catch (error) {
      setMockError(
        error instanceof Error
          ? error.message
          : "We could not continue right now. Please try again.",
      );
      setSubmittingOutcome(null);
    }
  }

  if (autostart === "1") {
    return (
      <main className="fp-page flex min-h-screen items-center justify-center px-4" aria-hidden="true">
        <div className="fp-brand-card flex flex-col items-center gap-4 rounded-[24px] border px-8 py-7">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white">
            <LoaderCircle className="h-7 w-7 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold tracking-[0.04em]">Opening Frasers Plus</p>
            <p className="mt-1 text-xs text-slate-300">Please wait a moment...</p>
          </div>
        </div>
      </main>
    );
  }

  if (isMockFlow) {
    return (
      <main className="fp-page px-4 py-8 text-slate-950">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.12fr)_360px]">
          <section className="fp-shell-card overflow-hidden rounded-[32px]">
            <div className="fp-brand-card border-b px-7 py-7 sm:px-8">
              <div className="flex items-start justify-between gap-6">
                <div className="max-w-3xl">
                  <p className="fp-section-label text-xs font-bold uppercase tracking-[0.24em]">
                    Frasers Plus
                  </p>
                  <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[0.95] tracking-[-0.06em]">
                    Confirm your payment with Frasers Plus
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
                    Choose the approval state you want to review for this payment step.
                  </p>
                </div>
                <div className="hidden shrink-0 self-start sm:block">
                  <div className="relative h-[118px] w-[320px]">
                    <Image
                      src="/content/frasers-plus-official-horizontal.svg"
                      alt="Frasers Plus"
                      width={2000}
                      height={544}
                      className="relative z-10 ml-auto h-auto w-[320px] max-w-full object-contain object-right"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-8 px-7 py-8 sm:px-8">
              <div className="fp-soft-card-strong rounded-[28px] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadbff] pb-5">
                  <div>
                    <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
                      Approval state
                    </p>
                    <p className="mt-3 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                      {selectedOutcome.title}
                    </p>
                  </div>
                  <div className="fp-soft-card rounded-full px-4 py-2 text-sm font-semibold text-[var(--fp-bg)]">
                    {profileMessage.badge}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {sandboxOutcomeOptions.map((option) => {
                    const selected = option.value === selectedMockOutcome;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedMockOutcome(option.value)}
                        className={`inline-flex min-h-11 items-center justify-center rounded-full border px-5 text-sm font-semibold transition ${
                          selected
                            ? "fp-primary-btn"
                            : "border-[#eadbff] bg-white text-[var(--fp-bg)] hover:border-[var(--fp-purple)]"
                        }`}
                      >
                        {option.shortLabel}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-[22px] border border-[#eadbff] bg-white px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[rgba(177,21,244,0.1)] text-[var(--fp-purple-strong)]">
                      <selectedOutcome.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-950">{selectedOutcome.title}</p>
                      <p className="fp-text-muted mt-2 text-sm leading-7">{selectedOutcome.detail}</p>
                    </div>
                  </div>
                </div>

                {mockError ? (
                  <p className="mt-5 rounded-[18px] border border-[#f3c3e4] bg-[#fff4fb] px-4 py-3 text-sm text-[#8e285e]">
                    {mockError}
                  </p>
                ) : null}
              </div>

              <div className="fp-soft-card flex flex-wrap items-center justify-between gap-4 rounded-[24px] px-5 py-4">
                <div>
                  <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
                    Next step
                  </p>
                  <p className="fp-text-muted mt-2 text-sm leading-7">
                    Continue to load the next screen for this approval state.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void completeMockOutcome()}
                  disabled={submittingOutcome !== null}
                  className="fp-primary-btn inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    {submittingOutcome === selectedMockOutcome ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Continuing
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </section>

          <aside className="fp-shell-card rounded-[32px] p-8 text-slate-950">
            <div className="flex items-center justify-between gap-4">
              <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
                Order summary
              </p>
              <Image
                src="/content/frasersplus-stacked.png"
                alt="Frasers Plus"
                width={88}
                height={88}
                className="h-auto w-[88px] object-contain"
              />
            </div>
            <div className="mt-5 grid gap-4">
              <Summary label="Order reference" value={paymentId || "Not available"} strong />
              <Summary label="Customer" value={customerName || "Customer"} />
              <Summary label="Estimated total" value={displayTotal} strong />
              <Summary label="Account status" value={profileMessage.badge} />
              <Summary label="Approval state" value={selectedOutcome.shortLabel} />
            </div>

            <div className="fp-brand-card mt-6 rounded-[24px] border p-5">
              <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
                Before you continue
              </p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-200">
                <p>
                  The next screen will reflect the selected approval state.
                </p>
                <p>
                  The order remains subject to survey completion and review after this approval
                  step.
                </p>
                <p>
                  {profileMessage.detail}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
              <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
                Important
              </p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
                <p>
                  The quoted amount may still change if the digital survey shows that the
                  installation is non-standard or that additional works are required.
                </p>
                <p>If the survey is not received within 3 days, the order may be cancelled.</p>
              </div>
            </div>

            <Link
              href={orderOverviewUrl || "/"}
              className="fp-secondary-btn mt-3 inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
            >
              {orderOverviewUrl ? "Return to order overview" : "Return to checkout"}
            </Link>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="fp-page px-4 py-8 text-slate-950">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.12fr)_360px]">
        <section className="fp-shell-card overflow-hidden rounded-[32px]">
          <div className="fp-brand-card border-b px-7 py-7 sm:px-8">
            <div className="flex items-start justify-between gap-6">
              <div className="max-w-3xl">
                <p className="fp-section-label text-xs font-bold uppercase tracking-[0.24em]">
                  VCHRGD to Frasers Plus
                </p>
                <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.6rem)] font-bold leading-[0.95] tracking-[-0.06em]">
                  Taking you to secure Frasers Plus approval
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
                  You are leaving the VCHRGD checkout for a secure Frasers Plus page. Once
                  approval has been completed, you will return to VCHRGD automatically. The quote
                  may still change if the digital survey shows that the installation is
                  non-standard or that additional works are required to make the property suitable
                  for installation.
                </p>
                <div className="mt-5 inline-flex rounded-full border border-white/14 bg-white px-4 py-2 text-sm font-medium text-[var(--fp-bg)] shadow-[0_12px_28px_rgba(33,21,81,0.18)]">
                  Secure handoff
                </div>
              </div>
              <div className="hidden shrink-0 self-start sm:block">
                <div className="relative h-[118px] w-[320px]">
                  <Image
                    src="/content/frasers-plus-official-horizontal.svg"
                    alt="Frasers Plus"
                    width={2000}
                    height={544}
                    className="relative z-10 ml-auto h-auto w-[320px] max-w-full object-contain object-right"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-7 py-8 sm:px-8">
            <div className="fp-soft-card-strong rounded-[28px] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
                    Secure handoff
                  </p>
                  <p className="mt-3 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                    {stages[stageIndex]}
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(177,21,244,0.1)] text-[var(--fp-purple-strong)]">
                  <LoaderCircle className="h-7 w-7 animate-spin" />
                </div>
              </div>

              <div className="mt-6 h-3 overflow-hidden rounded-full bg-[#e7d8ff]">
                <div
                  className="h-full rounded-full bg-[var(--fp-purple)] transition-all duration-500"
                  style={{ width: `${((stageIndex + 1) / stages.length) * 100}%` }}
                />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {stages.map((stage, index) => (
                  <div
                    key={stage}
                    className={`rounded-[20px] border p-4 transition ${
                      index <= stageIndex
                        ? "border-[var(--fp-purple)] bg-white"
                        : "border-[#eadbff] bg-[linear-gradient(180deg,#fffafd_0%,#faf5ff_100%)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {index < stageIndex ? (
                        <CheckCircle2 className="h-4 w-4 text-[var(--fp-purple)]" />
                      ) : index === stageIndex ? (
                        <LoaderCircle className="h-4 w-4 animate-spin text-[var(--fp-purple)]" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-slate-300" />
                      )}
                      <span className="text-sm font-semibold text-slate-900">{stage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <InfoTile
                icon={<WalletCards className="h-5 w-5" />}
                title="Approval happens first"
                detail="Frasers Plus will confirm whether you can spread the cost before the order proceeds."
              />
              <InfoTile
                icon={<CreditCard className="h-5 w-5" />}
                title="Survey review still applies"
                detail="Your order remains subject to the digital survey being received and reviewed by VCHRGD, and the quoted amount may still change if the installation is non-standard or needs additional works."
              />
              <InfoTile
                icon={<Smartphone className="h-5 w-5" />}
                title="You may be asked to use the app"
                detail={profileMessage.detail}
              />
            </div>

            <div className="fp-soft-card flex flex-wrap items-center justify-between gap-4 rounded-[24px] px-5 py-4">
              <div>
                <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
                  Need to move now?
                </p>
                <p className="fp-text-muted mt-2 text-sm leading-7">
                  If the redirect does not start automatically, continue manually.
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.location.replace(targetUrl)}
                className="fp-primary-btn inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  Continue to Frasers Plus
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          </div>
        </section>

        <aside className="fp-shell-card rounded-[32px] p-8 text-slate-950">
          <div className="flex items-center justify-between gap-4">
            <p className="fp-section-label text-xs font-bold uppercase tracking-[0.22em]">
              Order snapshot
            </p>
            <Image
              src="/content/frasersplus-stacked.png"
              alt="Frasers Plus"
              width={88}
              height={88}
              className="h-auto w-[88px] object-contain"
            />
          </div>
          <div className="mt-5 grid gap-4">
            <Summary label="Order reference" value={paymentId || "Not available"} strong />
            <Summary label="Customer" value={customerName || "VCHRGD customer"} />
            <Summary label="Estimated total" value={displayTotal} strong />
            <Summary label="Approval route" value="Frasers Plus" />
            <Summary label="Profile" value={profileMessage.badge} />
          </div>

          <div className="fp-brand-card mt-6 rounded-[24px] border p-5">
            <p className="fp-section-label text-xs font-bold uppercase tracking-[0.18em]">
              Important information
            </p>
            <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-200">
              <p className="flex gap-3">
                <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-[var(--fp-lilac)]" />
                Frasers Plus approval is requested now, but the order remains subject to survey
                completion and review by VCHRGD. If the survey shows that the installation is
                non-standard or that additional works are required to make the property suitable
                for installation, VCHRGD will confirm any revised price before proceeding.
              </p>
              <p className="flex gap-3">
                <CreditCard className="mt-1 h-4 w-4 shrink-0 text-[var(--fp-lilac)]" />
                If the digital survey is not received within 3 days, the order may be cancelled
                and the transaction made via Frasers Plus refunded.
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="fp-secondary-btn mt-6 inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
          >
            Return to VCHRGD
          </Link>
        </aside>
      </div>
    </main>
  );
}

function InfoTile({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="fp-soft-card rounded-[24px] p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(177,21,244,0.1)] text-[var(--fp-purple-strong)]">
        {icon}
      </div>
      <p className="mt-4 text-lg font-semibold text-slate-950">{title}</p>
      <p className="fp-text-muted mt-2 text-sm leading-7">{detail}</p>
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
    <div className="fp-summary-row grid grid-cols-[minmax(0,1fr)_auto] gap-4 pt-4 first:border-t-0 first:pt-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd
        className={`m-0 text-right text-sm break-words ${
          strong ? "font-bold text-slate-950" : "font-semibold text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
