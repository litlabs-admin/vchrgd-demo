"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    Trustpilot?: {
      loadFromElement: (element: HTMLElement, forceReload?: boolean) => void;
    };
  }
}

const TRUSTPILOT_SCRIPT_ID = "trustpilot-widget-bootstrap";

export function TrustpilotWidget({ variant = "glass" }: { variant?: "glass" | "plain" | "plain-dark" } = {}) {
  const widgetRef = useRef<HTMLDivElement>(null);

  const loadWidget = () => {
    if (widgetRef.current && window.Trustpilot) {
      window.Trustpilot.loadFromElement(widgetRef.current, true);
    }
  };

  useEffect(() => {
    loadWidget();
  }, []);

  if (variant === "plain" || variant === "plain-dark") {
    const dark = variant === "plain-dark";
    return (
      <div className="min-h-5 w-full">
        <Script
          id={TRUSTPILOT_SCRIPT_ID}
          src="https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
          strategy="afterInteractive"
          onLoad={loadWidget}
          onReady={loadWidget}
        />
        <div
          ref={widgetRef}
          className="trustpilot-widget min-h-5 w-full"
          data-locale="en-GB"
          data-template-id="5419b637fa0340045cd0c936"
          data-businessunit-id="6470e16cdbc8260df976a0ae"
          data-theme={dark ? "dark" : "light"}
          data-style-height="20px"
          data-style-width="100%"
        >
          <a
            href="https://uk.trustpilot.com/review/vchrgd.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm font-medium underline underline-offset-2 ${dark ? "!text-white" : "text-ink"}`}
          >
            See our reviews on Trustpilot
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate w-full overflow-hidden rounded-full border border-white/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.07)_48%,rgba(255,255,255,0.035)_100%)] px-4 py-3 shadow-[0_14px_38px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.62),inset_0_-1px_0_rgba(255,255,255,0.1),inset_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-[16px] backdrop-saturate-[180%]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/95 to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-14 h-32 w-32 rounded-full bg-white/15 blur-2xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.16),transparent_42%)]"
      />
      <Script
        id={TRUSTPILOT_SCRIPT_ID}
        src="https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
        strategy="afterInteractive"
        onLoad={loadWidget}
        onReady={loadWidget}
      />
      <div
        ref={widgetRef}
        className="trustpilot-widget relative z-10 min-h-5 w-full"
        data-locale="en-GB"
        data-template-id="5419b637fa0340045cd0c936"
        data-businessunit-id="6470e16cdbc8260df976a0ae"
        data-theme="dark"
        data-style-height="20px"
        data-style-width="100%"
      >
        <a
          href="https://uk.trustpilot.com/review/vchrgd.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-white"
        >
          Trustpilot
        </a>
      </div>
    </div>
  );
}
