import { redirect } from "next/navigation";
import { safePaymentHandoffTarget } from "@/lib/payment-handoff-target";
import { HandoffClient } from "./handoff-client";

type HandoffPageProps = {
  searchParams: Promise<{
    target?: string | string[];
    paymentId?: string | string[];
    customerName?: string | string[];
    total?: string | string[];
    profile?: string | string[];
    autostart?: string | string[];
    mock?: string | string[];
    mockOutcome?: string | string[];
    sessionUpr?: string | string[];
    orderOverview?: string | string[];
  }>;
};

function pick(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function FrasersPlusHandoffPage({
  searchParams,
}: HandoffPageProps) {
  const params = await searchParams;
  const target = safePaymentHandoffTarget(pick(params.target));
  const autostart = pick(params.autostart);

  if (autostart === "1") {
    redirect(target);
  }

  return (
    <HandoffClient
      target={target}
      paymentId={pick(params.paymentId)}
      customerName={pick(params.customerName)}
      total={pick(params.total)}
      profile={pick(params.profile)}
      autostart={autostart}
      mock={pick(params.mock)}
      mockOutcome={pick(params.mockOutcome)}
      sessionUpr={pick(params.sessionUpr)}
      orderOverview={pick(params.orderOverview)}
    />
  );
}
