import { NextResponse } from "next/server";
import { reconcileCardPayments } from "@/lib/card-payment-reconciliation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.CARD_RECONCILIATION_CRON_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  return handleReconciliation(request);
}

export async function GET(request: Request) {
  return handleReconciliation(request);
}

async function handleReconciliation(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    const result = await reconcileCardPayments({
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reconcile card checkout payments.",
      },
      { status: 500 },
    );
  }
}
