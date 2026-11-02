import { NextResponse } from "next/server";
import { setAdminSessionCookieOnResponse } from "@/lib/admin-auth";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { consumeGoogleAdminAuthorization } from "@/lib/google-admin-auth";

function redirectToLogin(request: Request, error: string) {
  const redirectUrl = new URL("/backoffice/login", request.url);
  redirectUrl.searchParams.set("error", error);
  return NextResponse.redirect(redirectUrl, 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    await recordAdminAuditEvent({
      action: "admin.google_login_cancelled",
      actor: "google",
      detail: `Google backoffice login returned ${oauthError}.`,
    });
    return redirectToLogin(request, "google_cancelled");
  }

  try {
    const result = await consumeGoogleAdminAuthorization(request);
    await recordAdminAuditEvent({
      action: "admin.google_login_succeeded",
      actor: result.identity.username,
      detail: `Backoffice login completed with Google for ${result.identity.source} admin ${result.identity.googleEmail}.`,
    });
    return setAdminSessionCookieOnResponse(
      NextResponse.redirect(new URL(result.returnTo, request.url), 303),
      result.identity.username,
    );
  } catch (error) {
    await recordAdminAuditEvent({
      action: "admin.google_login_failed",
      actor: "google",
      detail:
        error instanceof Error
          ? error.message
          : "Google backoffice login failed.",
    });
    return redirectToLogin(request, "google_invalid");
  }
}
