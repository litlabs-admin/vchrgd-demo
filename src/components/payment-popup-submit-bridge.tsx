"use client";

import { useEffect, useRef, useState } from "react";

const PAYMENT_POPUP_MESSAGE_TYPE = "vchrgd:payment-return";
const PAYMENT_POPUP_NAME = "vchrgd_secure_payment";
const PAYMENT_POPUP_WIDTH = 820;
const PAYMENT_POPUP_HEIGHT = 820;

function getPaymentPopupFeatures() {
  const availableWidth = window.screen.availWidth || window.outerWidth || window.innerWidth;
  const availableHeight = window.screen.availHeight || window.outerHeight || window.innerHeight;
  const width = Math.min(PAYMENT_POPUP_WIDTH, Math.max(720, Math.round(availableWidth * 0.74)));
  const height = Math.min(PAYMENT_POPUP_HEIGHT, Math.max(720, Math.round(availableHeight * 0.86)));
  const left = Math.max(0, Math.round(window.screenX + (availableWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (availableHeight - height) / 2));

  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

function writePlaceholder(popup: Window) {
  try {
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Opening secure payment</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              font-family: Arial, sans-serif;
              color: #0f172a;
              background: #f8fafc;
            }
            main {
              max-width: 320px;
              padding: 28px;
              border: 1px solid #dbe3ef;
              border-radius: 24px;
              background: white;
              text-align: center;
              box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
            }
          </style>
        </head>
        <body>
          <main>
            <strong>Opening secure payment...</strong>
            <p>Please complete the next step in this window.</p>
          </main>
        </body>
      </html>
    `);
    popup.document.close();
  } catch {
    // The popup may already have navigated cross-origin.
  }
}

export function PaymentPopupSubmitBridge() {
  const [message, setMessage] = useState("");
  const [popupActive, setPopupActive] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const completedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearCloseTimer() {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as { type?: string; url?: string };
      if (data?.type !== PAYMENT_POPUP_MESSAGE_TYPE) {
        return;
      }

      completedRef.current = true;
      clearCloseTimer();
      setPopupActive(false);
      popupRef.current?.close();

      if (data.url) {
        window.location.assign(data.url);
      }
    }

    function handleSubmit(event: SubmitEvent) {
      const form = event.currentTarget as HTMLFormElement;
      completedRef.current = false;
      setMessage("");

      const popup = window.open("", PAYMENT_POPUP_NAME, getPaymentPopupFeatures());
      if (!popup) {
        form.removeAttribute("target");
        setPopupActive(false);
        setMessage("Your browser blocked the payment popup, so this payment will continue in the current tab.");
        return;
      }

      popupRef.current = popup;
      setPopupActive(true);
      form.target = PAYMENT_POPUP_NAME;
      writePlaceholder(popup);
      popup.focus();
      clearCloseTimer();

      timerRef.current = window.setInterval(() => {
        if (!popup.closed) {
          return;
        }

        clearCloseTimer();
        setPopupActive(false);
        if (!completedRef.current) {
          setMessage("The payment window was closed before completion. Your order page is still open, and you can try again.");
        }
      }, 750);
    }

    const forms = Array.from(
      document.querySelectorAll<HTMLFormElement>("form[data-payment-popup-form='true']"),
    );

    forms.forEach((form) => form.addEventListener("submit", handleSubmit));
    window.addEventListener("message", handleMessage);

    return () => {
      forms.forEach((form) => form.removeEventListener("submit", handleSubmit));
      window.removeEventListener("message", handleMessage);
      clearCloseTimer();
      setPopupActive(false);
    };
  }, []);

  if (!message && !popupActive) {
    return null;
  }

  return (
    <>
      {popupActive ? <PaymentPopupBackdrop /> : null}
      {message ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
          {message}
        </div>
      ) : null}
    </>
  );
}

function PaymentPopupBackdrop() {
  return (
    <div className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm" aria-hidden="true" />
  );
}
