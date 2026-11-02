"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PreferredInstallationDatesPanelProps = {
  token: string;
  minimumDate: string;
  initialDates?: string[];
  tone?: "light" | "dark";
  monthsPerPage?: number;
  layout?: "card" | "summary";
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatIsoDate(value: string) {
  return shortDateFormatter.format(parseIsoDate(value));
}

function buildCalendarMonths(minimumDate: string, monthCount = 6) {
  const min = parseIsoDate(minimumDate);
  const firstMonthStart = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = new Date(
      Date.UTC(firstMonthStart.getUTCFullYear(), firstMonthStart.getUTCMonth() + index, 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(firstMonthStart.getUTCFullYear(), firstMonthStart.getUTCMonth() + index + 1, 1),
    );
    const daysInMonth =
      Math.round((nextMonthStart.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
    const leadingBlankDays = (monthStart.getUTCDay() + 6) % 7;
    const cells = [
      ...Array.from({ length: leadingBlankDays }, () => null),
      ...Array.from({ length: daysInMonth }, (_, dayIndex) => {
        const date = new Date(
          Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayIndex + 1),
        );
        return toIsoDate(date);
      }),
    ];

    return {
      label: monthFormatter.format(monthStart),
      cells,
    };
  });
}

export function PreferredInstallationDatesPanel({
  token,
  minimumDate,
  initialDates = [],
  tone = "light",
  monthsPerPage = 2,
  layout = "card",
}: PreferredInstallationDatesPanelProps) {
  const router = useRouter();
  const [selectedDates, setSelectedDates] = useState([...initialDates].sort().slice(0, 3));
  const [visibleMonthIndex, setVisibleMonthIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const months = useMemo(() => buildCalendarMonths(minimumDate), [minimumDate]);
  const visibleMonths = months.slice(
    visibleMonthIndex,
    visibleMonthIndex + monthsPerPage,
  );
  const light = tone === "light";
  const summaryLayout = layout === "summary";

  function isSelectableDate(value: string) {
    const day = parseIsoDate(value).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    return !isWeekend && value >= minimumDate;
  }

  function toggleDate(value: string) {
    if (!isSelectableDate(value)) {
      return;
    }

    setFeedback("");
    setError("");
    setSelectedDates((current) => {
      if (current.includes(value)) {
        return current.filter((entry) => entry !== value);
      }

      if (current.length >= 3) {
        setError("Select up to three dates.");
        return current;
      }

      return [...current, value].sort();
    });
  }

  async function saveDates() {
    if (!selectedDates.length) {
      setError("Choose at least one preferred date.");
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const response = await fetch("/api/customer-installation-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          dates: selectedDates,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "We could not save your preferred dates just yet.",
        );
        return;
      }

      if (Array.isArray(data?.preferredInstallationDates)) {
        setSelectedDates(
          data.preferredInstallationDates
            .filter((value: unknown): value is string => typeof value === "string")
            .sort()
            .slice(0, 3),
        );
      }

      setFeedback("Preferred dates saved to your order.");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("We could not save your preferred dates just yet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={
        summaryLayout
          ? "mt-6 border-t border-slate-200 pt-4"
          : light
            ? "mt-8 rounded-[20px] border border-slate-200 bg-slate-50 p-5 sm:rounded-[24px] sm:p-6"
            : "fp-brand-card mt-8 rounded-[20px] border p-5 sm:rounded-[24px] sm:p-6"
      }
    >
      <p
        className={
          summaryLayout
            ? "text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]"
            : light
              ? "text-xs font-bold uppercase tracking-[0.18em] text-[#00a7cf]"
              : "text-xs font-bold uppercase tracking-[0.18em] text-[var(--fp-lilac)]"
        }
      >
        Preferred installation dates
      </p>
      <p
        className={
          summaryLayout
            ? "mt-4 text-sm leading-6 text-slate-600"
            : light
              ? `${summaryLayout ? "mt-2" : "mt-3"} text-sm leading-7 text-slate-600`
              : `${summaryLayout ? "mt-2" : "mt-3"} text-sm leading-7 text-slate-200`
        }
      >
        Select up to three preferred installation dates from the calendar below. These dates are not guaranteed,
        but we will work to try and meet them where possible. We may also be able to offer an earlier installation
        than the dates shown here.
      </p>
      <p
        className={
          summaryLayout
            ? "mt-3 text-sm text-slate-500"
            : light
              ? "mt-2 text-sm font-medium text-slate-500"
              : "mt-2 text-sm font-medium text-slate-300"
        }
      >
        Potential dates are shown from {formatIsoDate(minimumDate)} onwards.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {selectedDates.length ? (
          selectedDates.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => toggleDate(value)}
              className={
                light
                  ? "inline-flex items-center rounded-full border border-[#00c7ef]/30 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5]"
                  : "inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/35"
              }
            >
              {formatIsoDate(value)}
            </button>
          ))
        ) : (
          <p className={light ? "text-sm text-slate-500" : "text-sm text-slate-300"}>
            No dates selected yet.
          </p>
        )}
      </div>

      <div className={`mt-6 flex flex-col gap-4 ${summaryLayout ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}>
        <div
          className={
            summaryLayout
              ? "text-sm leading-6 text-slate-500"
              : light
                ? "text-sm text-slate-500"
                : "text-sm text-slate-300"
          }
        >
          Browse the next available months and keep any dates you already selected.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setVisibleMonthIndex((current) => Math.max(current - monthsPerPage, 0))
            }
            disabled={visibleMonthIndex === 0}
            className={
              light
                ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300"
                : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:border-white/35 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-500"
            }
            aria-label="Show previous months"
          >
            &lt;
          </button>
          <button
            type="button"
            onClick={() =>
              setVisibleMonthIndex((current) =>
                Math.min(current + monthsPerPage, Math.max(months.length - monthsPerPage, 0)),
              )
            }
            disabled={visibleMonthIndex + monthsPerPage >= months.length}
            className={
              light
                ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300"
                : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:border-white/35 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-500"
            }
            aria-label="Show next months"
          >
            &gt;
          </button>
        </div>
      </div>

      <div className={`mt-6 grid gap-5 ${monthsPerPage > 1 ? "xl:grid-cols-2" : ""}`}>
        {visibleMonths.map((month) => (
          <div
            key={month.label}
            className={
              summaryLayout
                ? light
                  ? "rounded-[20px] border border-slate-200 bg-slate-50 p-4"
                  : "rounded-[20px] border border-white/10 bg-white/5 p-4"
                : light
                  ? "rounded-[20px] border border-slate-200 bg-white p-4"
                  : "rounded-[20px] border border-white/10 bg-white/5 p-4"
            }
          >
            <p className={light ? "text-sm font-semibold text-slate-950" : "text-sm font-semibold text-white"}>
              {month.label}
            </p>
            <div className="mt-4 grid grid-cols-7 gap-2">
              {WEEKDAY_LABELS.map((label) => (
                <span
                  key={label}
                  className={
                    light
                      ? "text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                      : "text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                  }
                >
                  {label}
                </span>
              ))}
              {month.cells.map((value, index) =>
                value ? (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleDate(value)}
                    disabled={!isSelectableDate(value)}
                    className={`inline-flex min-h-10 items-center justify-center rounded-2xl text-sm font-semibold transition ${
                      selectedDates.includes(value)
                        ? light
                          ? "bg-[#191c23] text-white"
                          : "bg-white text-[var(--fp-bg)]"
                        : isSelectableDate(value)
                          ? light
                            ? "border border-slate-200 bg-white text-slate-900 hover:border-[#00c7ef] hover:text-[#008fb5]"
                            : "border border-white/15 bg-transparent text-white hover:border-white/35"
                          : light
                            ? "cursor-not-allowed border border-slate-100 bg-slate-50 text-slate-300"
                            : "cursor-not-allowed border border-white/5 bg-white/5 text-slate-500"
                    }`}
                  >
                    {parseIsoDate(value).getUTCDate()}
                  </button>
                ) : (
                  <span key={`${month.label}-blank-${index}`} className="min-h-10" />
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => {
            void saveDates();
          }}
          disabled={saving || !selectedDates.length}
          className={
            light
              ? "inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold text-white transition hover:bg-[#0f1116] disabled:cursor-not-allowed disabled:bg-slate-300"
              : "fp-primary-btn inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {saving ? "Saving preferred dates..." : "Save preferred dates"}
        </button>
        <p className={light ? "text-sm text-slate-500" : "text-sm text-slate-300"}>
          You can update these until the installation is booked.
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-sm font-medium text-amber-700">{error}</p>
      ) : null}

      {feedback ? (
        <p className={light ? "mt-3 text-sm text-slate-500" : "mt-3 text-sm text-slate-300"}>
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
