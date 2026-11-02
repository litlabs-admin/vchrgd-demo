import { NextResponse } from "next/server";
import {
  MAGIC_GET_REFERENCES,
  MAGIC_PUT_REFERENCES,
  MOCK_API_KEY,
  buildHistoryEntry,
  buildMagicRecord,
  getStoredMockPayment,
  setStoredMockPayment,
  type PaymentStatus,
  type PaymentType,
} from "@/lib/mock-tymit";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized. Expected x-api-key: test-api-token" },
    { status: 401 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ upr: string }> },
) {
  if (!areMockPaymentRoutesEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (request.headers.get("x-api-key") !== MOCK_API_KEY) {
    return unauthorized();
  }

  const { upr } = await context.params;
  if (!upr) {
    return NextResponse.json({ error: "Missing uniquePaymentReference" }, { status: 404 });
  }

  if (upr in MAGIC_GET_REFERENCES) {
    return NextResponse.json(buildMagicRecord(upr));
  }

  const record = await getStoredMockPayment(upr);
  if (!record) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (record.currentType === "AUTHORIZATION" && record.status === "PENDING") {
    record.pollCount += 1;

    if (record.scenario === "approved" && record.pollCount >= 2) {
      record.status = "APPROVED";
      record.history.push(
        buildHistoryEntry("AUTHORIZATION", "APPROVED", record.amount, record.currency),
      );
    }

    await setStoredMockPayment(record);
  }

  return NextResponse.json(record);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ upr: string }> },
) {
  if (!areMockPaymentRoutesEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (request.headers.get("x-api-key") !== MOCK_API_KEY) {
    return unauthorized();
  }

  const { upr } = await context.params;
  const payload = await request.json();
  const type = payload?.type as PaymentType | undefined;

  if (!upr) {
    return NextResponse.json({ error: "Missing uniquePaymentReference" }, { status: 404 });
  }

  if (upr === "ac04b35a-f851-45f7-bc14-e47750207a0c") {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (upr === "605a7057-8285-45a5-abf1-4d104a6b7547" && type === "AUTHORIZATION") {
    return NextResponse.json(
      { error: "AUTHORIZATION already created for this payment" },
      { status: 400 },
    );
  }

  if (upr in MAGIC_PUT_REFERENCES) {
    const nextType = MAGIC_PUT_REFERENCES[upr as keyof typeof MAGIC_PUT_REFERENCES];
    const nextStatus: PaymentStatus = nextType === "REVERSAL" ? "CANCELLED" : "COMPLETED";

    return NextResponse.json({
      ...buildMagicRecord(upr),
      currentType: nextType,
      status: nextStatus,
      history: [buildHistoryEntry(nextType, nextStatus, 1349, "GBP")],
    });
  }

  const record = await getStoredMockPayment(upr);
  if (!record) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (!type) {
    return NextResponse.json({ error: "Missing type" }, { status: 400 });
  }

  if (type === "CAPTURE" && record.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Payment must be APPROVED before CAPTURE" },
      { status: 409 },
    );
  }

  if (type === "CREDIT" && record.currentType !== "CAPTURE") {
    return NextResponse.json(
      { error: "CREDIT can happen only after CAPTURE" },
      { status: 409 },
    );
  }

  if (type === "REVERSAL" && record.currentType !== "AUTHORIZATION") {
    return NextResponse.json(
      { error: "REVERSAL is only available after AUTHORIZATION" },
      { status: 409 },
    );
  }

  const amount = Number(payload?.paymentAmount?.amount ?? record.amount);
  const currency = String(payload?.paymentAmount?.currency ?? record.currency);
  const nextStatus: PaymentStatus = type === "REVERSAL" ? "CANCELLED" : "COMPLETED";

  record.currentType = type;
  record.status = nextStatus;
  record.amount = amount;
  record.currency = currency;
  record.history.push(buildHistoryEntry(type, nextStatus, amount, currency));
  await setStoredMockPayment(record);

  return NextResponse.json(record);
}
