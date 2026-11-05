import { CreditCard, ArrowRight } from "lucide-react";

// Small, self-contained payment-options callout shown early in checkout so
// customers know several ways to pay are available before the final step.
// It only links to the full payment explanation — it must NOT open a popup.
export function PaymentOptionsCallout({
  enableFrasersPlus = false,
  href = "/home-charging/index.html#payment",
}: {
  enableFrasersPlus?: boolean;
  href?: string;
}) {
  return (
    <a
      href={href}
      className="group mb-6 flex items-center gap-3 rounded-[20px] border border-line bg-canvas px-4 py-3 text-sm text-ink-soft transition-colors hover:bg-tonal"
      aria-label={
        enableFrasersPlus
          ? "See payment options: pay in full by card, Apple Pay, Google Pay or Revolut Pay, or Frasers Plus monthly with 0% interest for 3 months"
          : "See payment options: pay in full by card, Apple Pay, Google Pay or Revolut Pay"
      }
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tonal text-ink"
        aria-hidden="true"
      >
        <CreditCard className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 leading-5">
        {enableFrasersPlus ? (
          <>
            Card, Apple Pay, Google Pay &amp; Revolut Pay, or Frasers Plus —{" "}
            <strong className="font-semibold text-ink">0% for 3 months</strong>
          </>
        ) : (
          <>Card, Apple Pay, Google Pay &amp; Revolut Pay</>
        )}
      </span>
      <span className="ml-auto hidden shrink-0 items-center gap-1 whitespace-nowrap font-medium text-ink sm:inline-flex">
        See payment options
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
      <ArrowRight
        className="ml-auto h-4 w-4 shrink-0 text-ink sm:hidden"
        aria-hidden="true"
      />
    </a>
  );
}
