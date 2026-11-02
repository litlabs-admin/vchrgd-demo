"use client";

import Link from "next/link";
import { useState } from "react";

export function CustomerStatusLinkPanel({
  href,
  tone = "light",
}: {
  href: string;
  tone?: "light" | "dark";
}) {
  const [feedback, setFeedback] = useState<string>("");

  async function saveLink() {
    if (typeof window === "undefined") {
      return;
    }

    const absoluteUrl = new URL(href, window.location.origin).toString();

    try {
      if (navigator.share) {
        await navigator.share({
          title: "VCHRGD order status",
          text: "Save this VCHRGD order status link so you can check progress at any time.",
          url: absoluteUrl,
        });
        setFeedback("Status link ready to save.");
        return;
      }

      await navigator.clipboard.writeText(absoluteUrl);
      setFeedback("Status link copied.");
    } catch {
      setFeedback("Unable to save automatically. Please copy the link from the status page.");
    }
  }

  const light = tone === "light";

  return (
    <div
      className={
        light
          ? "mt-8 rounded-[20px] border border-slate-200 bg-slate-50 p-5 sm:rounded-[24px] sm:p-6"
          : "fp-brand-card mt-8 rounded-[20px] border p-5 sm:rounded-[24px] sm:p-6"
      }
    >
      <p
        className={
          light
            ? "text-xs font-bold uppercase tracking-[0.18em] text-[#00a7cf]"
            : "text-xs font-bold uppercase tracking-[0.18em] text-[var(--fp-lilac)]"
        }
      >
        Track your order
      </p>
      <p
        className={
          light
            ? "mt-3 text-sm leading-7 text-slate-600"
            : "mt-3 text-sm leading-7 text-slate-200"
        }
      >
        Use this status page to check your progress through survey review, booking, and installation.
        Save the link so you can come back to it at any time. The link will no longer be active once
        your installation has been completed.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={href}
          className={
            light
              ? "inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold !text-white no-underline transition hover:bg-[#0f1116]"
              : "fp-primary-btn inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold !text-white no-underline transition"
          }
        >
          Check your status
        </Link>
        <button
          type="button"
          onClick={() => {
            void saveLink();
          }}
          className={
            light
              ? "inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              : "fp-secondary-btn inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
          }
        >
          Save this link
        </button>
      </div>

      {feedback ? (
        <p
          className={
            light
              ? "mt-3 text-sm text-slate-500"
              : "mt-3 text-sm text-slate-300"
          }
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
