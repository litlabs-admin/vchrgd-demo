import { NextResponse } from "next/server";
import {
  buildHistoryEntry,
  getStoredMockPayment,
  setStoredMockPayment,
  type PaymentStatus,
} from "@/lib/mock-tymit";
import { storeAuthorizationWebhookEvent } from "@/lib/frasers-plus-merchant-state";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

export async function POST(
  request: Request,
  context: { params: Promise<{ upr: string }> },
) {
  if (!areMockPaymentRoutesEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { upr } = await context.params;
  const payload = await request.json();
  const decision = payload?.decision as "approved" | "declined" | "pending" | undefined;

  if (!upr || !decision) {
    return NextResponse.json({ error: "Missing upr or decision" }, { status: 400 });
  }

  const record = await getStoredMockPayment(upr);
  if (!record) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const nextStatus: PaymentStatus =
    decision === "approved"
      ? "APPROVED"
      : decision === "declined"
        ? "DECLINED"
        : "PENDING";

  record.scenario = decision;
  record.status = nextStatus;
  record.currentType = "AUTHORIZATION";
  record.history.push(
    buildHistoryEntry("AUTHORIZATION", nextStatus, record.amount, record.currency),
  );

  if (nextStatus !== "PENDING") {
    await storeAuthorizationWebhookEvent({
      uniquePaymentReference: record.uniquePaymentReference,
      type: "AUTHORIZATION",
      status: nextStatus,
      paymentAmount: {
        amount: record.amount,
        currency: record.currency,
      },
      actionDate: new Date().toISOString(),
      metadata: {
        ...(record.metadata ?? {}),
        paymentId: record.paymentId,
      },
      raw: {
        uniquePaymentReference: record.uniquePaymentReference,
        type: "AUTHORIZATION",
        status: nextStatus,
        paymentAmount: {
          amount: record.amount,
          currency: record.currency,
        },
        metadata: {
          ...(record.metadata ?? {}),
          paymentId: record.paymentId,
        },
      },
    });
  }

  await setStoredMockPayment(record);

  return NextResponse.json({
    uniquePaymentReference: record.uniquePaymentReference,
    merchantRedirectUrl: record.merchantRedirectUrl,
    status: record.status,
  });
}
