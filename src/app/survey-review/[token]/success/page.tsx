import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPostSurveyWorkflowByToken,
  getResolvedWorkflowAmount,
} from "@/lib/post-survey-workflows";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export default async function SurveyReviewSuccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const workflow = await getPostSurveyWorkflowByToken(token);

  if (!workflow) {
    notFound();
  }

  const reference =
    workflow.replacementPaymentId || workflow.currentPaymentId || workflow.sourcePaymentId;
  const amount = getResolvedWorkflowAmount(workflow);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-10 text-slate-950">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Installation confirmed
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
            Thank you. Your installation is moving ahead.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            We have recorded your confirmation and will be in touch shortly to arrange
            your installation date. Your charger is now being prepared so everything is
            ready for the day.
          </p>

          <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-6">
            <p className="text-sm text-slate-500">Order reference</p>
            <strong className="mt-3 block break-all text-[clamp(2rem,5vw,3.6rem)] font-bold leading-none tracking-[-0.06em] text-slate-950">
              {reference}
            </strong>
          </div>

          <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
              Important information
            </p>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              <li>Installation cost has been reviewed against the digital survey information you provided.</li>
              <li>If any further site detail changes before installation, VCHRGD will confirm this with you before proceeding.</li>
              <li>Your charger and installation booking will now move into the operations queue.</li>
            </ul>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2]"
            >
              Return to VCHRGD
            </Link>
          </div>
        </section>

        <aside className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Final order summary
          </p>
          <div className="mt-5 grid gap-4">
            <Summary label="Customer" value={workflow.customerName || "Not available"} />
            <Summary label="Email" value={workflow.customerEmail || "Not available"} />
            <Summary label="Product" value={workflow.chargerName || "Not available"} />
            <Summary label="Confirmed total" value={money.format(amount)} strong />
            <Summary
              label="Payment route"
              value={workflow.provider === "FRASERS_PLUS" ? "Frasers Plus" : "Card"}
            />
          </div>
        </aside>
      </div>
    </main>
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
