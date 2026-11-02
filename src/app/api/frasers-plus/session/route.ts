import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getPaymentSessionByPaymentId,
  getPaymentSessionByUpr,
} from "@/lib/frasers-plus-merchant-state";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized payment session request" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const paymentId = searchParams.get("paymentId") ?? "";
  const upr = searchParams.get("upr") ?? "";

  const session =
    (paymentId ? await getPaymentSessionByPaymentId(paymentId) : undefined) ??
    (upr ? await getPaymentSessionByUpr(upr) : undefined);

  if (!session) {
    return NextResponse.json(
      { error: "Payment session not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(session);
}
