export const LANDING_EVENTS = {
  page_view: "Page views", page_engaged: "Engaged page views",
  checkout_hero: "Buy your Seven Pro — hero", checkout_header: "Choose your charger — header",
  checkout_product: "Choose charger — product", checkout_frasers: "Choose charger — Frasers Plus",
  checkout_card: "Choose charger — card payment", checkout_closing: "Choose charger — closing section",
  checkout_mobile: "Choose yours — mobile bar", frasers_explore: "Explore Frasers Plus plans",
  product_tethered: "Select tethered charger", product_untethered: "Select untethered charger",
  technical_open: "Open technical details", faq_open: "Open an FAQ",
  guide_click: "Open app user guide", frasers_info_click: "Open Frasers Plus information",
  octopus_click: "Open Octopus eligibility checker",
} as const;
export type LandingEvent = keyof typeof LANDING_EVENTS;
export type LandingPayload = { event: LandingEvent; pageId: string; eventId: string };
export function isLandingPayload(value: unknown): value is LandingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p=value as Record<string,unknown>,fields=["event","pageId","eventId"],uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return Object.keys(p).length===fields.length && fields.every(k=>Object.hasOwn(p,k)) && typeof p.event==="string" && Object.hasOwn(LANDING_EVENTS,p.event) &&
    [p.pageId,p.eventId].every(id=>typeof id==="string" && uuid.test(id));
}
