"use client";

import type { MouseEvent } from "react";
import { isCheckoutClickEvent, type CheckoutClickEvent } from "@/lib/checkout-click-events";

export function trackCheckoutClick(event: CheckoutClickEvent) {
  // Analytics must never delay navigation, consume the popup gesture or break checkout.
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (privacy.globalPrivacyControl || navigator.doNotTrack === "1") return;
    if (!isCheckoutClickEvent(event)) return;
    const body = JSON.stringify({ event });
    void fetch("/api/checkout-clicks", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      keepalive: true, credentials: "omit", referrerPolicy: "no-referrer",
    }).catch(() => undefined);
  } catch {
    // Storage/network blockers are deliberately non-fatal to the customer journey.
  }
}

export function captureCheckoutClick(event: MouseEvent<HTMLElement>) {
  try {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>("[data-checkout-click]");
    if (!button || !event.currentTarget.contains(button)) return;
    const action = button.dataset.checkoutClick;
    if (isCheckoutClickEvent(action)) trackCheckoutClick(action);
  } catch {
    // Keep existing action handlers running even if analytics cannot inspect the click.
  }
}
