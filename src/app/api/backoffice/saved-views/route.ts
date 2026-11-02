import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import {
  BACKOFFICE_ORDER_FILTER_KEYS,
  deleteBackofficeSavedView,
  saveBackofficeSavedView,
} from "@/lib/backoffice-saved-views";
import { getSafeInternalRedirect, isSameOriginRequest } from "@/lib/request-guards";

function redirectToOrders(request: Request, returnTo: string, state: string, error?: string) {
  const url = getSafeInternalRedirect(request, returnTo, "/backoffice");
  url.searchParams.set(error ? "viewError" : "viewState", error ?? state);
  return NextResponse.redirect(url, 303);
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  if (!session?.sub) {
    return redirectToOrders(request, "", "", "Your admin session has expired.");
  }

  try {
    const formData = await request.formData();
    const action = getString(formData, "action");
    const returnTo = getString(formData, "returnTo");

    if (action === "save") {
      const filters = Object.fromEntries(
        BACKOFFICE_ORDER_FILTER_KEYS.map((key) => [key, getString(formData, key)]),
      );
      await saveBackofficeSavedView({
        owner: session.sub,
        name: getString(formData, "viewName"),
        filters,
      });
      return redirectToOrders(request, returnTo, "saved");
    }

    if (action === "delete") {
      const deleted = await deleteBackofficeSavedView(session.sub, getString(formData, "viewId"));
      return redirectToOrders(request, returnTo, deleted ? "deleted" : "missing");
    }

    return redirectToOrders(request, returnTo, "", "Unsupported saved-view action.");
  } catch (error) {
    return redirectToOrders(
      request,
      "",
      "",
      error instanceof Error ? error.message : "Unable to update the saved view.",
    );
  }
}
