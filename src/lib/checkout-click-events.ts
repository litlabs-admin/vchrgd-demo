export const CHECKOUT_CLICK_EVENTS = {
  charger_tethered: "Select tethered charger",
  charger_untethered: "Select untethered charger",
  continue_selection: "Continue from charger selection",
  continue_property: "Continue from property",
  continue_parking: "Continue from parking",
  continue_cable: "Continue from cable run",
  continue_details: "Continue from customer details",
  navigation_back: "Back to a previous step",
  payment_card: "Choose card payment",
  payment_frasers: "Choose Frasers Plus",
  card_continue: "Continue to card checkout",
  frasers_continue: "Continue with Frasers Plus",
  payment_options_back: "Back to payment options",
  frasers_eligibility: "Popup: check eligibility",
  frasers_popup_close: "Popup: close button",
} as const;

export type CheckoutClickEvent = keyof typeof CHECKOUT_CLICK_EVENTS;
export function isCheckoutClickEvent(value: unknown): value is CheckoutClickEvent {
  return typeof value === "string" && Object.hasOwn(CHECKOUT_CLICK_EVENTS, value);
}

export const CONTINUE_CLICK_EVENTS: Partial<Record<number, CheckoutClickEvent>> = {
  1: "continue_selection", 2: "continue_property", 3: "continue_parking",
  4: "continue_cable", 5: "continue_details",
};
