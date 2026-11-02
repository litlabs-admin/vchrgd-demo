import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendDuePrebookingStageAlerts } from "@/lib/prebooking-stage-alerts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sendDuePrebookingStageAlerts({
      dryRun: new URL(request.url).searchParams.get("dryRun") === "true",
    });
    console.info("prebooking_stage_alerts", JSON.stringify(result));
    return NextResponse.json({ ok: result.failed === 0, ...result }, {
      status: result.failed ? 503 : 200, headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Stage alerts could not complete. Check configuration and datastore availability." }, { status: 503 });
  }
}
