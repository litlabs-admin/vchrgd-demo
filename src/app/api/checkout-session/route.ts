import { NextResponse } from "next/server";
import { createCheckoutAccess } from "@/lib/checkout-access";
import { isSameOriginMutationRequest } from "@/lib/request-guards";
import { checkoutErrorResponse, limitCheckoutRequests } from "@/lib/checkout-request";

export async function POST(request: Request) {
  if (!isSameOriginMutationRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    limitCheckoutRequests(`new:${request.headers.get("x-forwarded-for") || "unknown"}`, 30);
    // Never accept a caller-selected existing order reference here.
    return NextResponse.json(createCheckoutAccess(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return checkoutErrorResponse(error); }
}
