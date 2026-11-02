import { NextResponse } from "next/server";
import {
  authenticateAdminCredentials,
  isAdminAuthConfigured,
  setAdminSessionCookieOnResponse,
} from "@/lib/admin-auth";
import {
  clearAdminLoginFailures,
  formatRemainingLockoutMs,
  getAdminAttemptKey,
  getAdminLoginAttemptState,
  registerAdminLoginFailure,
} from "@/lib/admin-security";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { isSameOriginRequest } from "@/lib/request-guards";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const totpCode = String(formData.get("totpCode") ?? "");
  const attemptKey = getAdminAttemptKey(request);
  const attemptState = await getAdminLoginAttemptState(attemptKey);

  if (!(await isAdminAuthConfigured())) {
    await recordAdminAuditEvent({
      action: "admin.login_blocked",
      actor: attemptKey,
      detail: "Backoffice login attempted before admin auth was configured.",
    });
    return NextResponse.redirect(new URL("/backoffice/login?error=unconfigured", request.url), 303);
  }

  if (attemptState.blocked) {
    await recordAdminAuditEvent({
      action: "admin.login_locked",
      actor: attemptKey,
      detail: `Backoffice login blocked during lockout window for ${formatRemainingLockoutMs(attemptState.remainingMs)}.`,
    });
    const redirectUrl = new URL("/backoffice/login", request.url);
    redirectUrl.searchParams.set(
      "error",
      `locked:${formatRemainingLockoutMs(attemptState.remainingMs)}`,
    );
    return NextResponse.redirect(redirectUrl, 303);
  }

  const identity = await authenticateAdminCredentials(username, password, totpCode);

  if (!identity) {
    const failureState = await registerAdminLoginFailure(attemptKey);
    await recordAdminAuditEvent({
      action: failureState.blocked ? "admin.login_locked" : "admin.login_failed",
      actor: attemptKey,
      detail: failureState.blocked
        ? `Backoffice login locked after repeated failed attempts for username ${username || "unknown"}.`
        : `Backoffice login failed for username ${username || "unknown"}.`,
    });
    const redirectUrl = new URL("/backoffice/login", request.url);
    redirectUrl.searchParams.set(
      "error",
      failureState.blocked
        ? `locked:${formatRemainingLockoutMs(failureState.remainingMs)}`
        : "invalid",
    );
    return NextResponse.redirect(redirectUrl, 303);
  }

  await clearAdminLoginFailures(attemptKey);
  await recordAdminAuditEvent({
    action: "admin.login_succeeded",
    actor: identity.username,
    detail: identity.mfaRequired
      ? `Backoffice login completed for ${identity.source} admin with password and TOTP.`
      : `Backoffice login completed for ${identity.source} admin with password only.`,
  });
  return setAdminSessionCookieOnResponse(
    NextResponse.redirect(new URL("/backoffice", request.url), 303),
    identity.username,
    identity.sessionVersion,
  );
}
