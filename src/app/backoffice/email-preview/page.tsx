import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import {
  renderCheckoutRecoveryEmail,
  type CheckoutRecoveryEmailStage,
} from "@/lib/checkout-recovery-email";
import { createCheckoutRecoveryToken } from "@/lib/checkout-recovery-token";
import { renderAdditionalCostsEmail } from "@/lib/additional-costs-email";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Email Preview | VCHRGD Back Office",
  robots: {
    index: false,
    follow: false,
  },
};

type EmailPreviewPageProps = {
  searchParams?: Promise<{
    emailError?: string;
    emailState?: string;
    stage?: string;
    template?: string;
  }>;
};

function getStage(value: string | undefined): CheckoutRecoveryEmailStage {
  return value === "72h" ? "72h" : "24h";
}

export default async function BackofficeEmailPreviewPage({
  searchParams,
}: EmailPreviewPageProps) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/backoffice/login");
  }

  const params = await searchParams;
  const stage = getStage(params?.stage);
  const isAdditionalCosts = params?.template === "additional-costs";
  const emailState = params?.emailState ?? "";
  const emailError = params?.emailError ?? "";
  const samplePaymentId = "VCHRGD-EMAIL-TEST-CHECKOUT";
  const sampleRecoveryLink = `https://payments.vchrgd.app/checkout/recover/${createCheckoutRecoveryToken(samplePaymentId)}`;
  const sampleProgressLink =
    "https://payments.vchrgd.app/survey-review/vchrgd-additional-costs-email-preview";
  const email = isAdditionalCosts
    ? renderAdditionalCostsEmail({
        firstName: "Anthony",
        customerName: "Anthony Mumford",
        chargerName: "Seven Pro Tethered",
        installationPostcode: "EH21 8TP",
        orderReference: "VCHRGD-1786530633351-2293",
        originalAmount: 935,
        revisedTotal: 1181,
        alreadyPaid: 935,
        balanceDue: 246,
        additionalCostLines: [
          { label: "Additional labour", amount: 125 },
          { label: "Additional cable", amount: 75 },
          { label: "Sundries", amount: 5 },
          { label: "VAT", amount: 41 },
        ],
        explanation:
          "Your survey shows that the cable route and installation work required are outside the standard installation allowance. The revised cost covers the extra labour, cable and sundries needed to complete the work.",
        progressLink: sampleProgressLink,
        paymentLink: `${sampleProgressLink}/pay-balance`,
        brandLogoUrl: "/content/vchrgd-email-logo.png",
      })
    : renderCheckoutRecoveryEmail({
        stage,
        firstName: "Alexander",
        customerName: "Alexander Watson",
        chargerName: "Seven Pro Untethered",
        totalAmount: "£875.00",
        postcode: "SL8 5YS",
        orderReference: samplePaymentId,
        recoveryLink: sampleRecoveryLink,
        expiresAtLabel: "Friday 24 July 2026 at 14:30",
        brandLogoUrl: "/content/vchrgd-email-logo.png",
      });

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-[1280px]">
        <header className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
                {isAdditionalCosts ? "Post-survey payment" : "Checkout recovery"}
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-slate-950">
                {isAdditionalCosts
                  ? "Additional costs email preview"
                  : "Abandoned payment email preview"}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                {isAdditionalCosts
                  ? "This draft explains the installation additions, personalises the cost summary and provides separate secure payment and progress links. Automated customer sending remains disabled while the template is under review."
                  : "This previews the exact responsive HTML and plain text that will be used for the 24-hour and 72-hour payment follow-up emails. No email is sent from this page."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/backoffice"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 no-underline transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              >
                Back to orders
              </Link>
              <form action="/api/admin/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <section className="mt-6 flex flex-wrap gap-3">
          <PreviewTab
            href="/backoffice/email-preview?stage=24h"
            active={!isAdditionalCosts && stage === "24h"}
          >
            24-hour chase
          </PreviewTab>
          <PreviewTab
            href="/backoffice/email-preview?stage=72h"
            active={!isAdditionalCosts && stage === "72h"}
          >
            72-hour chase
          </PreviewTab>
          <PreviewTab
            href="/backoffice/email-preview?template=additional-costs"
            active={isAdditionalCosts}
          >
            Additional costs
          </PreviewTab>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
          <aside className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00eaff]">
              Message metadata
            </p>
            <dl className="mt-5 grid gap-4 text-sm">
              <MetaRow label="Signed in as" value={session.sub} />
              <MetaRow
                label="Template"
                value={
                  isAdditionalCosts
                    ? "Additional costs"
                    : stage === "24h"
                      ? "24-hour checkout recovery"
                      : "72-hour checkout recovery"
                }
              />
              <MetaRow label="From" value="sales@vchrgd.com" />
              <MetaRow label="Subject" value={email.subject} />
              <MetaRow label="Preview text" value={email.previewText} />
            </dl>

            <details className="mt-6 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-slate-950">
                Plain-text fallback
              </summary>
              <pre className="mt-4 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">
                {email.text}
              </pre>
            </details>

            <section className="mt-6 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00eaff]">
                Test send
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Sends this preview as a test email from the configured Gmail sender. This
                requires Google OIDC/Gmail env vars to be set and only works for the super admin.
                The additional-costs preview links use non-customer sample tokens.
              </p>
              {emailState.startsWith("sent:") ? (
                <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  Test email sent.
                </p>
              ) : null}
              {emailError ? (
                <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                  {emailError}
                </p>
              ) : null}
              <form
                action="/api/backoffice/email-preview/send-test"
                method="post"
                className="mt-4 grid gap-3"
              >
                <input type="hidden" name="stage" value={stage} />
                <input
                  type="hidden"
                  name="template"
                  value={isAdditionalCosts ? "additional-costs" : "checkout-recovery"}
                />
                <label className="block text-sm font-medium text-slate-700">
                  Test recipient
                  <input
                    type="email"
                    name="to"
                    required
                    placeholder="you@vchrgd.com"
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-[#00eaff] focus:ring-4 focus:ring-[#00eaff]/15"
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Send test email
                </button>
              </form>
            </section>
          </aside>

          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex flex-col gap-2 px-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00eaff]">
                  HTML preview
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em]">
                  Responsive email render
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-500">
                Resize the browser or use mobile device mode to check how the final
                email layout behaves.
              </p>
            </div>
            <iframe
              title={
                isAdditionalCosts
                  ? "Additional costs email preview"
                  : `${stage} checkout recovery email preview`
              }
              srcDoc={email.html}
              className="h-[900px] w-full rounded-[22px] border border-slate-200 bg-white"
            />
          </section>
        </section>
      </div>
    </main>
  );
}

function PreviewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-full border px-5 text-sm font-bold no-underline transition ${
        active
          ? "border-[#00d9ef] bg-[#00d9ef] text-slate-950"
          : "border-slate-200 bg-white text-slate-700 hover:border-[#00c7ef] hover:text-[#008fb5]"
      }`}
    >
      {children}
    </Link>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold leading-6 text-slate-950">
        {value}
      </dd>
    </div>
  );
}
