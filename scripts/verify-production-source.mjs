import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'docs/production-source-manifest.json'), 'utf8'));
// Preserve the production manifest. A separately pinned candidate records local
// remediation, so a passing check must never imply those fixes are already live.
const candidate = JSON.parse(await readFile(path.join(root, 'docs/remediation-source-manifest-20261028.json'), 'utf8'));
const approved = new Map(candidate.files.map(file => [file.path, file]));
const allowed = new Set(['README.md', '.vercelignore']);
const popupPath = 'src/components/frasers-plus-promo-popup.tsx';
const previousPopupUrl = 'https://application.pay.frasers.plus/?partner=VCHRGD=online&location=frasersplus_webpage';
const correctedPopupUrl = 'https://application.pay.frasers.plus/?partner=VCHRGD&template=online&location=frasersplus_webpage';
const known = new Set(manifest.files.map(f => f.path));
const matched = [], intentionalDifferences = [], pendingRemediationDifferences = [], unexpected = [];
for (const file of manifest.files) {
  try {
    const bytes = await readFile(path.join(root, file.path));
    const digest = createHash('sha1').update(bytes).digest('hex');
    if (digest === file.sha1) matched.push(file.path);
    else {
      const pending = approved.get(file.path);
      if (pending && pending.productionSha1 === file.sha1 && createHash('sha256').update(bytes).digest('hex') === pending.sha256) {
        pendingRemediationDifferences.push(file.path);
        continue;
      }
      const popupUrlOnly = file.path === popupPath &&
        createHash('sha1').update(bytes.toString('utf8').replace(correctedPopupUrl, previousPopupUrl)).digest('hex') === file.sha1;
      (allowed.has(file.path) || popupUrlOnly ? intentionalDifferences : unexpected).push(file.path);
    }
  } catch { unexpected.push(`missing: ${file.path}`); }
}
async function walk(folder) {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const name = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await walk(name);
    else if (!known.has(name)) {
      const pending = approved.get(name);
      const digest = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
      if (pending?.productionSha1 === null && pending.sha256 === digest) pendingRemediationDifferences.push(name);
      else unexpected.push(`extra runtime file: ${name}`);
    }
  }
}
await walk('src');
await walk('public');
const proxy = createHash('sha256').update(await readFile(path.join(root, 'frasers-proxy/server.js'))).digest('hex');
const proxyMatches = proxy === '7120aff4d54e17e52d94d1d3ff1e05bd5e149c1efde90c92d08fab2bceeb67aa';
const productionIdentical = matched.length === manifest.files.length && pendingRemediationDifferences.length === 0;
console.log(JSON.stringify({ status: 'local-remediation-candidate-not-deployed', baseline: manifest.deploymentId,
  productionIdentical, matched: matched.length, intentionalDifferences, pendingRemediationDifferences, unexpected, proxyMatches }, null, 2));
if (unexpected.length || !proxyMatches || (process.argv.includes('--strict-production') && !productionIdentical)) process.exitCode = 1;
