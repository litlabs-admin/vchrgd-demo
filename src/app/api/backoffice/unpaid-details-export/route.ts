import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getCheckoutInteractionEffectiveStatus,
  getCheckoutInteractionLossPoint,
  hasSubmittedCheckoutDetails,
  listCheckoutInteractions,
} from "@/lib/checkout-interactions";
import {
  listPaymentSessions,
  type PaymentSession,
} from "@/lib/frasers-plus-merchant-state";

const SUCCESSFUL_PAYMENT_STATUSES = new Set([
  "AUTHORISED",
  "AUTHORIZED",
  "APPROVED",
  "COMPLETED",
]);

function isSuccessfulPayment(payment?: PaymentSession) {
  const status = payment?.latestStatus?.status?.toUpperCase();
  return Boolean(status && SUCCESSFUL_PAYMENT_STATUSES.has(status));
}

function parseDateBound(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isWithinDateRange(value: string | null | undefined, from: number | null, to: number | null) {
  const timestamp = value ? Date.parse(value) : NaN;

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (from !== null && timestamp < from) {
    return false;
  }

  if (to !== null && timestamp > to) {
    return false;
  }

  return true;
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export async function GET(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  const url = new URL(request.url);
  const from = parseDateBound(url.searchParams.get("from"));
  const to = parseDateBound(url.searchParams.get("to"), true);

  const [interactions, payments] = await Promise.all([
    listCheckoutInteractions(),
    listPaymentSessions(),
  ]);
  const paymentById = new Map(payments.map((payment) => [payment.paymentId, payment]));

  const rows = interactions
    .filter((interaction) => hasSubmittedCheckoutDetails(interaction))
    .filter((interaction) => {
      const linkedPayment = paymentById.get(interaction.paymentId);
      return (
        !isSuccessfulPayment(linkedPayment) &&
        getCheckoutInteractionEffectiveStatus(interaction) !== "PAYMENT_COMPLETED"
      );
    })
    .filter((interaction) =>
      isWithinDateRange(interaction.detailsSubmittedAt ?? interaction.updatedAt, from, to),
    )
    .map((interaction) => {
      const linkedPayment = paymentById.get(interaction.paymentId);
      return {
        detailsSubmittedAt: interaction.detailsSubmittedAt ?? "",
        lastUpdatedAt: interaction.updatedAt,
        paymentId: interaction.paymentId,
        customerFirstName: interaction.customerFirstName ?? "",
        customerLastName: interaction.customerLastName ?? "",
        email: interaction.customerEmail ?? "",
        phone: interaction.customerPhone ?? "",
        charger: interaction.chargerName ?? "",
        estimatedTotal: interaction.total ?? "",
        paymentChoice: interaction.paymentChoice ?? "",
        interactionStatus: interaction.status,
        effectiveStatus: getCheckoutInteractionEffectiveStatus(interaction),
        lossPoint: getCheckoutInteractionLossPoint(interaction),
        paymentSessionStatus: linkedPayment?.latestStatus?.status ?? "NO_PAYMENT_SESSION",
        paymentProvider: linkedPayment?.provider ?? "",
        cardProcessor: linkedPayment?.cardProcessor ?? "",
        addressLine1: interaction.billingLine1 ?? "",
        addressLine2: interaction.billingLine2 ?? "",
        townOrCity: interaction.billingCity ?? "",
        postcode: interaction.billingPostalCode ?? "",
        country: interaction.billingCountry ?? "",
        propertyType: interaction.propertyType ?? "",
        parkingType: interaction.parkingType ?? "",
        cableRun: interaction.fuseBoxDistance ?? "",
        lastReason: interaction.lastReason ?? "",
      };
    });

  const headers = [
    "Details submitted at",
    "Last updated at",
    "Tracking reference",
    "First name",
    "Last name",
    "Email",
    "Phone",
    "Charger",
    "Estimated total",
    "Payment choice",
    "Interaction status",
    "Effective status",
    "Loss point",
    "Payment session status",
    "Payment provider",
    "Card processor",
    "Address line 1",
    "Address line 2",
    "Town or city",
    "Postcode",
    "Country",
    "Property type",
    "Parking type",
    "Cable run",
    "Last reason",
  ];

  const csv = [
    headers.map(csvValue).join(","),
    ...rows.map((row) =>
      [
        row.detailsSubmittedAt,
        row.lastUpdatedAt,
        row.paymentId,
        row.customerFirstName,
        row.customerLastName,
        row.email,
        row.phone,
        row.charger,
        row.estimatedTotal,
        row.paymentChoice,
        row.interactionStatus,
        row.effectiveStatus,
        row.lossPoint,
        row.paymentSessionStatus,
        row.paymentProvider,
        row.cardProcessor,
        row.addressLine1,
        row.addressLine2,
        row.townOrCity,
        row.postcode,
        row.country,
        row.propertyType,
        row.parkingType,
        row.cableRun,
        row.lastReason,
      ].map(csvValue).join(","),
    ),
  ].join("\r\n");

  const rangeLabel = `${url.searchParams.get("from") || "all"}-to-${url.searchParams.get("to") || "all"}`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="unpaid-customer-details-${rangeLabel}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
