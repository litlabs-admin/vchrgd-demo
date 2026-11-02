import { redirect } from "next/navigation";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { verifyFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import {
  getSquareConfig,
  getSquareWebPaymentsScriptUrl,
  isSquareWebPaymentsConfigured,
} from "@/lib/square";
import { SquareCardCheckoutClient } from "./square-card-checkout-client";

type SquareCardPageProps = {
  searchParams: Promise<{
    paymentId?: string | string[];
    rt?: string | string[];
  }>;
};

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const acceptedMethods = [
  "Apple Pay",
  "Visa",
  "Mastercard",
  "Amex",
  "Discover",
  "JCB",
  "UnionPay",
];

function pick(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SquareCardPage({ searchParams }: SquareCardPageProps) {
  const params = await searchParams;
  const paymentId = pick(params.paymentId);
  const returnToken = pick(params.rt);

  if (!paymentId || !verifyFrasersPlusReturnToken(paymentId, returnToken)) {
    redirect("/");
  }

  const session = await getPaymentSessionByPaymentId(paymentId);
  if (!session || session.cardProcessor !== "SQUARE") {
    redirect("/");
  }

  const config = getSquareConfig();
  const amount = Number(session.amount ?? 0);
  const currency = session.currency || config.currency;
  const isConfigured = isSquareWebPaymentsConfigured();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#eef4f8_100%)] px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-[520px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.14)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00c7ef]">
              Secure card checkout
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.05em] text-slate-950">
              Pay by card
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">
              Square
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              Powered by Square
            </span>
          </div>
        </div>

        <div className="mt-6 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Amount to pay</p>
          <strong className="mt-2 block text-4xl font-bold tracking-[-0.05em] text-slate-950">
            {money.format(amount)}
          </strong>
          <p className="mt-3 break-all text-xs leading-5 text-slate-500">
            Order reference: {paymentId}
          </p>
        </div>

        <div className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Accepted payment methods
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Pay securely with Apple Pay or a major debit or credit card.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {acceptedMethods.map((method) => (
                <span
                  key={method}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700"
                >
                  {method}
                </span>
              ))}
            </div>
          </div>
        </div>

        {isConfigured ? (
          <SquareCardCheckoutClient
            applicationId={config.applicationId}
            locationId={config.locationId}
            scriptUrl={getSquareWebPaymentsScriptUrl()}
            paymentId={paymentId}
            returnToken={returnToken}
            amount={amount}
            currency={currency}
            customer={{
              firstName: session.customerName?.split(" ").slice(0, 1).join(" ") || "",
              lastName: session.customerName?.split(" ").slice(1).join(" ") || "",
              email: session.customerEmail || "",
              phone: session.customerPhone || "",
              billingAddress: session.billingAddress,
            }}
          />
        ) : (
          <div className="mt-6 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Square Web Payments is not fully configured. Check the Square application ID,
            access token, and location ID environment variables.
          </div>
        )}
      </div>
    </main>
  );
}
