import { NextResponse } from "next/server";
import { getAdminSession, isAdminAuthConfigured } from "@/lib/admin-auth";
import {
  createGoogleAdminAuthorization,
  isGoogleAdminAuthConfigured,
} from "@/lib/google-admin-auth";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";

function redirectToLogin(request: Request, error: string) {
  const redirectUrl = new URL("/backoffice/login", request.url);
  redirectUrl.searchParams.set("error", error);
  return NextResponse.redirect(redirectUrl, 303);
}

export async function GET(request: Request) {
  const existingSession = await getAdminSession();
  if (existingSession) {
    return NextResponse.redirect(new URL("/backoffice", request.url), 303);
  }

  if (!(await isAdminAuthConfigured())) {
    return redirectToLogin(request, "unconfigured");
  }

  if (!isGoogleAdminAuthConfigured()) {
    await recordAdminAuditEvent({
      action: "admin.google_login_unconfigured",
      actor: "google",
      detail: "Google backoffice login was requested but OAuth credentials were not configured.",
    });
    return redirectToLogin(request, "google_unconfigured");
  }

  try {
    return NextResponse.redirect(await createGoogleAdminAuthorization(request), 303);
  } catch (error) {
    await recordAdminAuditEvent({
      action: "admin.google_login_start_failed",
      actor: "google",
      detail:
        error instanceof Error
          ? error.message
          : "Google backoffice login could not be started.",
    });
    return redirectToLogin(request, "google_failed");
  }
}
