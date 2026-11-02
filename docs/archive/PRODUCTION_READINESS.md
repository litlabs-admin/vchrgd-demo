> Historical document archived 21 October 2026. Superseded by the current README, HANDOVER.md and operating guides one directory above. Do not use these old cutover instructions as current deployment guidance.

# VCHRGD Payments Production Readiness

## Payment Provider Cutover

Frasers Plus remains disabled until partner due diligence is complete:

- `ENABLE_FRASERS_PLUS=false`
- `NEXT_PUBLIC_ENABLE_FRASERS_PLUS=false`
- `FRASERS_PLUS_USE_MOCK=false`

Switch the production card route to Revolut with `CARD_PAYMENT_PROVIDER=revolut`. Keep the Square
production credentials during the initial rollback window, but do not route new checkouts to Square.

## Production Domain

Production customer payments should use:

- `PUBLIC_APP_URL=https://payments.vchrgd.app`
- `REVOLUT_REDIRECT_URL=https://payments.vchrgd.app/card/return`
- Revolut webhook URL: `https://payments.vchrgd.app/api/revolut/webhook`
- `FRASERS_PLUS_REDIRECT_URL=https://payments.vchrgd.app/frasers-plus/return` when Frasers Plus is re-enabled
- Google admin redirect URI, if used in production: `https://payments.vchrgd.app/api/admin/google/callback`

## Required Vercel Environment Variables

Set these in the Production environment before promoting:

- `PUBLIC_APP_URL`
- `CARD_PAYMENT_PROVIDER=revolut`
- `REVOLUT_API_BASE_URL=https://merchant.revolut.com`
- `REVOLUT_API_KEY`
- `REVOLUT_API_VERSION`
- `REVOLUT_CURRENCY=GBP`
- `REVOLUT_REDIRECT_URL=https://payments.vchrgd.app/card/return`
- `REVOLUT_CAPTURE_MODE=automatic`
- `REVOLUT_FORCE_LOCAL_DEMO=false`
- `REVOLUT_WEBHOOK_ID`
- `REVOLUT_WEBHOOK_SIGNING_SECRET`
- `REVOLUT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300`
- `CRON_SECRET`
- `ADDITIONAL_COSTS_EMAILS_ENABLED=true`
- `ADDITIONAL_COSTS_EMAIL_ADMIN_TOKEN`
- `JUMPTECH_API_BASE_URL`
- `JUMPTECH_API_TOKEN`
- `JUMPTECH_INTEGRATION_NAME`
- `JUMPTECH_PROJECT_TYPE`
- `JUMPTECH_INITIAL_ACTION=SendRelaySMS`
- `JUMPTECH_PREFERRED_LOCALE=en-GB`
- `JUMPTECH_PROJECT_SOURCE=VCHRGD`
- `JUMPTECH_WEBHOOK_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_TOTP_SECRET`
- `ADMIN_SESSION_SECRET`
- `APP_DATA_STORE`
- `SUPABASE_DB_URL`, if the production data store is Supabase/Postgres-backed
- `GOOGLE_ADMIN_CLIENT_ID`, `GOOGLE_ADMIN_CLIENT_SECRET`, `GOOGLE_ADMIN_REDIRECT_URI`, if Google admin login is enabled

Keep these disabled or empty until approved:

- `ENABLE_FRASERS_PLUS=false`
- `NEXT_PUBLIC_ENABLE_FRASERS_PLUS=false`
- `FRASERS_PLUS_USE_MOCK=false`
- `FRASERS_PLUS_API_BASE_URL`
- `FRASERS_PLUS_API_KEY`
- `FRASERS_PLUS_MERCHANT_ID`
- `FRASERS_PLUS_MERCHANT_NAME`
- `FRASERS_PLUS_WEBHOOK_AUTH_VALUE`

## Pre-Promotion Checklist

1. Confirm Vercel production env variables are complete and do not contain staging URLs, localhost URLs, sandbox credentials, or placeholder values.
2. Confirm `REVOLUT_API_BASE_URL` is the production host and no sandbox, localhost, tunnel, or mock flag is present.
3. Run `npm run revolut:webhook -- https://payments.vchrgd.app/api/revolut/webhook --write-secret` with production credentials in a secure local environment. Copy the resulting ID and signing secret to Vercel Production, then redeploy.
4. Confirm Jumptech webhook subscription points to `https://payments.vchrgd.app/api/jumptech/webhook` and the signing secret is configured.
5. Run a low-value Revolut production checkout: product selection, voucher, hosted checkout, completed return, back-office record, Google Chat notification, and Jumptech project creation.
6. Run a Jumptech staging create from a successful paid checkout and verify the project contains `data.makeModel` and `data.chargerMakeModel`.
7. Run a survey-completed webhook/status update and confirm the back office and customer link update.
8. Run an amended-cost top-up journey and verify only the balance is charged.
9. Confirm cancellation request flow sends jobs into the refunds queue and does not auto-refund without agent approval.
10. Confirm super-admin product settings changes persist and do not expose sensitive data.
11. Confirm mobile checkout pages at 390px, 430px, and 768px widths.
12. Confirm admin login, MFA, Google login, logout, lockout, and session expiry.
13. Take a Vercel rollback note: current staging deployment URL, commit SHA, and previous known-good deployment.
14. Confirm duplicate `ORDER_COMPLETED` deliveries create one paid notification and one Jumptech project.
15. Confirm an `AUTHORISED` order remains pending and does not create Jumptech work until Revolut reports `COMPLETED`.
16. Confirm `/api/card-checkout/reconcile` is invoked by Vercel every five minutes with `CRON_SECRET` configured.
17. Confirm a declined/failed payment remains retryable and does not enter the paid workflow.
18. Confirm a top-up charges only the balance, updates the original order, and does not create a second Jumptech project.

## Known Cutover Decision

Frasers Plus should remain feature-flagged off for D2C production until the partner confirms production approval. Revolut is the production card provider; Square remains available only as a short rollback option until the Revolut completion and reconciliation checks pass.
