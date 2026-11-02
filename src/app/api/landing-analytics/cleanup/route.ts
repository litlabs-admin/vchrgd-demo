import { timingSafeEqual } from "node:crypto";
import { cleanUpLandingAnalytics } from "@/lib/landing-analytics";
export const runtime = "nodejs";
export const maxDuration = 15;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  const headers = { "Cache-Control": "no-store" };
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response(null, { status: 401, headers });
  try { await cleanUpLandingAnalytics();return new Response(null, { status: 204, headers }); }
  catch { return new Response(null, { status: 503, headers }); }
}
