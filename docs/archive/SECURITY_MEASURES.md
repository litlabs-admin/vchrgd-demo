> Historical document archived 21 October 2026. Superseded by the current README, HANDOVER.md and operating guides one directory above. Do not use these old cutover instructions as current deployment guidance.

# VCHRGD Payments Security Measures

## Payment Data Handling

- Full card details are not stored by the application.
- Card payments are handled by Square-hosted checkout or Square Web Payments tokenisation.
- The app stores provider references, order/session IDs, status, amount, customer contact details, selected charger, and installation metadata needed for fulfilment.
- Frasers Plus credentials are held in server-side environment variables only and the Frasers Plus D2C path is feature-flagged off unless explicitly enabled.

## Request Protection

- Admin and back-office mutation routes use same-origin request checks.
- Missing `Origin` headers are not trusted by default; browser mutations must also satisfy Fetch Metadata (`sec-fetch-site` of `same-origin` or `none`).
- Payment creation routes now reject cross-origin mutations before reading or processing payloads.
- Customer status links use opaque review tokens rather than exposing an admin session.
- Customer status links stay active until installation is confirmed, then render a closed support page without order detail.
- Production payment return URLs require signed return tokens tied to payment IDs.
- Internal redirect helpers only allow same-origin `/backoffice` redirects.
- Mock payment and HPP routes are disabled in production unless `ENABLE_MOCK_PAYMENT_ROUTES=true` is explicitly set.

## Webhook Verification

- Square webhooks are verified with `x-square-hmacsha256-signature` and the configured webhook notification URL.
- Jumptech webhooks are verified with the configured HMAC secret and Jumptech signature headers.
- Revolut webhooks are verified with the Revolut signature and timestamp when Revolut is enabled.
- Webhook handlers reconcile against stored provider references before updating internal payment state.

## Admin Security

- Admin sessions are signed with HMAC-SHA256 and stored in an HTTP-only cookie.
- Admin cookies are `sameSite=lax` and `secure` in production.
- Bootstrap super admin requires MFA.
- Managed admin users can be created with or without MFA according to super-admin configuration.
- Passwords for managed admin users are stored as hashes.
- Login failures are rate-limited per client IP with lockout after repeated failures and stored through the configured app data store.
- Product settings and access management are restricted to the bootstrap super admin.

## Gmail / Google Workspace Sending

- Checkout recovery email sending is server-side only and restricted to logged-in bootstrap super admins for preview/test sends.
- The Gmail sender is locked to the configured sender address; `GOOGLE_GMAIL_IMPERSONATE_USER` must match `GOOGLE_GMAIL_ALLOWED_SENDER`.
- Production uses Vercel OIDC with Google Workload Identity Federation rather than stored service-account JSON keys.
- Production private-key fallback is rejected by application code unless a deliberate `GOOGLE_GMAIL_ALLOW_PRIVATE_KEY_FALLBACK=true` override is added.
- The Google service account should have domain-wide delegation for the minimal Gmail scope only: `https://www.googleapis.com/auth/gmail.send`.
- The Vercel workload identity principal should be granted access only on the Gmail sending service account, not project-wide.
- Required service-account roles are `Workload Identity User` and `Service Account Token Creator` scoped to `vchrgd-checkout-chaser`.
- The service account impersonates `sales@vchrgd.com`; it should not be granted broader Workspace scopes such as mailbox read, Drive, Calendar, or Admin SDK.

## Browser and Transport Headers

Configured globally in `next.config.ts`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Content-Security-Policy-Report-Only` is enabled for observation before moving to enforced CSP.
- `Strict-Transport-Security` in production
- `X-Powered-By` is disabled.

Back-office pages, customer status/payment pages, and API routes are marked `no-store`.

## Operational Controls

- Jumptech project creation is guarded so an original payment should not double-submit a project.
- Top-up payments are recorded as separate transactions under the original workflow.
- Refunds are request-based and require agent action; customer cancellation does not auto-refund.
- Product pricing, discounts, vouchers, and banners are editable only by super admin.
- Discounts and vouchers are mutually exclusive in the customer checkout.

## Remaining Production Controls To Confirm

- Vercel production env variables must be reviewed for staging URLs, localhost URLs, and placeholder values before promotion.
- Rotate any production credentials that have been shared outside the provider dashboards.
- Confirm Gmail API is enabled for project `546489546536` and domain-wide delegation is limited to `gmail.send` only.
- Confirm the Vercel Workload Identity Provider condition remains production-scoped and does not accept preview/development deployments.
- Square production webhook must be registered and verified against `payments.vchrgd.app`.
- Apple Pay domain verification must be completed in Square before Apple Pay is promoted.
- Frasers Plus must remain feature-flagged off until production approval is complete.
- CSP should remain report-only until Square, Google sign-in, Apple Pay, and customer payment journeys have been observed without required-src violations.
- A production backup/rollback path must be documented before switching traffic.

## Repeatable Security Check

Run this before production deployments:

```bash
npm run security:check
npm run lint
npm run build
```

`security:check` asserts that the critical controls are present in source: strict same-origin guard, production-disabled mock routes, production-disabled Gmail private-key fallback, Vercel OIDC WIF usage, locked Gmail sender, constant-time webhook signature comparison, HTTP-only admin cookies, HSTS, and no-store headers.
