import { NextResponse } from "next/server";
import {
  mapPaymentStateToCheckoutInteractionStatus,
  updateCheckoutInteractionStatus,
} from "@/lib/checkout-interactions";
import {
  getPaymentSessionByPaymentId,
  getPaymentSessionByProviderPaymentReference,
  updateCardCheckoutStatus,
} from "@/lib/frasers-plus-merchant-state";
import { processCompletedCardPayment } from "@/lib/card-payment-completion";
import {
  deriveRevolutCardStatus,
  mapRevolutOrderStateToCardStatus,
  normaliseRevolutWebhookEvent,
  retrieveRevolutOrder,
  verifyRevolutWebhookSignature,
} from "@/lib/revolut";
import { releaseDedupeKey, tryReserveDedupeKey } from "@/lib/server-data";

export async function POST(request: Request) {
  const signature = request.headers.get("Revolut-Signature") ?? "";
  const timestamp = request.headers.get("Revolut-Request-Timestamp") ?? "";
  const body = await request.text();

  if (!verifyRevolutWebhookSignature(body, signature, timestamp)) {
    return NextResponse.json({ error: "Revolut webhook verification failed." }, { status: 400 });
  }

  let reservedEventKey: string | null = null;

  try {
    const rawPayload = JSON.parse(body) as unknown;
    const event = normaliseRevolutWebhookEvent(rawPayload);

    if (!event?.order_id) {
      return NextResponse.json({ received: true });
    }

    const eventKey = `${event.event}:${event.order_id}`;
    const reserved = await tryReserveDedupeKey("revolut-webhook-event", eventKey);
    if (!reserved) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    reservedEventKey = eventKey;

    const { response, data } = await retrieveRevolutOrder(event.order_id);
    if (!response.ok) {
      await releaseDedupeKey("revolut-webhook-event", eventKey);
      return NextResponse.json({ error: "Unable to reconcile Revolut order." }, { status: 502 });
    }

    const status =
      data && typeof data === "object"
        ? deriveRevolutCardStatus(data)
        : mapRevolutOrderStateToCardStatus(undefined);
    const paymentId =
      event.merchant_order_ext_ref ||
      (data &&
      typeof data === "object" &&
      "merchant_order_data" in data &&
      data.merchant_order_data &&
      typeof data.merchant_order_data === "object" &&
      "reference" in data.merchant_order_data &&
      typeof data.merchant_order_data.reference === "string"
        ? data.merchant_order_data.reference
        : undefined) ||
      (await getPaymentSessionByProviderPaymentReference(event.order_id))?.paymentId;

    if (!paymentId) {
      await releaseDedupeKey("revolut-webhook-event", eventKey);
      return NextResponse.json(
        { error: "Unable to match Revolut order to a VCHRGD payment." },
        { status: 422 },
      );
    }

    const updatedSession = await updateCardCheckoutStatus({
      paymentId,
      providerPaymentReference: event.order_id,
      status,
    });
    if (updatedSession?.latestStatus?.status === "REFUNDED") {
      return NextResponse.json({ received: true, ignored: "Payment already refunded" });
    }

    const interactionStatus =
      status === "COMPLETED"
        ? "PAYMENT_COMPLETED"
        : status === "AUTHORISED"
          ? "PAYMENT_PENDING"
          : mapPaymentStateToCheckoutInteractionStatus(status);
    if (interactionStatus) {
      await updateCheckoutInteractionStatus(
        paymentId,
        interactionStatus,
        status === "COMPLETED"
          ? "Revolut confirmed the card payment was captured."
          : status === "AUTHORISED"
            ? "Revolut authorised the card payment and automatic capture is pending."
          : status === "CANCELLED"
            ? "Revolut Business checkout was cancelled before completion."
            : "Revolut Business sent an updated payment status.",
      );
    }

    if (status === "COMPLETED") {
      const session = await getPaymentSessionByPaymentId(paymentId);
      if (session) {
        await processCompletedCardPayment(session, "Revolut");
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    if (reservedEventKey) {
      await releaseDedupeKey("revolut-webhook-event", reservedEventKey);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to process Revolut webhook.",
      },
      { status: 400 },
    );
  }
}
