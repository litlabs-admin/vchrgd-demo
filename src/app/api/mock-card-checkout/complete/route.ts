import { NextResponse } from "next/server";
import { updateCheckoutInteractionStatus } from "@/lib/checkout-interactions";
import { updateCardCheckoutStatus } from "@/lib/frasers-plus-merchant-state";
import { createFrasersPlusReturnToken } from "@/lib/frasers-plus-return-token";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

export async function POST(request: Request) {
  if (!areMockPaymentRoutesEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const payload = (await request.json()) as {
    paymentId?: string;
    orderId?: string;
    decision?: "success" | "cancel";
  };

  if (!payload.paymentId || !payload.orderId) {
    return NextResponse.json({ error: "Missing paymentId or orderId." }, { status: 400 });
  }

  const success = payload.decision !== "cancel";
  await updateCardCheckoutStatus({
    paymentId: payload.paymentId,
    providerPaymentReference: payload.orderId,
    status: success ? "AUTHORISED" : "CANCELLED",
  });
  await updateCheckoutInteractionStatus(
    payload.paymentId,
    success ? "PAYMENT_COMPLETED" : "ABANDONED",
    success
      ? "Customer completed the secure Revolut Business checkout flow."
      : "Customer cancelled the secure Revolut Business checkout flow.",
  );

  return NextResponse.json({
    ok: true,
    redirectUrl: success
      ? `/card/return?paymentId=${encodeURIComponent(payload.paymentId)}&order_id=${encodeURIComponent(payload.orderId)}&rt=${encodeURIComponent(createFrasersPlusReturnToken(payload.paymentId))}&card_payment=success`
      : `/card/return?paymentId=${encodeURIComponent(payload.paymentId)}&order_id=${encodeURIComponent(payload.orderId)}&rt=${encodeURIComponent(createFrasersPlusReturnToken(payload.paymentId))}&card_payment=cancelled`,
  });
}
