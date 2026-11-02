# Handover verification — current candidate and historical baseline

## 29 October 2026 — verified repository candidate, not deployed

The eight review fixes and corrected popup URL are included in the candidate. Checks use a clean source copy with the final lockfile and no production environment files or deployment link. Results are saved in [validation evidence](release-evidence/remediation-20261029/validation-results.json).

| Check | Result |
| --- | --- |
| Offline regressions | All eleven suites pass: 1,537 recovered assertions, 57 remediation assertions and landing-client checks |
| Static security controls | 13 pass |
| Final lockfile audit | Zero known vulnerabilities; [raw audit](release-evidence/remediation-20261029/dependency-audit.json) |
| Source lint, TypeScript and clean Webpack build | Pass with patched Next.js 16.4.3 and deliberately retained baseline lint ruleset |
| Isolated PostgreSQL 17 integration | Two application clients retain all 50 concurrent orders/audits; 14 additional checks cover rollback, nested transactions, legacy payloads and cross-client balance reservations |
| Source preservation | Original production manifest retained; intended changes pinned separately; candidate is explicitly not identical to production |
| Live systems | No deployment, environment change, account invitation, real payment/refund, notification or production database write |

The existing middleware-to-proxy deprecation remains. The lint ruleset is intentionally retained at eslint-config-next 16.3.6 / hooks 7.0.1 to avoid unrelated UI changes; its declared dependency range is respected. This is not an exhaustive security certification. Real provider/Google staging acceptance, actual Supabase permissions/TLS/backup checks and production promotion remain gated on access and approval. See [release gates](REMEDIATION_2026-10-28.txt).

## Historical verification — 21–28 October 2026

The snapshots below describe the earlier recovered code and its dated checks. Their dependency counts, lockfile-preservation statements and lack of a remote do not describe the current candidate.

**28 October code review:** [targeted source review and seven offline defect reproductions](CODE_REVIEW_2026-10-28.txt) identified open corrective work. The fresh dependency audit is 1 critical / 5 high package entries; the 21 October figures below remain dated evidence. Final fresh-install validation is recorded under `release-evidence/code-review-20261028/`. The Frasers popup application URL has also been corrected locally at Alex's request, pending publication; the manifest checker allows only the exact URL substitution in that component. No production change was performed.

**28 October update:** the reviewed company repository is now `https://github.com/VCHRGD/vchrgd-d2c.git`, verified private for the initial upload. The live deployment/source hashes were rechecked without differences and Vercel remains disconnected from Git. The no-remote statements below describe the original 21 October handover, before the later GitHub publication. See [source provenance](SOURCE_PROVENANCE.md).

Checks used a clean source copy without production environment files or deployment metadata. Dependencies were installed with the recovered `package-lock.json`; runtime dependency definitions and lockfile remained identical to production. Runtime used: Node.js 25.6.1 on Windows. A supported compatible runtime should be selected and verified by the incoming team.

| Check | Result |
| --- | --- |
| Authenticated active Vercel source inspection | All 205 recovered files matched uploaded SHA-1 values before handover edits |
| Live Frasers proxy source | Read-only SHA-256 matched recovered `server.js` |
| Final offline production comparison | 201 baseline files identical; only README, npm script metadata, deployment exclusions and application changelog intentionally differ; no unexpected/extra runtime files |
| Static security assertions | 13 controls passed |
| Offline regressions | All 10 suites passed: 1,537 recovered assertions plus landing-statistics client checks |
| Source lint | `eslint src --quiet` passed |
| TypeScript | `tsc --noEmit` passed; production build's TypeScript step also passed |
| Clean Webpack production build | Passed, including static generation |
| Dependency audit | **8 high-severity package findings**; recorded, not remediated in this source-recovery task |
| Final read-only live check | Production alias still points to the same deployment; public landing HTML/analytics JS/CSS still match |

## Regression scope

The recovered suites cover security hardening (99), Frasers preparation (106), outstanding balances (67), DNO/booking (471), manual refund workflow (303), provider refund adapters (74), checkout clicks (139), preferred-date cohorts (87), and stage alerts (191). Provider calls and storage are fixtures; the runner removes inherited integration credentials and prevents actual network connections. The landing client checks use fake time/storage/fetch and cover engagement, repeat clicks, opt-out, GPC and blocked storage.

Historical feature-release source snapshots are skipped using the harnesses' existing security-regression mode. They are replaced for this handover by the explicit production manifest comparison. The old CTA/popup snapshot scripts are retained but excluded from the portable runner because their original sibling release fixtures are not part of a fresh checkout. They are not reported as passing.

## Build limitations and findings

The first build in the apostrophe-containing desktop path failed in Next.js's generated favicon metadata code. The same source and clean installed dependencies built successfully in `C:/Users/Alexa/.codex/tmp/d2c-handover-20261021`. Clone into a simple path without apostrophes; no application workaround was introduced.

The successful build emitted the existing middleware-to-proxy deprecation and upstream Edge-runtime `process.cwd` warnings. These are recorded maintenance items, not hidden as a warning-free build. A migration belongs in a separately tested change.

The [dependency audit](dependency-audit-20261021.json) records current package findings, including runtime Next.js/sharp and tooling. No `npm audit fix`, force upgrade or suggested lint-tool downgrade was applied. The historical September report of zero known findings must not be presented as the current audit outcome.

No new live financial transaction, refund, callback registration, notification, database integration/restore drill, load test or visual redesign acceptance was performed. Database retention/concurrency claims in historical release evidence are dated results, not reruns against a live database during this handover.

## Live-site preservation and transfer

No deployment, promotion, environment mutation, datastore write, service restart or remote push was issued. The final [read-only check](release-evidence/handover-readonly-20261021.json) records the unchanged production alias and public source matches. `.vercel` links, credentials, local data/logs and the external private working-tree backup are excluded from transfer.

No Git remote was configured. The local committed branch and companion bundle/source archive are ready for review and transfer; company-controlled hosting, account invitations and secrets transfer remain owner actions. See [TRANSFER.md](TRANSFER.md).
