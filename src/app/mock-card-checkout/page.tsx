import { redirect } from "next/navigation";
import { MockCardCheckoutClient } from "./mock-card-checkout-client";
import { getPaymentSessionByPaymentId } from "@/lib/frasers-plus-merchant-state";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

export default async function MockCardCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (!areMockPaymentRoutesEnabled()) {
    redirect("/");
  }

  const paymentId = typeof params.paymentId === "string" ? params.paymentId : "";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";

  if (!paymentId || !orderId) {
    redirect("/");
  }

  const session = await getPaymentSessionByPaymentId(paymentId);
  if (!session) {
    redirect("/");
  }

  return <MockCardCheckoutClient paymentId={paymentId} orderId={orderId} session={session} />;
}
