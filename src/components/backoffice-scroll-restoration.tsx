"use client";

import { useEffect } from "react";

const SCROLL_KEY = "vchrgd:backoffice-scroll";
const MAX_AGE_MS = 60_000;

type StoredScroll = {
  x: number;
  y: number;
  savedAt: number;
};

function storeScrollPosition() {
  try {
    const payload: StoredScroll = {
      x: window.scrollX,
      y: window.scrollY,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(payload));
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }
}

function restoreScrollPosition() {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (!raw) {
      return;
    }

    sessionStorage.removeItem(SCROLL_KEY);
    const payload = JSON.parse(raw) as Partial<StoredScroll>;
    if (
      typeof payload.x !== "number" ||
      typeof payload.y !== "number" ||
      typeof payload.savedAt !== "number" ||
      Date.now() - payload.savedAt > MAX_AGE_MS
    ) {
      return;
    }

    const restore = () => {
      window.scrollTo({
        left: payload.x,
        top: Math.max(0, payload.y ?? 0),
        behavior: "instant",
      });
    };

    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 120);
    window.setTimeout(restore, 320);
  } catch {
    sessionStorage.removeItem(SCROLL_KEY);
  }
}

function isBackofficeHref(href: string | null) {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/backoffice");
  } catch {
    return false;
  }
}

export function BackofficeScrollRestoration() {
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    restoreScrollPosition();

    function handleSubmit() {
      storeScrollPosition();
    }

    function handleClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[href]");
      if (link instanceof HTMLAnchorElement && isBackofficeHref(link.getAttribute("href"))) {
        storeScrollPosition();
      }
    }

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return null;
}
