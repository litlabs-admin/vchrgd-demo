import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertContains(path, pattern, description) {
  const source = read(path);
  const matched = typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);

  if (!matched) {
    throw new Error(`${description} failed in ${path}`);
  }
}

const checks = [
  () =>
    assertContains(
      "src/lib/request-guards.ts",
      'secFetchSite === "same-origin" || secFetchSite === "none"',
      "Same-origin guard must not accept missing Origin without Fetch Metadata",
    ),
  () =>
    assertContains(
      "src/lib/mock-route-guards.ts",
      /process\.env\.NODE_ENV !== "production"/,
      "Mock payment routes must be production-disabled by default",
    ),
  () =>
    assertContains(
      "src/lib/gmail-sender.ts",
      "Gmail private-key fallback is disabled in production",
      "Gmail sender must reject private-key fallback in production",
    ),
  () =>
    assertContains(
      "src/lib/gmail-sender.ts",
      "getVercelOidcToken({",
      "Gmail sender must use Vercel OIDC for Workload Identity Federation",
    ),
  () =>
    assertContains(
      "src/lib/gmail-sender.ts",
      "assertSenderIsLocked",
      "Gmail sender must lock the impersonated sender address",
    ),
  () =>
    assertContains(
      "src/lib/checkout-recovery-token.ts",
      "timingSafeEqual",
      "Checkout recovery links must use constant-time token verification",
    ),
  () =>
    assertContains(
      "src/app/api/checkout-recovery/send-due/route.ts",
      "CRON_SECRET",
      "Checkout recovery cron endpoint must require a shared secret",
    ),
  () =>
    assertContains(
      "src/app/api/card-checkout/reconcile/route.ts",
      "CRON_SECRET",
      "Card reconciliation cron endpoint must require a shared secret",
    ),
  () =>
    assertContains(
      "src/lib/square.ts",
      "timingSafeEqual",
      "Square webhook verification must use constant-time comparison",
    ),
  () =>
    assertContains(
      "src/lib/jumptech.ts",
      "timingSafeEqual",
      "Jumptech webhook verification must use constant-time comparison",
    ),
  () =>
    assertContains(
      "src/lib/admin-auth.ts",
      "httpOnly: true",
      "Admin session cookies must be HTTP-only",
    ),
  () =>
    assertContains(
      "next.config.ts",
      "Strict-Transport-Security",
      "Production transport security header must be configured",
    ),
  () =>
    assertContains(
      "next.config.ts",
      "Cache-Control",
      "Sensitive pages and APIs must be no-store",
    ),
];

for (const check of checks) {
  check();
}

console.log(`Security checks passed (${checks.length} controls).`);
