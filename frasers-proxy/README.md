# Frasers Plus fixed-IP proxy

The Node proxy supplies a stable outbound IP for Frasers merchant API requests. The live source at `/opt/vchrgd-frasers-live-proxy/server.mjs` was compared read-only on 21 October 2026: its SHA-256 matches this directory's `server.js`:

`7120aff4d54e17e52d94d1d3ff1e05bd5e149c1efde90c92d08fab2bceeb67aa`

The installed filename differs; the service example intentionally starts `server.mjs`. No proxy service, routing or credentials were changed during handover.

## Existing service separation

| Purpose | Service / port | Public route | Upstream |
| --- | --- | --- | --- |
| Sandbox | `vchrgd-frasers-proxy` / loopback 3025 | root proxy routes | `https://merchant-api.staging.tymit.com` |
| Live | `vchrgd-frasers-live-proxy` / loopback 3026 | `/live/v1/*`, `/live/health` | `https://merchant-api.frasersplus.fgfs.services` |

Both are reached through `frasers-proxy.payments.vchrgd.app`, on DigitalOcean's recorded allowlisted IP `143.110.170.126`. The examples in `live/` were recovered from the September setup records; they are not an instruction to overwrite the current server configuration.

The top-level service and Caddy examples predate the live route and describe sandbox setup. Use the `live/` examples to understand the dual-service arrangement. Confirm actual installed paths/configuration before future maintenance.

## Configuration and security

The live environment file is `/etc/vchrgd-frasers-live-proxy.env`, root-owned and mode 600. Required names include `PORT`, `TYMIT_API_BASE_URL`, `TYMIT_API_KEY`, `VCHRGD_PROXY_SHARED_SECRET`, `MAX_BODY_BYTES` and `STATE_FILE`. Credentials are transferred separately; no live values are supplied here.

The proxy accepts the configured shared secret from the application and injects the real upstream API key server-side. The application's `FRASERS_PLUS_API_KEY` therefore represents the proxy credential when proxy routing is used, not the real provider key.

Only reviewed API paths/methods should be forwarded. Keep the service loopback-only, Caddy/TLS and service hardening in place. Caddy must not expose live state routes: `/live/_state/*` returns 404. Sandbox/remote state has separate operational history; do not move production state to it or replace it blindly.

Do not use the earlier generic `merchant-api.tymit.com` documentation as the current live endpoint. Preserve existing IP allowlisting and in-flight callbacks if infrastructure is moved.

## Maintenance

Use read-only health, service status and sanitised log checks first. Apply OS/Node/Caddy updates through the agreed maintenance window. Retain a known-good code/config backup, check service syntax and routing before reload, and verify both sandbox and live separation afterwards. Never log customer payloads or credentials. A read-only health response alone does not certify successful financial authorisation/capture.

Local `node --check frasers-proxy/server.js` validates syntax without starting a server. Do not run historical installers or bootstrap scripts against the existing droplet without reviewing current state.
