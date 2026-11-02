import { NextResponse } from "next/server";
import {
  getAdminSession,
  getBootstrapAdminSummary,
  isAdminAuthenticated,
  isSuperAdminUsername,
} from "@/lib/admin-auth";
import {
  createManagedAdminUser,
  getManagedAdminUserById,
  rotateManagedAdminUserPassword,
  rotateManagedAdminUserTotpSecret,
  updateManagedAdminUserAccess,
} from "@/lib/admin-users";
import { recordAdminAuditEvent } from "@/lib/frasers-plus-merchant-state";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";

function redirectToAccess(request: Request, returnTo?: string | null, state?: string, error?: string) {
  const fallback = new URL("/backoffice?tab=access", request.url);
  if (state) {
    fallback.searchParams.set("accessState", state);
  }
  if (error) {
    fallback.searchParams.set("accessError", error);
  }

  return NextResponse.redirect(getSafeInternalRedirect(request, returnTo, fallback.pathname + fallback.search), 303);
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isAdminAuthenticated())) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url), 303);
  }

  const session = await getAdminSession();
  const actor = session?.sub || "backoffice-admin";
  if (!(await isSuperAdminUsername(actor))) {
    await recordAdminAuditEvent({
      action: "admin.user_update_blocked",
      actor,
      detail: "Managed admin access changes were blocked because the current user is not the super admin.",
    });
    return redirectToAccess(request, undefined, undefined, "Only a super admin can manage admin users.");
  }

  const formData = await request.formData();
  const action = String(formData.get("action") || "");
  const returnTo = String(formData.get("returnTo") || "");

  try {
    if (action === "create-user") {
      const username = String(formData.get("username") || "");
      const bootstrap = getBootstrapAdminSummary();
      if (bootstrap && normalizeUsername(bootstrap.username) === normalizeUsername(username)) {
        throw new Error("That username is reserved by the bootstrap admin account.");
      }

      const result = await createManagedAdminUser({
        username,
        password: String(formData.get("password") || ""),
        role: formData.get("role") === "super-admin" ? "super-admin" : "admin",
        mfaRequired: formData.get("mfaRequired") === "on",
        enabled: formData.get("enabled") !== "off",
        actor,
      });

      await recordAdminAuditEvent({
        action: "admin.user_created",
        actor,
        detail: `Managed admin user ${result.user.username} was created as ${result.user.role === "super-admin" ? "super admin" : "admin"}${result.user.mfaRequired ? " with MFA required" : ""}.`,
      });

      return redirectToAccess(request, returnTo, `created:${result.user.id}`);
    }

    if (action === "update-user") {
      const userId = String(formData.get("userId") || "");
      const role = formData.get("role") === "super-admin" ? "super-admin" : "admin";
      const enabled = formData.get("enabled") === "on";
      const targetUser = await getManagedAdminUserById(userId);

      if (targetUser && normalizeUsername(targetUser.username) === normalizeUsername(actor) && (!enabled || role !== "super-admin")) {
        throw new Error("You cannot remove your own super admin access.");
      }

      const result = await updateManagedAdminUserAccess({
        userId,
        role,
        enabled,
        mfaRequired: formData.get("mfaRequired") === "on",
        actor,
      });

      await recordAdminAuditEvent({
        action: "admin.user_updated",
        actor,
        detail: `Managed admin user ${result.user.username} access settings were updated as ${result.user.role === "super-admin" ? "super admin" : "admin"}.`,
      });

      return redirectToAccess(request, returnTo, `updated:${result.user.id}`);
    }

    if (action === "reset-password") {
      const userId = String(formData.get("userId") || "");
      const user = await rotateManagedAdminUserPassword({
        userId,
        password: String(formData.get("password") || ""),
        actor,
      });

      await recordAdminAuditEvent({
        action: "admin.user_password_rotated",
        actor,
        detail: `Managed admin user ${user.username} password was reset.`,
      });

      return redirectToAccess(request, returnTo, `password:${user.id}`);
    }

    if (action === "rotate-mfa") {
      const userId = String(formData.get("userId") || "");
      const result = await rotateManagedAdminUserTotpSecret({
        userId,
        actor,
      });

      await recordAdminAuditEvent({
        action: "admin.user_mfa_rotated",
        actor,
        detail: `Managed admin user ${result.user.username} MFA secret was rotated.`,
      });

      return redirectToAccess(request, returnTo, `mfa:${result.user.id}`);
    }

    return redirectToAccess(request, returnTo);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "We could not update the admin user settings.";

    await recordAdminAuditEvent({
      action: "admin.user_update_failed",
      actor,
      detail: message,
    });

    return redirectToAccess(request, returnTo, undefined, message);
  }
}
