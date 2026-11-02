import { NextResponse } from "next/server";
import { getAdminSession, isSuperAdminUsername } from "@/lib/admin-auth";
import { updateInstallerState, upsertInstaller } from "@/lib/installers";
import { isSameOriginRequest } from "@/lib/request-guards";

function redirectToInstallers(request: Request, state: string, error?: string) {
  const url = new URL("/backoffice", request.url);
  url.searchParams.set("tab", "installers");
  url.searchParams.set(error ? "installerError" : "installerState", error ?? state);
  return NextResponse.redirect(url, 303);
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function getNumber(formData: FormData, key: string) {
  return Number(getString(formData, key) || 0);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  if (!session?.sub || !(await isSuperAdminUsername(session.sub))) {
    return redirectToInstallers(request, "", "Only the super admin can manage installers.");
  }

  try {
    const formData = await request.formData();
    const action = getString(formData, "action");

    if (action === "upsert-installer") {
      await upsertInstaller({
        id: getString(formData, "installerId") || undefined,
        displayName: getString(formData, "displayName"),
        legalName: getString(formData, "legalName"),
        aliases: getString(formData, "aliases"),
        addressLine1: getString(formData, "addressLine1"),
        addressLine2: getString(formData, "addressLine2"),
        town: getString(formData, "town"),
        county: getString(formData, "county"),
        postcode: getString(formData, "postcode"),
        country: getString(formData, "country"),
        vatNumber: getString(formData, "vatNumber"),
        email: getString(formData, "email"),
        phone: getString(formData, "phone"),
        defaultNetAmount: getNumber(formData, "defaultNetAmount"),
        vatRate: getNumber(formData, "vatRate"),
        enabled: formData.get("enabled") === "on",
      });
      return redirectToInstallers(request, "installer");
    }

    if (action === "toggle-installer") {
      await updateInstallerState({
        id: getString(formData, "installerId"),
        enabled: formData.get("enabled") === "on",
      });
      return redirectToInstallers(request, "installer");
    }

    if (action === "delete-installer") {
      await updateInstallerState({
        id: getString(formData, "installerId"),
        delete: true,
      });
      return redirectToInstallers(request, "installer-deleted");
    }

    return redirectToInstallers(request, "", "Unsupported installer action.");
  } catch (error) {
    return redirectToInstallers(
      request,
      "",
      error instanceof Error ? error.message : "Unable to update installer directory.",
    );
  }
}
