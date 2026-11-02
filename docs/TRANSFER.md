# Transferring the handover

Current production source is branch `production/2026-10-29-safe-release`, tagged `production-2026-10-29-safe-release`, for deployment `dpl_3cWtCPpDAraqYmDHPCuE3nB7iYph`. See [release details](SAFE_RELEASE_2026-10-29.txt). `main` remains the broader unreleased remediation candidate. Git publication does not deploy either branch.

The company repository is [VCHRGD/vchrgd-d2c](https://github.com/VCHRGD/vchrgd-d2c). On 28 October 2026 it was verified private and configured as `origin`. Use `main` for the current verified remediation candidate; `fix/handover-review-20261028` records that work. `handover/production-20261021` retains the original published handover snapshot. Git publication does not deploy the candidate. No automatic deployment integration was configured, and no live site was changed.

Once repository access has been explicitly granted, clone the current company repository using your own authorised GitHub identity:

```sh
git clone https://github.com/VCHRGD/vchrgd-d2c.git
cd vchrgd-d2c
```

The bundle and source ZIP described below remain the original 21 October snapshots and do not contain later publication notes, remediation or the popup URL correction. They must not be substituted for current `main` when taking over maintenance.

The companion Git bundle preserves this branch and its ancestor history. In a simple path without apostrophes, the incoming company can clone it with:

```sh
git clone -b handover/production-20261021 D2C-Handover-2026-10-21.bundle vchrgd-d2c
cd vchrgd-d2c
```

The source ZIP is an alternative code/document snapshot and does not contain Git history. Both exports intentionally exclude working-tree secrets, local customer data, logs, installed dependencies and private recovery material. Install dependencies using the committed lockfile and follow [DEVELOPMENT.md](DEVELOPMENT.md).

Read [HANDOVER.md](HANDOVER.md), [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md), [VERIFICATION.md](VERIFICATION.md) and the dependency-audit findings before assuming ownership. The historical Git ancestry is retained for traceability; old commits and archived documentation are not deployment instructions.

Grant Chapeau access only through the private repository's collaborator settings, using the agreed role. Organisation ownership, broader membership, credentials and system access are separate decisions. Connecting the repository to Vercel or enabling automatic production promotion requires a separate release decision; the initial GitHub publication does neither.

Credentials and service-account invitations must be supplied through the account owners and an approved secrets channel. The external `.tmp/handover-20261021/before/` backup may contain private local diagnostics and is intentionally not part of the handover exports.
