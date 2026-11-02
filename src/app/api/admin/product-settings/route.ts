import { NextResponse } from "next/server";
import { getAdminSession, isSuperAdminUsername } from "@/lib/admin-auth";
import {
  createProductDiscount,
  generateVoucherCode,
  updateProductDiscount,
  updateProductPricing,
  type DiscountAppliesTo,
  type DiscountKind,
} from "@/lib/product-settings";
import { isSameOriginRequest } from "@/lib/request-guards";

function redirectToBackoffice(request: Request, state: string, error?: string) {
  const url = new URL("/backoffice", request.url);
  url.searchParams.set("tab", "products");
  url.searchParams.set(error ? "productError" : "productState", error ?? state);
  return NextResponse.redirect(url, 303);
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function getNumber(formData: FormData, key: string) {
  return Number(getString(formData, key) || 0);
}

function getOptionalNumber(formData: FormData, key: string) {
  if (!formData.has(key)) {
    return undefined;
  }

  return getNumber(formData, key);
}

function getAppliesTo(value: string): DiscountAppliesTo {
  return value === "seven-pro-tethered" || value === "seven-pro-untethered"
    ? value
    : "all";
}

function getKind(value: string): DiscountKind {
  return value === "VOUCHER" ? "VOUCHER" : "SPECIAL_OFFER";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getAdminSession();
  if (!session?.sub || !(await isSuperAdminUsername(session.sub))) {
    return redirectToBackoffice(request, "", "Only the super admin can update product settings.");
  }

  try {
    const formData = await request.formData();
    const action = getString(formData, "action");

    if (action === "update-pricing") {
      await updateProductPricing({
        tetheredInstalledPrice: getNumber(formData, "tetheredInstalledPrice"),
        untetheredInstalledPrice: getNumber(formData, "untetheredInstalledPrice"),
        cableRun10To20Amount: getOptionalNumber(formData, "cableRun10To20Amount"),
        cableRun10To20GuidanceText: getString(formData, "cableRun10To20GuidanceText"),
        cableRunOver20Amount: getOptionalNumber(formData, "cableRunOver20Amount"),
        cableRunOver20GuidanceText: getString(formData, "cableRunOver20GuidanceText"),
        streetParkingAmount: getOptionalNumber(formData, "streetParkingAmount"),
        streetParkingGuidanceText: getString(formData, "streetParkingGuidanceText"),
        flatApartmentAmount: getOptionalNumber(formData, "flatApartmentAmount"),
        flatApartmentGuidanceText: getString(formData, "flatApartmentGuidanceText"),
      });
      return redirectToBackoffice(request, "pricing");
    }

    if (action === "create-discount") {
      const kind = getKind(getString(formData, "kind"));
      await createProductDiscount({
        kind,
        label: getString(formData, "label"),
        code:
          kind === "VOUCHER"
            ? getString(formData, "code") || generateVoucherCode(getString(formData, "codePrefix"))
            : undefined,
        bannerContent: kind === "SPECIAL_OFFER" ? getString(formData, "bannerContent") : "",
        disclaimerContent: kind === "SPECIAL_OFFER" ? getString(formData, "disclaimerContent") : "",
        amount: getNumber(formData, "amount"),
        appliesTo: getAppliesTo(getString(formData, "appliesTo")),
        startsAt: getString(formData, "startsAt"),
        expiresAt: getString(formData, "expiresAt"),
        enabled: formData.get("enabled") === "on",
      });
      return redirectToBackoffice(request, kind === "VOUCHER" ? "voucher" : "offer");
    }

    if (action === "update-discount") {
      const kind = getKind(getString(formData, "kind"));
      await updateProductDiscount({
        id: getString(formData, "discountId"),
        label: getString(formData, "label"),
        code: kind === "VOUCHER" ? getString(formData, "code") : undefined,
        bannerContent: kind === "SPECIAL_OFFER" ? getString(formData, "bannerContent") : "",
        disclaimerContent: kind === "SPECIAL_OFFER" ? getString(formData, "disclaimerContent") : "",
        amount: getNumber(formData, "amount"),
        appliesTo: getAppliesTo(getString(formData, "appliesTo")),
        startsAt: getString(formData, "startsAt"),
        expiresAt: getString(formData, "expiresAt"),
        enabled: formData.get("enabled") === "on",
      });
      return redirectToBackoffice(request, "updated");
    }

    if (action === "toggle-discount") {
      await updateProductDiscount({
        id: getString(formData, "discountId"),
        enabled: formData.get("enabled") === "on",
      });
      return redirectToBackoffice(request, "discount");
    }

    if (action === "delete-discount") {
      await updateProductDiscount({
        id: getString(formData, "discountId"),
        delete: true,
      });
      return redirectToBackoffice(request, "deleted");
    }

    return redirectToBackoffice(request, "", "Unsupported product settings action.");
  } catch (error) {
    return redirectToBackoffice(
      request,
      "",
      error instanceof Error ? error.message : "Unable to update product settings.",
    );
  }
}
