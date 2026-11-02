# VCHRGD checkout — client demo deployment

This folder is a **standalone demo copy** of the redesigned checkout. It must never be connected to VCHRGD's live systems.

- Demo 1 (redesigned checkout): `https://<your-project>.vercel.app/`
- Demo 2 (checkout with new hero): `https://<your-project>.vercel.app/hero`

Payments, emails, Jumptech and the database all run in **mock mode**. The walk-through is meant to stop at "Review and pay"; the pay buttons open mock pages only.

## Differences from the main project

| File | Change | Why |
| --- | --- | --- |
| `vercel.json` | `crons` removed | The Hobby plan rejects jobs that run more often than daily, and they need live data |
| `src/lib/product-settings.ts`, `src/components/integration-showcase.tsx` | Default prices set to £895 / £935 | No database here, so the live prices must be the defaults |
| Env vars | Mock values only (below) | Nothing real is reachable from this project |

`src/middleware.ts` normally sends any `*.vercel.app` address to the live site. The env var `DISABLE_CUSTOMER_HOST_REDIRECT=true` turns that off for this project. **Without it, visitors are redirected to the live checkout.**

## Deploy steps

1. In this folder: `git init`, `git add -A`, `git commit -m "Client demo"`.
2. Create a new **private** repository in the LitLabs GitHub account and push to it.
3. In Vercel (LitLabs account): **Add New → Project**, import the repo. Framework: Next.js. Leave the build settings as default.
4. Before the first deploy, add these **Environment Variables** (Production and Preview):

```
DISABLE_CUSTOMER_HOST_REDIRECT=true
APP_DATA_STORE=memory
APP_DATA_NAMESPACE=client-demo
ENABLE_FRASERS_PLUS=true
NEXT_PUBLIC_ENABLE_FRASERS_PLUS=true
FRASERS_PLUS_USE_MOCK=true
ENABLE_MOCK_PAYMENT_ROUTES=true
FRASERS_PLUS_LIVE_PRODUCTION=false
FRASERS_PLUS_LIVE_VALIDATION=false
CARD_PAYMENT_PROVIDER=revolut
REVOLUT_FORCE_LOCAL_DEMO=true
PREBOOKING_STAGE_ALERTS_ENABLED=false
ADDITIONAL_COSTS_EMAILS_ENABLED=false
CHECKOUT_ACCESS_SECRET=<generate: any random 64-character string>
FRASERS_PLUS_RETURN_TOKEN_SECRET=<generate: a different random string>
```

   After the first deploy, also set these to the project's URL and redeploy:

```
APP_URL=https://<your-project>.vercel.app
PUBLIC_APP_URL=https://<your-project>.vercel.app
NEXT_PUBLIC_APP_URL=https://<your-project>.vercel.app
```

   To generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

5. Open `/` and `/hero` and check that the address stays on `vercel.app` (no redirect to payments.vchrgd.app).

## Never add to this project

Supabase / database URLs, Revolut or Square keys, Tymit / Frasers Plus live credentials, Jumptech keys, Google / Gmail credentials, `CRON_SECRET`, or admin login values.

## Notes

- The site is already hidden from search engines (`noindex` in `src/app/layout.tsx`). On the Hobby plan, access control is "only people with the link".
- With no database, prices come from the built-in defaults (`src/lib/product-settings.ts` on the server, `CHARGERS` in `src/components/integration-showcase.tsx` as fallback). In this demo copy they are set to the live prices, £895 untethered and £935 tethered.
