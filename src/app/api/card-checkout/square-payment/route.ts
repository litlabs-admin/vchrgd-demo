import { NextResponse } from "next/server";
import {
  mapPaymentStateToCheckoutInteractionStatus,
  updateCheckoutInteractionStatus,
} from "@/lib/checkout-interactions";
import {
  getPaymentSessionByPaymentId,
  updateCardCheckoutStatus,
} from "@/lib/frasers-plus-merchant-state";
import {
  createFrasersPlusReturnToken,
  verifyFrasersPlusReturnToken,
} from "@/lib/frasers-plus-return-token";
import {
  createSquarePayment,
  deriveSquarePaymentStatus,
  getSquareConfig,
  getSquareErrorMessage,
} from "@/lib/square";
import { isSameOriginMutationRequest } from "@/lib/request-guards";

type SquarePaymentRequest = {
  paymentId?: string;
  sourceId?: string;
  returnToken?: string;
  verificationToken?: string;
};

function buildCardReturnUrl(request: Request, paymentId: string, paymentReference: string) {
  const url = new URL("/card/return", request.url);
  url.searchParams.set("paymentId", paymentId);
  url.searchParams.set("payment_id", paymentReference);
  url.searchParams.set("order_id", paymentReference);
  url.searchParams.set("rt", createFrasersPlusReturnToken(paymentId));
  url.searchParams.set("card_payment", "success");
  return url.toString();
}

export async function POST(request: Request) {
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json()) as SquarePaymentRequest;
  const paymentId = payload.paymentId?.trim() ?? "";
  const sourceId = payload.sourceId?.trim() ?? "";
  const returnToken = payload.returnToken?.trim() ?? "";
  const verificationToken = payload.verificationToken?.trim() ?? "";

  if (!paymentId || !sourceId) {
    return NextResponse.json({ error: "Missing Square payment details." }, { status: 400 });
  }

  if (!verifyFrasersPlusReturnToken(paymentId, returnToken)) {
    return NextResponse.json({ error: "Invalid payment return token." }, { status: 403 });
  }

  const session = await getPaymentSessionByPaymentId(paymentId);
  if (!session || session.cardProcessor !== "SQUARE") {
    return NextResponse.json({ error: "Square payment session was not found." }, { status: 404 });
  }

  const amount = Number(session.amount ?? 0);
  if (amount <= 0) {
    return NextResponse.json({ error: "Square payment amount is invalid." }, { status: 400 });
  }

  const { response, data } = await createSquarePayment({
    sourceId,
    paymentId,
    amount,
    currency: session.currency || getSquareConfig().currency,
    customerEmail: session.customerEmail,
    note: `${session.chargerName || "VCHRGD installation"} (${paymentId})`,
    verificationToken,
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        error: getSquareErrorMessage(data, "Square did not approve this card payment."),
      },
      { status: response.status || 500 },
    );
  }

  const payment = data as { payment?: { id?: string; order_id?: string; status?: string } } | null;
  const paymentReference = payment?.payment?.id || session.providerPaymentReference || paymentId;
  const status = deriveSquarePaymentStatus(data);

  await updateCardCheckoutStatus({
    paymentId,
    providerPaymentReference: paymentReference,
    status,
  });

  const interactionStatus = mapPaymentStateToCheckoutInteractionStatus(status);
  if (interactionStatus) {
    await updateCheckoutInteractionStatus(
      paymentId,
      interactionStatus,
      interactionStatus === "PAYMENT_COMPLETED"
        ? "Customer completed the secure Square card payment."
        : "Square returned a non-completed card payment status.",
    );
  }

  return NextResponse.json({
    status,
    paymentReference,
    redirectUrl: buildCardReturnUrl(request, paymentId, paymentReference),
  });
}
