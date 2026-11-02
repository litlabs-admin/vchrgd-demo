# Production recovery provenance

## Limited production release - 29 October 2026

Production is now deployment `dpl_3cWtCPpDAraqYmDHPCuE3nB7iYph`, represented by branch `production/2026-10-29-safe-release` and tag `production-2026-10-29-safe-release`. See the [release record](SAFE_RELEASE_2026-10-29.txt) and [generated source hashes](production-safe-release-source-manifest-20261029.json). Only four application/package files changed from the original production baseline; no database migration or environment change was made. Git remains disconnected from Vercel.

`main` is still the broader unreleased remediation candidate. The candidate description below does not mean the entire candidate was deployed; only the explicitly listed limited-release changes are live. The old production manifest remains historical evidence, not the current release manifest.

## Verified repository candidate — 29 October 2026, not deployed

The [remediation record](REMEDIATION_2026-10-28.txt) addresses the eight findings from the confidential [review](CODE_REVIEW_2026-10-28.txt). It includes dependency updates, transactional persistence, balance-attempt reservation, verified capture/refund handling, session revocation, notification retries and the awaited API lookup. The popup and Squarespace assets also carry the requested corrected URL. These changes are verified in the repository and remain pending site deployment/publication.

`production-source-manifest.json` remains the original 205-file baseline. A separate `remediation-source-manifest-20261028.json` pins each intended runtime change/new file. The checker reports candidate differences explicitly; it never treats this source as identical to production. The recovery description below is dated 21 October and predates these later changes.

Recovery date: 21 October 2026. All cloud/server access for this task was read-only.

## Verified application baseline

- Public alias: `payments.vchrgd.app`.
- Vercel project: `vchrgd-staging`, ID `prj_OFRhCZfnOZseTdK1iAfFXoTqcUDZ`.
- Active deployment: `dpl_3717WEVxQ5Eg8n2djdoAs7u9uCoF`, released 15 October 2026, READY when inspected.
- Local recovery source: sibling folder `home-charging-simple-stats-release-20261015`.
- Verification: authenticated Vercel alias/deployment/source listing; all **205 files** matched the uploaded source SHA-1 values, with zero missing/different files. The [manifest](production-source-manifest.json) contains hashes/paths, not credentials.
- Vercel reported no Git source association for that deployment. This handover therefore restores a verified deployed upload rather than pretending its original release was a Git commit.
- Baseline recovery commit: `0207060` (`Restore verified production source from 15 October deployment`). Its uploaded files preserve the deployed bytes before handover documentation changes.

Three old Apple Pay association files/routes were present in the August checkout but absent from the active uploaded production source. They were preserved in the external working-tree backup and removed from the reconciled baseline to avoid silently adding undeployed runtime routes.

## Proxy verification

A read-only SSH SHA-256 check of `/opt/vchrgd-frasers-live-proxy/server.mjs` matched the recovered `frasers-proxy/server.js`:

`7120aff4d54e17e52d94d1d3ff1e05bd5e149c1efde90c92d08fab2bceeb67aa`

Service/routing examples in `frasers-proxy/live/` are recovered September records; their current installed bytes were not certified. No service restart/configuration write occurred. A guessed sandbox `server.mjs` path did not exist; the sandbox server source was not newly certified.

## Intentional changes after the baseline

- README and handover/development/security/release documentation, a complete readable changelog and source evidence.
- `src/lib/changelog.ts`: historical release entries and an explicitly local handover entry. No payment, workflow, UI layout or pricing logic changed.
- `package.json`: local verification commands and source-lint scope only; runtime dependencies and lockfile retained.
- `.vercelignore`: keep repository-only docs, proxy and marketing handover assets out of future application uploads.
- Local environment example, ignored-private-artifact rules, recovered test/support tools, and marketing/proxy reference material.
- `.gitattributes` disables automatic text conversion so a fresh Windows/Linux checkout preserves the recovered bytes and can reproduce the source-hash audit.

The handover branch preserves earlier Git history. Before replacing any source, the tracked/untracked working files, binary diff, staged diff and Git history bundle were saved outside the repository under the workspace's `.tmp/handover-20261021/before/`. That backup can contain private local material: it is intentionally not committed or part of the agency package.

## Historical evidence

September records came from the workspace's `frasers-live-staging-setup` release notes: production activation/CTA (15 September), selection popup/stage alerts (16 September), click reporting/preferred dates (17 September), DNO booking (23 September), security (24 September), refund controls (25 September), and alert repair (29 September).

October records came from `home-charging-landing/README.md` and its `research/` release verification reports: staging landing page (6 October), checkout copy (12 October), brand/alignment/CTA (14 October), production landing and simple statistics (15 October).

Only sanitised, self-contained evidence is copied under `docs/release-evidence/`. Customer diagnostics, database backups, environment exports, browser sessions and provider secrets are excluded. Early May–September entries are preserved from the production application's original 23-entry changelog; imprecise historical dates remain ranges.

Recovered regression suites came from the isolated `frasers-alert-fix-20260929/scripts` release folder. Squarespace snippets came from `squarespace-embed-code` and were not compared with current CMS settings. Historical documents are explicitly archived and superseded by current guidance.

## Limits and transfer

### GitHub publication update on 28 October 2026

The supplied company remote is now `https://github.com/VCHRGD/vchrgd-d2c.git`. Before initial upload, its visibility was verified as private and the live alias/source listing was rechecked: deployment `dpl_3717WEVxQ5Eg8n2djdoAs7u9uCoF`, all 205 uploaded hashes unchanged. Vercel still has no Git repository connection.

The reachable handover history was checked for private environment/data/key paths, credential patterns and exact matches to known local secret values, with no findings in that check. This is a scoped source review, not a guarantee that every conceivable secret pattern was detected. Only the reviewed branch history is published, as `main` and `handover/production-20261021`; unrelated local branches/worktrees are not mirrored. The original local-only limits below describe the 21 October recovery, before this later authorised GitHub publication.

No deployment, remote push, automatic Git/Vercel connection, environment write, database migration/write, provider registration, payment/refund, customer message or service restart was performed. A supplied company remote and account invitations are still needed for central transfer. Current backup entitlement, a restore drill and end-to-end financial acceptance remain the incoming owner's operational checks.
