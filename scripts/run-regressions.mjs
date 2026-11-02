import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Do not forward inherited payment, database, email or cloud credentials.
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, { NODE_ENV: 'test', APP_DATA_STORE: 'memory', SECURITY_REGRESSION: 'true' });
const suites = [
  'test-security-hardening.cjs', 'test-frasers-prerelease.cjs',
  'test-outstanding-balance.cjs', 'test-dno-booking.cjs',
  'test-manual-refunds.cjs', 'test-provider-refunds.cjs',
  'test-checkout-clicks.cjs', 'test-preferred-dates.cjs', 'test-stage-alerts.cjs',
  'test-landing-statistics-client.cjs',
  'test-handover-remediation.cjs',
];
let failures = 0;
for (const suite of suites) {
  console.log(`Running ${suite}`);
  const result = spawnSync(process.execPath, ['--require', './scripts/offline-test-guard.cjs', `scripts/${suite}`], {
    cwd: root, env, stdio: 'inherit', timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    failures++;
    if (result.error) console.error(result.error.message);
  }
}
if (failures) {
  console.error(`${failures} regression suite(s) failed.`);
  process.exitCode = 1;
} else console.log(`All ${suites.length} offline regression suites passed.`);
