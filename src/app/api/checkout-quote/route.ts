import { NextResponse } from "next/server";
import { getCheckoutQuote } from "@/lib/checkout-pricing";
import { checkoutErrorResponse, limitCheckoutRequests, readCheckoutJson, requireCheckoutAccess } from "@/lib/checkout-request";
import { isSameOriginMutationRequest } from "@/lib/request-guards";

export async function POST(request: Request) {
  if (!isSameOriginMutationRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const payload = await readCheckoutJson<{ paymentId: string; slug: string; code?: string }>(request);
    requireCheckoutAccess(request, payload.paymentId);
    limitCheckoutRequests(`quote:${payload.paymentId}`, 30);
    const quote = await getCheckoutQuote(payload.slug, payload.code);
    return NextResponse.json({ total: quote.total, voucher: quote.voucher, invalidVoucher: quote.invalidVoucher }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return checkoutErrorResponse(error); }
}
