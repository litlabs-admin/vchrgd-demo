import { CHECKOUT_CLICK_EVENTS, type CheckoutClickEvent } from "@/lib/checkout-click-events";
import { incrementCheckoutClickCounter, readJsonFile } from "@/lib/server-data";

export const CHECKOUT_CLICK_START_DAY = "2026-09-17";

export function checkoutClickDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

export async function recordCheckoutClick(event: CheckoutClickEvent) {
  const day = checkoutClickDay();
  await incrementCheckoutClickCounter(day.slice(0, 7), `${day}:${event}`);
}

export async function getCheckoutClickSummary(days: 7 | 30 | 90 = 7, now = new Date()) {
  const today = checkoutClickDay(now);
  const dates = Array.from({ length: days }, (_, i) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - i);
    return date.toISOString().slice(0, 10);
  }).filter(day => day >= CHECKOUT_CLICK_START_DAY);
  const months = [...new Set(dates.map(day => day.slice(0, 7)))];
  const records = Object.assign({}, ...await Promise.all(months.map(month =>
    readJsonFile<Record<string, number>>(`checkout-clicks-${month}.json`, {})))) as Record<string, number>;
  const count = (day: string, event: CheckoutClickEvent) => {
    const value = records[`${day}:${event}`];
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  const events = (Object.keys(CHECKOUT_CLICK_EVENTS) as CheckoutClickEvent[]).map(event => ({
    event, label: CHECKOUT_CLICK_EVENTS[event], count: dates.reduce((sum, day) => sum + count(day, event), 0),
  }));
  return {
    days, from: dates.at(-1) ?? today, to: today, trackingStartedOn: CHECKOUT_CLICK_START_DAY, events,
    total: events.reduce((sum, item) => sum + item.count, 0),
    daily: dates.map(day => ({ day, count: events.reduce((sum, item) => sum + count(day, item.event), 0) })),
  };
}

export type CheckoutClickSummary = Awaited<ReturnType<typeof getCheckoutClickSummary>>;
