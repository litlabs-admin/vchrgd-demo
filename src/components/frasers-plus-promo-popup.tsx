"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { captureCheckoutClick } from "@/lib/checkout-click-client";
import styles from "./frasers-plus-promo-popup.module.css";

const ELIGIBILITY_URL =
  "https://application.pay.frasers.plus/?partner=VCHRGD&template=online&location=frasersplus_webpage";
const DISPLAY_DELAY_MS = 3000;

export function FrasersPlusPromoPopup({ active }: { active: boolean }) {
  const [dismissed, setDismissed] = useState(false);

  return active && !dismissed ? (
    <DelayedPromoPopup onDismiss={() => setDismissed(true)} />
  ) : null;
}

function DelayedPromoPopup({ onDismiss }: { onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const titleId = useId();

  useEffect(() => {
    let timer: number | undefined;
    const showAfterDelay = () => {
      timer = window.setTimeout(() => setVisible(true), DISPLAY_DELAY_MS);
    };

    if (document.readyState === "complete") showAfterDelay();
    else window.addEventListener("load", showAfterDelay, { once: true });

    // Leaving charger selection also cancels any pending reveal.
    return () => {
      window.removeEventListener("load", showAfterDelay);
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  return createPortal(
    <aside
      onClickCapture={captureCheckoutClick}
      className={styles.popup}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <button
        className={styles.close}
        type="button"
        aria-label="Close Frasers Plus information"
        data-checkout-click="frasers_popup_close"
        onClick={onDismiss}
      >
        &times;
      </button>
      <div className={styles.brand}>
        <Image
          src="/content/frasers-plus-official-horizontal.svg"
          alt="Frasers Plus"
          width={260}
          height={71}
          unoptimized
        />
      </div>
      <h2 id={titleId}>
        0% interest for 3 months
        <span>every time you choose a 3 month plan</span>
      </h2>
      <ul>
        <li>&pound;0 to pay at checkout</li>
        <li>0% interest available every time</li>
        <li>Choose a plan that suits you best, up to 36 months</li>
        <li>Earn points each time you shop</li>
      </ul>
      <a
        className={styles.cta}
        href={ELIGIBILITY_URL}
        data-checkout-click="frasers_eligibility"
        target="_blank"
        rel="noopener noreferrer"
      >
        Check eligibility
      </a>
      <p className={styles.apr}>
        Representative 29.9% APR variable
        <span>for longer terms</span>
      </p>
      <p className={styles.legal}>
        Credit subject to status. Terms apply. Missed payments may affect your
        credit score and mean your 0% interest plans end.
      </p>
    </aside>,
    document.body,
  );
}
