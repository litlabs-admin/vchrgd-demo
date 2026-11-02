# Production release and readiness

Updated 29 October 2026. This is a procedure for future authorised changes; the handover and repository remediation did not deploy or change live systems.

The verified remediation candidate requires the additional [release gates](REMEDIATION_2026-10-28.txt): Supabase transactions/advisory locks, administrator relogin, reconciliation of old/uncertain payment attempts and a controlled transition from old workers that do not take the new locks. Do not infer a release approval from a green build or Git publication.

## Establish the target

Production is `payments.vchrgd.app`, project **`vchrgd-staging`** (`prj_OFRhCZfnOZseTdK1iAfFXoTqcUDZ`). Staging is a different project, `vchrgd-frasers-staging` (`prj_qqcntEsa5JavYxkxSUR30k5AJhDj`), serving `staging.vchrgd.app`.

The recovered baseline is deployment `dpl_3717WEVxQ5Eg8n2djdoAs7u9uCoF`. Recheck the live alias and complete diff before release; another release may have happened since recovery. Do not deploy a stale sibling desktop folder or copy staging wholesale over production.

## Before a candidate build

1. Review the intended change and the full branch diff, and ensure the source baseline is current.
2. Use company-controlled source access. Connecting Git to Vercel can enable automatic builds/promotions; configure that deliberately rather than as a side effect of repository transfer.
3. Verify production versus preview/staging environment scope and store modes securely. Never print provider secrets or load live settings into local tests.
4. Confirm card routing, Frasers flags, URLs, callback authentication, Google identity restrictions, cron settings, data namespace and backup arrangements. Frasers was activated on 15 September; old instructions to leave it disabled are historical.
5. Run the [development checks](DEVELOPMENT.md), relevant synthetic regression suites, and dependency security review. Record limitations rather than claiming a whole-tree lint or real payment passed.
6. Exercise affected customer/admin journeys in an isolated staging environment with test providers and synthetic records.
7. Identify the rollback deployment and any schema/behaviour incompatibilities; confirm backups without restoring old customer records into production.

## Candidate and promotion

Build and inspect a candidate in the verified target project using its approved deployment process. Compare uploaded source/configuration with the intended change. Inspect responsive UI, public prices, signed-return behaviour, protected admin endpoints and rejection of invalid/unsigned callbacks. Avoid creating real payment applications, refunds or notifications during generic smoke testing.

Promote only through the business's agreed release approval. Verify the final alias, build and scoped settings, then monitor callbacks, reconciliation, scheduled jobs and operational errors. Update the changelog, deployment reference and verification record in the same change.

A private company Git remote is established, without automatic deployment integration. Old deployment helpers can contain desktop paths and historical baseline guards and are not a generic release pipeline.

## Rollback

Prefer a targeted forward fix where rollback would reintroduce security defects. If rollback is needed, verify the previous deployment is suitable for the current environment/schema and in-flight provider events. Preserve webhook/return handling, live proxy routing, credentials, payment records and dedupe receipts. A code rollback does not reverse actual payments/refunds and must not restore old customer data.

Both public and server Frasers flags matter; changing variables alone does not rewrite a previously built public bundle. Resolve any ambiguous refund or message-delivery reservation against the provider before retrying or releasing it.

The earlier checklist is retained under [archive](archive/PRODUCTION_READINESS.md), including its original historical test/cutover instructions. It is not current operating guidance.
