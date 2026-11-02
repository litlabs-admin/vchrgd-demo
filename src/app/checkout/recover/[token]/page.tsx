import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getCheckoutInteractionByPaymentId,
  getCheckoutInteractionEffectiveStatus,
} from "@/lib/checkout-interactions";
import { verifyCheckoutRecoveryToken } from "@/lib/checkout-recovery-token";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { createCheckoutAccess, checkoutResumePath } from "@/lib/checkout-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckoutRecoveryPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function CheckoutRecoveryPage({ params }: CheckoutRecoveryPageProps) {
  const { token } = await params;
  const verified = verifyCheckoutRecoveryToken(token);

  if (!verified) {
    return <RecoveryUnavailable reason="This checkout link is no longer available." />;
  }

  const [session, interaction] = await Promise.all([
    getPaymentSessionByPaymentId(verified.paymentId),
    getCheckoutInteractionByPaymentId(verified.paymentId),
  ]);
  if (!session && !interaction) {
    return <RecoveryUnavailable reason="We could not find the saved checkout for this link." />;
  }

  const status = session?.latestStatus?.status?.toUpperCase();
  const interactionStatus = interaction
    ? getCheckoutInteractionEffectiveStatus(interaction)
    : null;
  if (
    status === "AUTHORISED" ||
    status === "AUTHORIZED" ||
    status === "COMPLETED" ||
    interactionStatus === "PAYMENT_COMPLETED"
  ) {
    return (
      <RecoveryUnavailable reason="This checkout has already been completed. If you need help, contact sales@vchrgd.com." />
    );
  }

  redirect(
    `${checkoutResumePath(createCheckoutAccess(verified.paymentId))}&recovered=1`,
  );
}

function RecoveryUnavailable({ reason }: { reason: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-10 text-slate-950">
      <section className="w-full max-w-xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
          Checkout recovery
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.05em]">
          Saved checkout unavailable
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">{reason}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/"
            style={{ color: "#ffffff" }}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold no-underline transition hover:bg-slate-800"
          >
            Start a new checkout
          </Link>
          <a
            href="mailto:sales@vchrgd.com"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 no-underline transition hover:border-[#00c7ef] hover:text-[#008fb5]"
          >
            Contact sales
          </a>
        </div>
      </section>
    </main>
  );
}
