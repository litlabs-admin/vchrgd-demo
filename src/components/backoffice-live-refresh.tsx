"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 10_000;

function isEditingElement(element: Element | null) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    element.getAttribute("contenteditable") === "true"
  );
}

function formatTime(value: Date | null) {
  if (!value) {
    return "checking";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

export function BackofficeLiveRefresh() {
  const router = useRouter();
  const latestVersionRef = useRef<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [state, setState] = useState<"live" | "paused" | "refreshing" | "error">("live");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function checkForUpdates() {
      if (cancelled) {
        return;
      }

      if (document.visibilityState !== "visible" || isEditingElement(document.activeElement)) {
        setState("paused");
        timeoutId = window.setTimeout(checkForUpdates, POLL_INTERVAL_MS);
        return;
      }

      try {
        const response = await fetch("/api/backoffice/state-version", {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`State check failed with ${response.status}`);
        }

        const payload = (await response.json()) as { version?: string };
        setLastCheckedAt(new Date());

        if (!payload.version) {
          setState("error");
        } else if (latestVersionRef.current && latestVersionRef.current !== payload.version) {
          latestVersionRef.current = payload.version;
          setState("refreshing");
          startTransition(() => {
            router.refresh();
          });
        } else {
          latestVersionRef.current = payload.version;
          setState("live");
        }
      } catch {
        setState("error");
      }

      timeoutId = window.setTimeout(checkForUpdates, POLL_INTERVAL_MS);
    }

    timeoutId = window.setTimeout(checkForUpdates, 2_000);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [router]);

  useEffect(() => {
    if (!isPending && state === "refreshing") {
      setState("live");
    }
  }, [isPending, state]);

  const label =
    state === "paused"
      ? "Live updates paused while editing"
      : state === "refreshing" || isPending
        ? "Refreshing live data"
        : state === "error"
          ? "Live updates need attention"
          : "Live updates on";

  return (
    <button
      type="button"
      onClick={() => {
        setState("refreshing");
        startTransition(() => router.refresh());
      }}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-5 text-left text-xs font-bold uppercase tracking-[0.16em] text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100"
      title={`Last checked ${formatTime(lastCheckedAt)}`}
    >
      <RefreshCw
        className={`h-4 w-4 ${state === "refreshing" || isPending ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}
