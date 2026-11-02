const fs = require('node:fs');
const path = require('node:path');
function withoutClickAdditions(name, source) {
  name = name.replaceAll('\\', '/');
  source = source.replace(/\r\n/g, '\n');
  if (['src/components/integration-showcase.tsx', 'src/components/frasers-plus-promo-popup.tsx'].includes(name)) {
    source = source.replace(/^import .* from "@\/lib\/checkout-click-(?:client|events)";\n/gm, '')
      .replace(/^\s+onClickCapture=\{captureCheckoutClick\}\n/gm, '')
      .replace(/ onClickCapture=\{captureCheckoutClick\}/g, '')
      .replace(/^\s+data-checkout-click=.*\n/gm, '')
      .replace(/^\s+trackingEvent=.*\n/gm, '')
      .replace(/ trackingEvent="[a-z_]+"/g, '')
      .replace(/^  trackingEvent,\n/gm, '')
      .replace(/^  trackingEvent\?: CheckoutClickEvent;\n/gm, '');
  }
  if (name === 'src/lib/server-data.ts') source = source.replace(/export async function incrementCheckoutClickCounter\([\s\S]*?(?=export async function getJsonFileVersion)/, '');
  if (name === 'src/app/admin/page.tsx') source = source
    .replace('import { CheckoutClickAnalytics } from "@/components/checkout-click-summary";\n', '')
    .replace('            <CheckoutClickAnalytics range={readParam(params, "clickDays")} />\n', '');
  return source;
}
function readProtected(name, dir) {
  return withoutClickAdditions(name, require('./preferred-dates-source-guards.cjs').withoutPreferredDatesPolicy(name, fs.readFileSync(path.join(dir, name), 'utf8')));
}
module.exports = { withoutClickAdditions, readProtected };
