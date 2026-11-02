"use client";

import { useEffect } from "react";

const PAYMENT_POPUP_MESSAGE_TYPE = "vchrgd:payment-return";

export function PaymentPopupReturnBridge({
  paymentId,
  status,
  nextUrl,
}: {
  paymentId: string;
  status: string;
  nextUrl?: string | null;
}) {
  useEffect(() => {
    if (!window.opener || window.opener.closed) {
      return;
    }

    const targetUrl = nextUrl || window.location.href;
    window.opener.postMessage(
      {
        type: PAYMENT_POPUP_MESSAGE_TYPE,
        paymentId,
        status,
        url: targetUrl,
      },
      window.location.origin,
    );

    const timer = window.setTimeout(() => {
      window.close();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [nextUrl, paymentId, status]);

  return null;
}
