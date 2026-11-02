"use client";

import { useEffect, useRef, useState, startTransition } from "react";

type BillingAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
  state?: string;
  region?: string;
};

type SquareCardCheckoutClientProps = {
  applicationId: string;
  locationId: string;
  scriptUrl: string;
  paymentId: string;
  returnToken: string;
  amount: number;
  currency: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    billingAddress?: BillingAddress;
  };
};

type SquareCard = {
  attach(selector: string): Promise<void>;
  destroy?(): Promise<void>;
  tokenize(verificationDetails?: Record<string, unknown>): Promise<{
    status: string;
    token?: string;
    errors?: Array<{ message?: string; detail?: string }>;
  }>;
};

type SquareTokenResult = {
  status: string;
  token?: string;
  errors?: Array<{ message?: string; detail?: string }>;
};

type SquareVerificationResult = {
  token?: string;
};

type SquareDigitalWallet = {
  attach?(selector: string): Promise<void>;
  destroy?(): Promise<void>;
  tokenize(): Promise<SquareTokenResult>;
};

type SquarePayments = {
  applePay(paymentRequest: unknown): Promise<SquareDigitalWallet>;
  card(): Promise<SquareCard>;
  googlePay(paymentRequest: unknown): Promise<SquareDigitalWallet>;
  paymentRequest(details: Record<string, unknown>): unknown;
  verifyBuyer?(
    sourceId: string,
    verificationDetails: Record<string, unknown>,
  ): Promise<SquareVerificationResult>;
};

declare global {
  interface Window {
    Square?: {
      payments(applicationId: string, locationId: string): SquarePayments;
    };
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Unable to load secure Square payment form."));

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

function buildVerificationDetails({
  amount,
  currency,
  customer,
}: Pick<SquareCardCheckoutClientProps, "amount" | "currency" | "customer">) {
  const addressLines = [
    customer.billingAddress?.line1,
    customer.billingAddress?.line2,
  ].filter(Boolean);

  return {
    amount: amount.toFixed(2),
    billingContact: {
      givenName: customer.firstName || undefined,
      familyName: customer.lastName || undefined,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      addressLines,
      city: customer.billingAddress?.city || undefined,
      state: customer.billingAddress?.state || customer.billingAddress?.region || undefined,
      countryCode: customer.billingAddress?.country || "GB",
    },
    currencyCode: currency.toUpperCase(),
    intent: "CHARGE",
    customerInitiated: true,
    sellerKeyedIn: false,
  };
}

function buildPaymentRequest({
  amount,
  currency,
  customer,
}: Pick<SquareCardCheckoutClientProps, "amount" | "currency" | "customer">) {
  return {
    countryCode: customer.billingAddress?.country || "GB",
    currencyCode: currency.toUpperCase(),
    total: {
      amount: amount.toFixed(2),
      label: "VCHRGD installation",
    },
    requestBillingContact: true,
  };
}

function getTokenErrorMessage(errors: Array<{ message?: string; detail?: string }> | undefined) {
  return (
    errors?.find((error) => error.message || error.detail)?.message ||
    errors?.find((error) => error.message || error.detail)?.detail ||
    "Please check your card details and try again."
  );
}

export function SquareCardCheckoutClient({
  applicationId,
  locationId,
  scriptUrl,
  paymentId,
  returnToken,
  amount,
  currency,
  customer,
}: SquareCardCheckoutClientProps) {
  const [status, setStatus] = useState("Loading secure card form...");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef<SquareCard | null>(null);
  const applePayRef = useRef<SquareDigitalWallet | null>(null);
  const googlePayRef = useRef<SquareDigitalWallet | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialiseCard() {
      try {
        await loadScript(scriptUrl);
        if (!window.Square) {
          throw new Error("Square payment form is unavailable.");
        }

        const payments = window.Square.payments(applicationId, locationId);
        paymentsRef.current = payments;
        const paymentRequest = payments.paymentRequest(
          buildPaymentRequest({ amount, currency, customer }),
        );

        try {
          const applePay = await payments.applePay(paymentRequest);

          if (cancelled) {
            await applePay.destroy?.();
          } else {
            applePayRef.current = applePay;
            setApplePayReady(true);
          }
        } catch {
          setApplePayReady(false);
        }

        try {
          const googlePay = await payments.googlePay(paymentRequest);

          if (cancelled) {
            await googlePay.destroy?.();
          } else {
            googlePayRef.current = googlePay;
            await googlePay.attach?.("#square-google-pay-button");
            setGooglePayReady(true);
          }
        } catch {
          setGooglePayReady(false);
        }

        const card = await payments.card();
        await card.attach("#square-card-container");

        if (cancelled) {
          await card.destroy?.();
          return;
        }

        cardRef.current = card;
        setReady(true);
        setStatus("Enter your card details below.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load secure card form.");
        setStatus("");
      }
    }

    void initialiseCard();

    return () => {
      cancelled = true;
      void cardRef.current?.destroy?.();
      void applePayRef.current?.destroy?.();
      void googlePayRef.current?.destroy?.();
      cardRef.current = null;
      applePayRef.current = null;
      googlePayRef.current = null;
      paymentsRef.current = null;
    };
  }, [amount, applicationId, currency, customer, locationId, scriptUrl]);

  async function verifySourceIfAvailable(sourceId: string) {
    const payments = paymentsRef.current;
    if (!payments?.verifyBuyer) {
      return "";
    }

    const result = await payments.verifyBuyer(
      sourceId,
      buildVerificationDetails({ amount, currency, customer }),
    );
    return result.token || "";
  }

  async function submitSquareSourceId(
    sourceId: string,
    methodLabel: string,
    verificationToken = "",
  ) {
    const response = await fetch("/api/card-checkout/square-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentId,
        returnToken,
        sourceId,
        verificationToken,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? "Square did not approve this payment.");
    }

    setStatus(`${methodLabel} confirmed. Returning to VCHRGD...`);
    window.location.assign(data.redirectUrl);
  }

  async function handleSubmit() {
    setError("");

    if (!cardRef.current) {
      setError("The secure card form is not ready yet.");
      return;
    }

    setSubmitting(true);
    setStatus("Authorising your card payment...");

    try {
      const tokenResult = await cardRef.current.tokenize(
        buildVerificationDetails({ amount, currency, customer }),
      );

      if (tokenResult.status !== "OK" || !tokenResult.token) {
        throw new Error(getTokenErrorMessage(tokenResult.errors));
      }

      const verificationToken = await verifySourceIfAvailable(tokenResult.token);
      await submitSquareSourceId(tokenResult.token, "Card payment", verificationToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete card payment.");
      setStatus("Enter your card details below.");
    } finally {
      startTransition(() => setSubmitting(false));
    }
  }

  async function handleApplePay() {
    const applePay = applePayRef.current;
    if (!applePay) {
      setError("Apple Pay is not available in this browser.");
      return;
    }

    const tokenResultPromise = applePay.tokenize();
    setError("");
    setSubmitting(true);
    setStatus("Authorising your Apple Pay payment...");

    try {
      const tokenResult = await tokenResultPromise;

      if (tokenResult.status !== "OK" || !tokenResult.token) {
        throw new Error(getTokenErrorMessage(tokenResult.errors));
      }

      const verificationToken = await verifySourceIfAvailable(tokenResult.token);
      await submitSquareSourceId(tokenResult.token, "Apple Pay", verificationToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete Apple Pay payment.");
      setStatus("Enter your card details below.");
    } finally {
      startTransition(() => setSubmitting(false));
    }
  }

  async function handleGooglePay() {
    const googlePay = googlePayRef.current;
    if (!googlePay) {
      setError("Google Pay is not available in this browser.");
      return;
    }

    setError("");
    setSubmitting(true);
    setStatus("Authorising your Google Pay payment...");

    try {
      const tokenResult = await googlePay.tokenize();

      if (tokenResult.status !== "OK" || !tokenResult.token) {
        throw new Error(getTokenErrorMessage(tokenResult.errors));
      }

      const verificationToken = await verifySourceIfAvailable(tokenResult.token);
      await submitSquareSourceId(tokenResult.token, "Google Pay", verificationToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete Google Pay payment.");
      setStatus("Enter your card details below.");
    } finally {
      startTransition(() => setSubmitting(false));
    }
  }

  function cancelPayment() {
    const url = new URL("/card/return", window.location.origin);
    url.searchParams.set("paymentId", paymentId);
    url.searchParams.set("rt", returnToken);
    url.searchParams.set("card_payment", "cancelled");
    window.location.assign(url.toString());
  }

  return (
    <section className="mt-6">
      {applePayReady || googlePayReady ? (
        <>
          <div className="grid gap-3">
            {applePayReady ? (
              <button
                type="button"
                onClick={handleApplePay}
                disabled={submitting}
                aria-label="Pay with Apple Pay"
                className="apple-pay-button"
              />
            ) : null}
            {googlePayReady ? (
              <button
                id="square-google-pay-button"
                type="button"
                onClick={handleGooglePay}
                disabled={submitting}
                className="min-h-12 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-950 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-55"
              >
                Pay with Google Pay
              </button>
            ) : null}
          </div>
          <div className="my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>or pay by card</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      ) : null}

      <div className="rounded-[22px] border border-slate-200 bg-white p-4">
        <div id="square-card-container" className="min-h-[96px]" />
      </div>

      {status ? <p className="mt-3 text-sm leading-6 text-slate-500">{status}</p> : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!ready || submitting}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#191c23] px-6 text-sm font-semibold text-white transition hover:bg-[#0f1116] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? "Authorising payment..." : "Pay securely by card"}
        </button>
        <button
          type="button"
          onClick={cancelPayment}
          disabled={submitting}
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:border-[#00c7ef] hover:text-[#008fb5] disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel and return to order overview
        </button>
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Card and wallet details are entered into Square&apos;s secure payment
        elements. VCHRGD does not store your card number.
      </p>
    </section>
  );
}
