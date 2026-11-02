import { NextResponse } from "next/server";
import { BalanceCheckoutError, startOrResumeBalanceCheckout } from "@/lib/balance-checkout";
import { isSameOriginRequest } from "@/lib/request-guards";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const formData = await request.formData();
  const token = String(formData.get("token") || "");
  const method = String(formData.get("method") || "card");
  if (!token) return NextResponse.redirect(new URL("/", request.url), 303);
  if (method !== "card" && method !== "frasers-plus") return NextResponse.json({ error: "Unsupported payment method." }, { status: 400 });
  try {
    const redirectUrl = await startOrResumeBalanceCheckout(new URL(request.url).origin, token, method);
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BalanceCheckoutError ? error.message : "Unable to prepare balance checkout. No second payment should be started until its outcome is checked." },
      { status: error instanceof BalanceCheckoutError ? error.status : 503 });
  }
}
