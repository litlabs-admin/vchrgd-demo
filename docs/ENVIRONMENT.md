# Environment variable inventory

Generated 21 October 2026 from direct `process.env.NAME` references in the recovered application and proxy. This lists names and code locations only, never live values. It is a source inventory, not an export or certification of current hosting configuration. Dynamically indexed names and provider dashboard settings may require additional review.

Use `.env.example` only for isolated local development. Production values belong in the correct Vercel environment or protected proxy environment file. Every `NEXT_PUBLIC_*` value can be exposed to the browser and must contain no secret.

Production uses durable Supabase/PostgreSQL storage; staging/proxy namespaces must remain separate. Confirm the active mode and URLs securely before changes. The helper supports `file`, `memory`, `remote` and `supabase`; code support does not mean every mode is in current production use.

Review groups together: application URLs/storage; admin/MFA/Google OAuth; Revolut; legacy Square; Frasers flags/proxy/return/webhook secrets; Jumptech; Google Gmail federation/delegation/Chat; cron/recovery/stage-alert policy; date-cohort settings. Changing provider flags, storage or secrets can affect in-flight transactions.

| Variable | Code references |
| --- | --- |
| `ADDITIONAL_COSTS_EMAIL_ADMIN_TOKEN` | `src/app/api/additional-costs-email/send/route.ts` |
| `ADDITIONAL_COSTS_EMAILS_ENABLED` | `src/lib/additional-costs-email-sender.ts` |
| `ADMIN_PASSWORD` | `src/lib/admin-auth.ts` |
| `ADMIN_PASSWORD_HASH` | `src/lib/admin-auth.ts` |
| `ADMIN_SESSION_SECRET` | `src/lib/admin-auth.ts`, `src/lib/checkout-access.ts`, `src/lib/checkout-recovery-token.ts`, `src/lib/frasers-plus-return-token.ts` |
| `ADMIN_TOTP_SECRET` | `src/lib/admin-auth.ts` |
| `ADMIN_USERNAME` | `src/lib/admin-auth.ts` |
| `ALLOW_PLAIN_ADMIN_PASSWORD` | `src/lib/admin-auth.ts` |
| `APP_DATA_API_SECRET` | `src/lib/server-data.ts` |
| `APP_DATA_API_URL` | `src/lib/server-data.ts` |
| `APP_DATA_NAMESPACE` | `src/lib/landing-analytics.ts`, `src/lib/prebooking-stage-alerts.ts`, `src/lib/server-data.ts` |
| `APP_DATA_STORE` | `src/lib/landing-analytics.ts`, `src/lib/server-data.ts` |
| `APP_URL` | `src/lib/app-url.ts` |
| `CARD_PAYMENT_PROVIDER` | `src/lib/square.ts` |
| `CARD_RECONCILIATION_CRON_SECRET` | `src/app/api/card-checkout/reconcile/route.ts` |
| `CARD_RECONCILIATION_MAX_AGE_DAYS` | `src/lib/card-payment-reconciliation.ts` |
| `CHECKOUT_ACCESS_SECRET` | `src/lib/checkout-access.ts` |
| `CHECKOUT_RECOVERY_ACTIVE_FROM` | `src/lib/checkout-recovery-scheduler.ts` |
| `CHECKOUT_RECOVERY_CRON_SECRET` | `src/app/api/checkout-recovery/send-due/route.ts` |
| `CHECKOUT_RECOVERY_EMAILS_ENABLED` | `src/lib/checkout-recovery-scheduler.ts` |
| `CHECKOUT_RECOVERY_TOKEN_SECRET` | `src/lib/checkout-recovery-token.ts` |
| `CRON_SECRET` | `src/app/api/additional-costs-email/send/route.ts`, `src/app/api/backoffice/stage-alerts/route.ts`, `src/app/api/card-checkout/reconcile/route.ts`, `src/app/api/checkout-recovery/send-due/route.ts`, `src/app/api/landing-analytics/cleanup/route.ts` |
| `DATABASE_URL` | `src/lib/landing-analytics.ts`, `src/lib/server-data.ts` |
| `ENABLE_FRASERS_PLUS` | `src/app/api/frasers-plus/payment/route.ts`, `src/app/page.tsx` |
| `ENABLE_MOCK_PAYMENT_ROUTES` | `src/lib/mock-route-guards.ts` |
| `FRASERS_PLUS_API_BASE_URL` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_API_KEY` | `src/lib/frasers-plus-return-token.ts`, `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_DEBUG` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_LIVE_PRODUCTION` | `src/lib/frasers-plus-return-token.ts`, `src/lib/frasers-plus.ts`, `src/lib/mock-route-guards.ts` |
| `FRASERS_PLUS_LIVE_RETURN_TOKEN_SECRET` | `src/lib/frasers-plus-return-token.ts`, `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_LIVE_VALIDATION` | `src/lib/frasers-plus.ts`, `src/lib/mock-route-guards.ts` |
| `FRASERS_PLUS_MERCHANT_ID` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_MERCHANT_NAME` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_REDIRECT_URL` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_RETURN_LOCATION_CODE` | `src/lib/frasers-plus-capture.ts` |
| `FRASERS_PLUS_RETURN_TOKEN_SECRET` | `src/lib/frasers-plus-return-token.ts`, `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_SHOP_CODE` | `src/lib/frasers-plus-capture.ts` |
| `FRASERS_PLUS_USE_MOCK` | `src/lib/frasers-plus.ts` |
| `FRASERS_PLUS_WEBHOOK_AUTH_VALUE` | `src/lib/frasers-plus.ts` |
| `GCP_AUDIENCE` | `src/lib/gmail-sender.ts` |
| `GCP_PROJECT_NUMBER` | `src/lib/gmail-sender.ts` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `src/lib/gmail-sender.ts` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `src/lib/gmail-sender.ts` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `src/lib/gmail-sender.ts` |
| `GOOGLE_ADMIN_ALLOWED_DOMAINS` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_ADMIN_CLIENT_ID` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_ADMIN_CLIENT_SECRET` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_ADMIN_HOSTED_DOMAIN` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_ADMIN_REDIRECT_URI` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_ADMIN_USE_CONFIGURED_REDIRECT` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_CHAT_WEBHOOK_URL` | `src/lib/google-chat-notifications.ts`, `src/lib/prebooking-stage-alerts.ts` |
| `GOOGLE_CLIENT_ID` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_CLIENT_SECRET` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_GMAIL_ALLOW_PRIVATE_KEY_FALLBACK` | `src/lib/gmail-sender.ts` |
| `GOOGLE_GMAIL_ALLOWED_SENDER` | `src/lib/gmail-sender.ts` |
| `GOOGLE_GMAIL_CLIENT_EMAIL` | `src/lib/gmail-sender.ts` |
| `GOOGLE_GMAIL_IMPERSONATE_USER` | `src/lib/gmail-sender.ts` |
| `GOOGLE_GMAIL_PRIVATE_KEY` | `src/lib/gmail-sender.ts` |
| `GOOGLE_GMAIL_SERVICE_ACCOUNT_EMAIL` | `src/lib/gmail-sender.ts` |
| `GOOGLE_OAUTH_CLIENT_ID` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_OAUTH_HOSTED_DOMAIN` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_OAUTH_REDIRECT_URI` | `src/lib/google-admin-auth.ts` |
| `GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` | `src/lib/gmail-sender.ts` |
| `JUMPTECH_API_BASE_URL` | `src/lib/jumptech.ts` |
| `JUMPTECH_API_TOKEN` | `src/lib/jumptech.ts` |
| `JUMPTECH_INITIAL_ACTION` | `src/lib/jumptech.ts` |
| `JUMPTECH_INTEGRATION_NAME` | `src/lib/jumptech.ts` |
| `JUMPTECH_PREFERRED_LOCALE` | `src/lib/jumptech.ts` |
| `JUMPTECH_PROJECT_SOURCE` | `src/lib/jumptech.ts` |
| `JUMPTECH_PROJECT_TYPE` | `src/lib/jumptech.ts` |
| `JUMPTECH_WEBHOOK_SECRET` | `src/lib/jumptech.ts` |
| `MAX_BODY_BYTES` | `frasers-proxy/server.js` |
| `NEXT_PUBLIC_APP_URL` | `src/lib/app-url.ts` |
| `NEXT_PUBLIC_ENABLE_FRASERS_PLUS` | `src/app/api/frasers-plus/payment/route.ts`, `src/app/page.tsx` |
| `NEXT_PUBLIC_SHOW_DEMO_CONTROLS` | `src/app/page.tsx` |
| `NODE_ENV` | `src/app/api/card-checkout/reconcile/route.ts`, `src/app/api/checkout-recovery/send-due/route.ts`, `src/app/card/return/page.tsx`, `src/app/frasers-plus/return/page.tsx`, `src/app/page.tsx`, `src/lib/admin-auth.ts`, `src/lib/checkout-access.ts`, `src/lib/checkout-recovery-token.ts`, `src/lib/frasers-plus.ts`, `src/lib/gmail-sender.ts`, `src/lib/google-admin-auth.ts`, `src/lib/mock-route-guards.ts`, `src/lib/prebooking-stage-alerts.ts`, `src/lib/server-data.ts` |
| `PORT` | `frasers-proxy/server.js` |
| `POSTGRES_URL` | `src/lib/landing-analytics.ts`, `src/lib/server-data.ts` |
| `PREBOOKING_STAGE_ALERTS_ENABLED` | `src/lib/prebooking-stage-alerts.ts` |
| `PREBOOKING_STAGE_ALERTS_INCLUDE_EXISTING` | `src/lib/prebooking-stage-alerts.ts` |
| `PREFERRED_INSTALLATION_DATES_DISABLED_FROM` | `src/lib/preferred-installation-dates-policy.ts` |
| `PUBLIC_APP_URL` | `src/lib/app-url.ts` |
| `REVOLUT_API_BASE_URL` | `src/lib/revolut.ts` |
| `REVOLUT_API_KEY` | `src/lib/revolut.ts` |
| `REVOLUT_API_VERSION` | `src/lib/revolut.ts` |
| `REVOLUT_CURRENCY` | `src/lib/revolut.ts` |
| `REVOLUT_FORCE_LOCAL_DEMO` | `src/lib/revolut.ts` |
| `REVOLUT_REDIRECT_URL` | `src/lib/revolut.ts` |
| `REVOLUT_WEBHOOK_SIGNING_SECRET` | `src/lib/revolut.ts` |
| `REVOLUT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | `src/lib/revolut.ts` |
| `SHOW_DEMO_CONTROLS` | `src/app/page.tsx`, `src/lib/mock-route-guards.ts` |
| `SQUARE_ACCESS_TOKEN` | `src/lib/square.ts` |
| `SQUARE_API_BASE_URL` | `src/lib/square.ts` |
| `SQUARE_API_VERSION` | `src/lib/square.ts` |
| `SQUARE_APPLICATION_ID` | `src/lib/square.ts` |
| `SQUARE_CARD_CHECKOUT_ENABLED` | `src/lib/square.ts` |
| `SQUARE_CURRENCY` | `src/lib/square.ts` |
| `SQUARE_ENVIRONMENT` | `src/lib/square.ts` |
| `SQUARE_LOCATION_ID` | `src/lib/square.ts` |
| `SQUARE_REDIRECT_URL` | `src/lib/square.ts` |
| `SQUARE_USE_CONFIGURED_REDIRECT_HOST` | `src/lib/square.ts` |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | `src/lib/square.ts` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `src/lib/square.ts` |
| `SQUARE_WEBHOOK_URL` | `src/lib/square.ts` |
| `STATE_FILE` | `frasers-proxy/server.js` |
| `SUPABASE_DB_URL` | `src/lib/landing-analytics.ts`, `src/lib/server-data.ts` |
| `TYMIT_API_BASE_URL` | `frasers-proxy/server.js` |
| `TYMIT_API_KEY` | `frasers-proxy/server.js` |
| `VCHRGD_PROXY_SHARED_SECRET` | `frasers-proxy/server.js` |
| `VERCEL` | `src/lib/frasers-plus.ts`, `src/lib/prebooking-stage-alerts.ts`, `src/lib/server-data.ts` |
