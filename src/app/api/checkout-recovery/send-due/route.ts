import { NextResponse } from "next/server";
import { sendDueCheckoutRecoveryEmails } from "@/lib/checkout-recovery-scheduler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.CHECKOUT_RECOVERY_CRON_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDueCheckoutRecoveryEmails({
      requestUrl: request.url,
      oidcToken: request.headers.get("x-vercel-oidc-token"),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to send due checkout recovery emails.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
