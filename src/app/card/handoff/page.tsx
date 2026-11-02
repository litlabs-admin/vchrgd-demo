import { redirect } from "next/navigation";
import { safePaymentHandoffTarget } from "@/lib/payment-handoff-target";
import { CardHandoffClient } from "./handoff-client";

type CardHandoffPageProps = {
  searchParams: Promise<{
    target?: string | string[];
    paymentId?: string | string[];
    customerName?: string | string[];
    total?: string | string[];
    chargerName?: string | string[];
    addressLine1?: string | string[];
    addressLine2?: string | string[];
    city?: string | string[];
    postalCode?: string | string[];
    country?: string | string[];
    propertyType?: string | string[];
    parkingType?: string | string[];
    cableRun?: string | string[];
    autostart?: string | string[];
  }>;
};

function pick(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CardHandoffPage({
  searchParams,
}: CardHandoffPageProps) {
  const params = await searchParams;
  const target = safePaymentHandoffTarget(pick(params.target));
  const autostart = pick(params.autostart);

  if (autostart === "1") {
    redirect(target);
  }

  return (
    <CardHandoffClient
      target={target}
      paymentId={pick(params.paymentId)}
      customerName={pick(params.customerName)}
      total={pick(params.total)}
      chargerName={pick(params.chargerName)}
      addressLine1={pick(params.addressLine1)}
      addressLine2={pick(params.addressLine2)}
      city={pick(params.city)}
      postalCode={pick(params.postalCode)}
      country={pick(params.country)}
      propertyType={pick(params.propertyType)}
      parkingType={pick(params.parkingType)}
      cableRun={pick(params.cableRun)}
      autostart={autostart}
    />
  );
}
