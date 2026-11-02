import { HppClient } from "./hpp-client";
import type { PaymentSession } from "@/lib/frasers-plus-merchant-state";
import { getPaymentSessionByUpr } from "@/lib/frasers-plus-merchant-state";
import { redirect as redirectTo } from "next/navigation";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

export default async function MockHppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (!areMockPaymentRoutesEnabled()) {
    redirectTo("/");
  }

  const upr = typeof params.upr === "string" ? params.upr : "";
  const redirectTarget = typeof params.redirect === "string" ? params.redirect : "/frasers-plus/return";
  const scenario = typeof params.scenario === "string" ? params.scenario : "approved";
  const profile = typeof params.profile === "string" ? params.profile : "fast-track";
  const paymentId = typeof params.paymentId === "string" ? params.paymentId : "";
  const customerName = typeof params.customerName === "string" ? params.customerName : "";
  const customerEmail = typeof params.customerEmail === "string" ? params.customerEmail : "";
  const customerPhone = typeof params.customerPhone === "string" ? params.customerPhone : "";
  const chargerName = typeof params.chargerName === "string" ? params.chargerName : "";
  const orderOverview = typeof params.orderOverview === "string" ? params.orderOverview : "";
  const amount =
    typeof params.amount === "string" && Number.isFinite(Number(params.amount))
      ? Number(params.amount)
      : undefined;

  const sessionFromQuery: PaymentSession | undefined =
    paymentId || customerName || customerEmail || customerPhone || chargerName || amount !== undefined
      ? {
          paymentId: paymentId || `VCHRGD-DEMO-${upr.slice(0, 8).toUpperCase()}`,
          provider: "FRASERS_PLUS",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uniquePaymentReference: upr,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          customerPhone: customerPhone || undefined,
          chargerName: chargerName || undefined,
          amount,
        }
      : undefined;
  const session = sessionFromQuery ?? (upr ? await getPaymentSessionByUpr(upr) : undefined);

  return (
    <HppClient
      upr={upr}
      redirect={redirectTarget}
      scenario={scenario}
      profile={profile}
      session={session}
      orderOverview={orderOverview}
    />
  );
}
