import { getProductSettings, type ProductDiscount, type ProductSettings } from "@/lib/product-settings";
import { CheckoutRequestError } from "@/lib/checkout-request";

export const normalizeVoucher = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
const pennies = (value: number) => Math.round(value * 100);

export function discountActive(discount: ProductDiscount, slug: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return discount.enabled && (discount.appliesTo === "all" || discount.appliesTo === slug) && (!discount.startsAt || discount.startsAt <= today) && (!discount.expiresAt || discount.expiresAt >= today);
}

export function publicProductSettings(settings: ProductSettings): ProductSettings {
  return { ...settings, discounts: settings.discounts.filter(item => item.kind === "SPECIAL_OFFER" && settings.chargers.some(charger => discountActive(item, charger.slug))).map(item => ({ ...item, code: undefined })) };
}

export function calculateCheckoutQuote(settings: ProductSettings, slug: unknown, voucherCode: unknown = "") {
  const charger = settings.chargers.find(item => item.slug === slug);
  if (!charger) throw new CheckoutRequestError("Please choose a valid charger.");
  if (typeof voucherCode !== "string" || voucherCode.length > 100) throw new CheckoutRequestError("Invalid voucher code.");
  const code = normalizeVoucher(voucherCode);
  const offers = settings.discounts.filter(item => item.kind === "SPECIAL_OFFER" && discountActive(item, charger.slug));
  const voucher = !offers.length && code ? settings.discounts.find(item => item.kind === "VOUCHER" && normalizeVoucher(item.code || "") === code && discountActive(item, charger.slug)) : undefined;
  const discounts = [...offers, ...(voucher ? [voucher] : [])];
  const totalBeforeDiscount = pennies(charger.installedPrice);
  const discountAmount = Math.min(totalBeforeDiscount, discounts.reduce((sum, item) => sum + pennies(item.amount), 0));
  const total = totalBeforeDiscount - discountAmount;
  if (![totalBeforeDiscount, discountAmount, total].every(Number.isSafeInteger) || totalBeforeDiscount <= 0) throw new CheckoutRequestError("This product is temporarily unavailable.", 503);
  return {
    charger, total: total / 100, totalBeforeDiscount: totalBeforeDiscount / 100, discountAmount: discountAmount / 100,
    discountCode: voucher?.code || "", discountLabel: discounts.map(item => item.label).join(" | "),
    voucher: voucher || null, invalidVoucher: Boolean(code && !offers.length && !voucher),
  };
}

export async function getCheckoutQuote(slug: unknown, code: unknown = "") {
  return calculateCheckoutQuote(await getProductSettings(), slug, code);
}

export function requireExpectedTotal(expected: number, submitted: unknown) {
  if (typeof submitted !== "number" || !Number.isFinite(submitted) || expected <= 0 || pennies(submitted) !== pennies(expected)) {
    throw new CheckoutRequestError("Your quote has changed. Please refresh the checkout to confirm the current price before paying.", 409);
  }
}
