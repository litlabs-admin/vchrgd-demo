const paymentDomains = ["revolut.com", "square.site", "squareup.com", "squareupsandbox.com", "frasers.plus", "tymit.com"];

export function safePaymentHandoffTarget(target: string) {
  if (!target || target.includes("\\") || /[\u0000-\u0020]/.test(target)) return "/";
  // Keep local return/mock routes, but never accept a protocol-relative URL.
  if (/^\/(?:mock-card-checkout|mock-hpp|card\/return|frasers-plus\/return)(?:[/?#]|$)/.test(target)) return target;
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "/";
    return paymentDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.toString() : "/";
  } catch { return "/"; }
}
