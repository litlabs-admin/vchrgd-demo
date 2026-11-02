export function areMockPaymentRoutesEnabled() {
  if (
    process.env.FRASERS_PLUS_LIVE_VALIDATION === "true" ||
    process.env.FRASERS_PLUS_LIVE_PRODUCTION === "true"
  ) return false;

  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_MOCK_PAYMENT_ROUTES === "true" ||
    process.env.SHOW_DEMO_CONTROLS === "true"
  );
}
