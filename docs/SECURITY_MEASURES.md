# Security controls and ownership

Updated 29 October 2026 for the repository candidate. The candidate includes the eight review fixes but has not been deployed. These are implemented controls and maintenance responsibilities, not a penetration-test certification. See [the remediation record](REMEDIATION_2026-10-28.txt) for compatibility and release gates.

- Hosted providers collect card details; the application stores customer/installation information and transaction references. Keep access and retention appropriate for that operational data.
- Checkout creation uses order-bound capabilities, server-authoritative prices and deduplication. Browser query parameters cannot independently establish payment completion.
- Same-origin checks protect relevant mutations. Admin sessions use signed HTTP-only cookies and production secure settings; disabled managed accounts are rejected. Maintain MFA and restrict account/settings management.
- Signed customer/payment return tokens bind the relevant order/provider references. Progress links are bearer capabilities: do not post them in public tickets or analytics.
- Frasers callbacks use configured bearer authentication and fail closed when missing. Square/Revolut signatures and Jumptech signing/timestamp/replay checks protect provider updates. Preserve all relevant secrets and callbacks during rotation.
- Mock payment routes are disabled in production by default. Do not turn them on to troubleshoot live payments.
- Production data should use durable configured storage. Memory/file modes are local/test facilities, not substitutes for production persistence.
- Gmail supports Vercel OIDC/Google identity federation with delegated sending and a locked sender. Keep permissions minimal; production private-key fallback is rejected unless deliberately overridden.
- Sensitive/admin/customer/API responses use no-store headers. Global transport/browser headers are in `next.config.ts`; CSP is report-only and must not be described as enforced CSP.
- Refund and notification reservations protect against duplicates. Uncertain outcomes require provider/operator reconciliation, not indiscriminate reservation deletion.
- JSON mutations use PostgreSQL transactions/advisory locks; durable balance reservations prevent a second payable checkout. Existing pending links and uncertain results require reconciliation before replacement.
- Credential/MFA/access changes rotate administrator session versions. The first candidate deployment requires an administrator relogin. Customer checkout/return tokens are unaffected.
- Verified card refunds are terminal; the legacy Frasers mutation endpoint uses confirmed capture and sends refund/reversal requests through the back-office workflow.
- The fixed-IP proxy listens on loopback behind Caddy. Live upstream credentials remain on the droplet; the application uses a separate proxy credential. `/live/_state/*` must remain blocked.

## Operator responsibilities

Review access and offboarding, maintain backups/restores and dependency/OS updates, restrict logs/exports, test credentials only in isolated environments, and monitor callback/cron failures. Verify actual Supabase backup/PITR coverage and account recovery in the service dashboards.

The handover excludes `.env*`, `.data`, local logs, SSH keys, customer exports and private diagnostic files. A company secrets manager and access policy are required for transfer; Git is not a credential store. A private company Git remote is established; Chapeau access and credential transfer still require explicit owner action.

Run `npm run security:check`, `npm test`, source lint and a clean build as described in [DEVELOPMENT.md](DEVELOPMENT.md). The static security check is a source assertion tool, not an exhaustive security audit. See [verification](VERIFICATION.md) for actual current results and limitations.

The earlier control list is archived at [archive/SECURITY_MEASURES.md](archive/SECURITY_MEASURES.md). Its disabled-Frasers and original Square-cutover statements are superseded.

## Current dependency findings

The 29 October audit of the final candidate lockfile reports zero known vulnerabilities. Next.js 16.4.3, sharp 0.35.5, zod 4.6.7 and source-map-js 1.2.2 address the dependency item. The recorded live deployment has not been upgraded by this work. See [current audit](release-evidence/remediation-20261029/dependency-audit.json); older audit snapshots remain dated evidence. No automatic force fix or Vercel OIDC downgrade was applied.
