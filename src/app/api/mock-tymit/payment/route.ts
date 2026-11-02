import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  MAGIC_PAYMENT_RESPONSES,
  MOCK_API_KEY,
  buildHistoryEntry,
  setStoredMockPayment,
  type DemoScenario,
  type MockPaymentRecord,
} from "@/lib/mock-tymit";
import { areMockPaymentRoutesEnabled } from "@/lib/mock-route-guards";

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized. Expected x-api-key: test-api-token" },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  if (!areMockPaymentRoutesEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (request.headers.get("x-api-key") !== MOCK_API_KEY) {
    return unauthorized();
  }

  const payload = await request.json();
  const origin = new URL(request.url).origin;
  const paymentId = payload?.paymentId as string | undefined;
  const customer = payload?.customer;
  const merchant = payload?.merchant;
  const paymentAmount = payload?.paymentAmount;

  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
  }

  const missingFields = [
    !payload?.type && "type",
    !payload?.method && "method",
    !payload?.mcc && "mcc",
    !customer?.id && "customer.id",
    !customer?.firstName && "customer.firstName",
    !customer?.lastName && "customer.lastName",
    !customer?.phone && "customer.phone",
    !customer?.email && "customer.email",
    !customer?.billingAddress?.line1 && "customer.billingAddress.line1",
    !customer?.billingAddress?.city && "customer.billingAddress.city",
    !customer?.billingAddress?.country && "customer.billingAddress.country",
    !customer?.billingAddress?.postalCode && "customer.billingAddress.postalCode",
    !customer?.deliveryAddress?.line1 && "customer.deliveryAddress.line1",
    !customer?.deliveryAddress?.city && "customer.deliveryAddress.city",
    !customer?.deliveryAddress?.country && "customer.deliveryAddress.country",
    !customer?.deliveryAddress?.postalCode && "customer.deliveryAddress.postalCode",
    !merchant?.id && "merchant.id",
    !merchant?.name && "merchant.name",
    !merchant?.redirectUrl && "merchant.redirectUrl",
    paymentAmount?.amount === undefined && "paymentAmount.amount",
    !paymentAmount?.currency && "paymentAmount.currency",
    !payload?.description && "description",
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missingFields.join(", ")}` },
      { status: 400 },
    );
  }

  const magic = MAGIC_PAYMENT_RESPONSES[paymentId];
  if (magic?.status === 500) {
    return NextResponse.json(
      { error: "Mock API internal server error" },
      { status: 500 },
    );
  }

  if (magic?.status === 400) {
    return NextResponse.json({ error: magic.message }, { status: 400 });
  }

  const uniquePaymentReference = randomUUID();
  const amount = Number(payload?.paymentAmount?.amount ?? 0);
  const currency = String(payload?.paymentAmount?.currency ?? "GBP");
  const scenario = (payload?.metadata?.scenario ?? "approved") as DemoScenario;
  const sandboxProfile = String(payload?.metadata?.sandboxProfile ?? "fast-track");
  const merchantRedirectUrl = String(merchant.redirectUrl);
  const hppUrl = new URL(`${origin}/frasers-plus/handoff`);
  hppUrl.searchParams.set("mock", "1");
  hppUrl.searchParams.set("target", merchantRedirectUrl);
  hppUrl.searchParams.set("mockOutcome", scenario);
  hppUrl.searchParams.set("profile", sandboxProfile);
  hppUrl.searchParams.set("sessionUpr", uniquePaymentReference);
  hppUrl.searchParams.set("paymentId", paymentId);
  hppUrl.searchParams.set(
    "customerName",
    `${payload?.customer?.firstName ?? "EV"} ${payload?.customer?.lastName ?? "Customer"}`.trim(),
  );
  hppUrl.searchParams.set("customerEmail", String(customer.email));
  hppUrl.searchParams.set("customerPhone", String(customer.phone));
  hppUrl.searchParams.set(
    "chargerName",
    String(payload?.description ?? "EV charger installation"),
  );
  hppUrl.searchParams.set("total", String(amount));
  if (typeof payload?.metadata?.orderOverviewPath === "string" && payload.metadata.orderOverviewPath) {
    hppUrl.searchParams.set("orderOverview", String(payload.metadata.orderOverviewPath));
  }

  const record: MockPaymentRecord = {
    uniquePaymentReference,
    paymentId,
    redirectUrl: hppUrl.toString(),
    merchantRedirectUrl,
    amount,
    currency,
    customerName: `${payload?.customer?.firstName ?? "EV"} ${payload?.customer?.lastName ?? "Customer"}`.trim(),
    customerEmail: String(customer.email),
    customerPhone: String(customer.phone),
    charger: String(payload?.description ?? "EV charger installation"),
    scenario,
    sandboxProfile,
    status: scenario === "declined" ? "DECLINED" : "PENDING",
    currentType: "AUTHORIZATION",
    pollCount: 0,
    authorizationMethod: String(payload?.method ?? "ONLINE"),
    mcc: String(payload?.mcc ?? ""),
    basketTimestamp: payload?.basketTimestamp as string | undefined,
    expiresAt: payload?.expiresAt as string | undefined,
    metadata: payload?.metadata as Record<string, string> | undefined,
    history: [
      buildHistoryEntry(
        "AUTHORIZATION",
        scenario === "declined" ? "DECLINED" : "PENDING",
        amount,
        currency,
      ),
    ],
  };

  await setStoredMockPayment(record);

  return NextResponse.json({
    uniquePaymentReference,
    redirectUrl: record.redirectUrl,
    status: record.status,
  });
}
