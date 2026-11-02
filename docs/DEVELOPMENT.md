# Development and verification

Use a checkout path without apostrophes (for example `C:/work/vchrgd-d2c`): the recovered Next.js metadata loader can emit invalid JavaScript when an absolute favicon path contains an apostrophe. This was reproduced in the original desktop workspace; verify builds in the simple path rather than changing application code to hide the tooling issue.

Use a fresh checkout or clean source export without any production `.env*`, `.vercel` link, credentials, `.data` or logs. Existing desktop checkouts may contain live environment files; Next.js can automatically load them during development/build. Do not assume `npm run dev` is isolated in such a checkout.

## Install and run locally

Use a maintained Node.js runtime meeting the locked dependencies' engine requirements and npm. Run `npm ci`, copy `.env.example` to `.env.local`, and generate local-only admin secrets if needed. Set `APP_URL`, `PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_URL` to localhost. Start with memory storage and mock payments. Leave email, Chat, Jumptech and database credentials absent until using explicitly isolated test services.

`npm run dev` starts the local app. The static landing page lives in `public/home-charging/`; production's path rewrite is in `vercel.json`, so a local Next server may require `/home-charging/index.html` for the static page. Do not assume Vercel rewrites or cron are automatically reproduced by local development.

## Repeatable checks

```sh
npm run verify:production-source
npm run security:check
npm test
npm run lint
npm run typecheck
npm run build -- --webpack
```

The first command is offline: it preserves the 205-file production manifest and checks intended remediation changes/new runtime files against `remediation-source-manifest-20261028.json`. It reports `productionIdentical: false` for this undeployed candidate. Adding `-- --strict-production` to the npm command intentionally fails while bytes differ from the old production baseline. Candidate hashes must be updated only after reviewing a deliberate source change.

`npm test` runs eleven suites: the recovered September security/payment/workflow regressions, isolated landing-statistics client checks and 57 desired-behaviour remediation assertions. The runner strips inherited integration credentials, sets memory storage and blocks actual network sockets. Fixtures/mock responses execute application logic without real payment, database, email or Chat operations. The historical review reproduction script intentionally expects the original defects and must not be used as a green test for corrected code.

The recovered harnesses use their existing `SECURITY_REGRESSION=true` mode to skip release-specific comparisons with old sibling directories; business/security assertions still run. Exact source preservation is now checked separately against the production manifest. `test-cta.cjs` and `test-selection-popup.cjs` remain historical release guards, excluded from `npm test`: they require old sibling release fixtures and cannot serve as current portable acceptance tests. Do not weaken their old assertions merely to obtain a green result.

The old statistics research script accessed a real database in an isolated namespace; it was not included or run. The portable replacement exercises browser behaviour with fake storage/time and mocked fetch only. Database concurrency/retention integration tests require a separate isolated database and are not certified by the client tests.

The separate `scripts/test-state-transactions.cjs` accepts an explicit disposable PostgreSQL URL argument, only on `127.0.0.1` with a `remediation_` database name and an explicit port. It never reads application database credentials. Run it only against a new synthetic test database; it is deliberately outside the network-blocked `npm test` runner. The 29 October run verified two clients, 50 concurrent orders, rollback, nested transactions, legacy payloads and balance reservations. See the [evidence](release-evidence/remediation-20261029/validation-results.json).

Production mutations require Supabase/Postgres. File mode is development-only and the legacy remote store has no transaction protocol; those mutation modes fail closed in this candidate. Deployment also requires an administrator relogin once, reconciliation of old/uncertain balance attempts and a controlled transition from old workers that do not take the new advisory locks. Follow [the release gates](REMEDIATION_2026-10-28.txt).

Source lint deliberately runs over `src` rather than claiming legacy CommonJS operator scripts satisfy all Next.js TypeScript lint rules. The production build uses Webpack here because historical Windows dependency layouts can cause Turbopack junction issues. No application build configuration was changed for handover.

## Deliberate operator tools

Credential generation, webhook registration, installer import and demo reset scripts are not part of automated verification. Registration can change external provider settings; reset can delete local state; imports can affect the configured datastore. Review target credentials and code before using them. The historical staging deployment helper in `scripts/legacy/` contains desktop-specific assumptions and is retained only as context, not as the current deployment workflow.

Never run `vercel --prod`, promotion, environment writes, service installers or financial operations as part of routine local checks. Future releases follow [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
