const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const postcss = require('postcss');
const base = path.resolve(__dirname, '../../frasers-production-dark');
const root = path.resolve(__dirname, '..');
const component = 'src/components/integration-showcase.tsx';
const oldSource = fs.readFileSync(path.join(base, component), 'utf8');
const newSource = fs.readFileSync(path.join(root, component), 'utf8');
function behavior(source) {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(file, [context => {
    function visit(node) {
      if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className') return undefined;
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'svg' && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'aria-hidden' && prop.initializer?.text === 'true')) return undefined;
      if (ts.isJsxText(node) && !node.text.trim()) return undefined;
      return ts.visitEachChild(node, visit, context);
    }
    return node => ts.visitNode(node, visit);
  }]);
  const output = ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]);
  result.dispose();
  return output;
}
assert.equal(behavior(newSource), behavior(oldSource), 'Non-presentation component behavior changed');
const newCss = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
function protectedCss(text) {
  const parsed = postcss.parse(text.replace('.fp-payment-back:focus-visible,\n', ''));
  parsed.walkRules(rule => { if (rule.selector.startsWith('.fp-primary-btn.fp-checkout-cta') || rule.selector.startsWith('.fp-payment-back')) rule.remove(); });
  return parsed.toString().replace(/\s+/g, ' ').trim();
}
assert.equal(protectedCss(newCss), protectedCss(fs.readFileSync(path.join(base, 'src/app/globals.css'), 'utf8')));
assert(newCss.includes('border: 2px solid #c6addf;'));
assert(newCss.includes('background: #211551;'));
assert(newCss.includes('.fp-primary-btn.fp-checkout-cta:disabled {\n  box-shadow: none;'));
assert(newCss.includes('.fp-payment-back:focus-visible'));
assert(newSource.includes('<span className="font-bold">Continue with</span>'));
assert(newSource.includes('<svg aria-hidden="true" focusable="false"'));
assert(newSource.includes('fp-payment-back mt-4 inline-flex min-h-11'));
console.log('PASS: full component behavior and non-CTA CSS preserved; border, label, decorative arrow, focus and disabled styles verified.');
