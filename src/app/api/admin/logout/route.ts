import { NextResponse } from "next/server";
import { clearAdminSessionCookieOnResponse, getAdminSession } from "@/lib/admin-auth";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { isSameOriginRequest } from "@/lib/request-guards";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  await recordAdminAuditEvent({
    action: "admin.logout",
    actor: session?.sub ?? "admin",
    detail: "Backoffice session cleared.",
  });
  return clearAdminSessionCookieOnResponse(
    NextResponse.redirect(new URL("/backoffice/login", request.url), 303),
  );
}
