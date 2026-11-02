const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const base = path.resolve(root, '../frasers-production-cta');
const read = (name, dir = root) => require('./click-source-guards.cjs').readProtected(name, dir);
const integration = read('src/components/integration-showcase.tsx');
assert.ok(integration.includes('<FrasersPlusPromoPopup active={enableFrasersPlus && step === 1} />'));
assert.equal(
  integration
    .replace('import { FrasersPlusPromoPopup } from "@/components/frasers-plus-promo-popup";\n', '')
    .replace('      <FrasersPlusPromoPopup active={enableFrasersPlus && step === 1} />\n', ''),
  read('src/components/integration-showcase.tsx', base),
  'Existing journey, payment handlers and pricing must be unchanged',
);
let preserved = 0;
for (const folder of ['src', 'public']) {
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      // Stage-clock additions are checked separately against the production source
      // by test-stage-alerts.cjs; every other popup-release protection remains.
      else if (!['src/components/integration-showcase.tsx', 'src/lib/post-survey-workflows.ts'].includes(name.replaceAll('\\', '/'))) {
        assert.equal(read(name, root), read(name, base), `Protected file changed: ${name}`);
        preserved++;
      }
    }
  }
  walk(folder);
}

const source = read('src/components/frasers-plus-promo-popup.tsx');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
let current;
const react = {
  useState(initial) {
    const owner = current;
    const index = owner.cursor++;
    if (!(index in owner.states)) owner.states[index] = initial;
    return [owner.states[index], value => { owner.states[index] = value; }];
  },
  useId() { return 'popup-title'; },
  useEffect(effect) { if (!current.mounted) current.pending.push(effect); },
};
function environment(readyState = 'complete') {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Set();
  const window = {
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(event, handler) { assert.equal(event, 'load'); listeners.add(handler); },
    removeEventListener(event, handler) { assert.equal(event, 'load'); listeners.delete(handler); },
  };
  const document = { readyState, body: {} };
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, document, window,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-dom') return { createPortal: (node, container) => ({ node, container }) };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'next/image') return { default: 'img' };
      if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  function component(fn) {
    const owner = { states: [], cursor: 0, pending: [], cleanups: [], mounted: false };
    return {
      render(props) {
        owner.cursor = 0;
        current = owner;
        const node = fn(props);
        current = null;
        owner.cleanups.push(...owner.pending.splice(0).map(effect => effect()));
        owner.mounted = true;
        return node;
      },
      unmount() { owner.cleanups.forEach(cleanup => cleanup?.()); },
    };
  }
  return {
    root: component(module.exports.FrasersPlusPromoPopup), component, document, timers, listeners,
    load() { for (const handler of [...listeners]) { listeners.delete(handler); handler(); } },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
  };
}
const env = environment();
assert.equal(env.root.render({ active: false }), null, 'Disabled flag or later steps must render nothing');
const element = env.root.render({ active: true });
const child = env.component(element.type);
assert.equal(child.render(element.props), null, 'No server/initial popup flash');
env.advance(2999);
assert.equal(child.render(element.props), null);
env.advance(1);
const visible = child.render(element.props);
assert.equal(visible.container, env.document.body, 'Popup must escape layout containers');
assert.equal(visible.node.type, 'aside');
const children = visible.node.props.children;
const cta = children.find(item => item.type === 'a');
assert.equal(cta.props.href, 'https://application.pay.frasers.plus/?partner=VCHRGD&template=online&location=frasersplus_webpage');
assert.equal(cta.props.target, '_blank');
assert.equal(cta.props.rel, 'noopener noreferrer');
assert.equal(env.root.render({ active: false }), null, 'Advancing must hide an already visible popup');
children.find(item => item.type === 'button').props.onClick();
assert.equal(env.root.render({ active: true }), null, 'Dismissal must persist on returning to selection');

for (const readyState of ['loading', 'complete']) {
  const pending = environment(readyState);
  const element = pending.root.render({ active: true });
  const component = pending.component(element.type);
  component.render(element.props);
  if (readyState === 'loading') {
    pending.advance(10000);
    assert.equal(pending.timers.size, 0, 'Delay starts after load');
    pending.load();
    pending.advance(2999);
    assert.equal(component.render(element.props), null);
  }
  component.unmount();
  assert.equal(pending.listeners.size, 0);
  assert.equal(pending.timers.size, 0, 'Leaving first step must cancel timer');
  pending.load();
  pending.advance(10000);
  assert.equal(component.render(element.props), null, 'No late reveal after leaving');
}

const early = environment('loading');
const earlyElement = early.root.render({ active: true });
const earlyChild = early.component(earlyElement.type);
earlyChild.render(earlyElement.props);
earlyChild.unmount();
assert.equal(early.listeners.size, 0, 'Leaving before load must remove the listener');
early.load();
assert.equal(early.timers.size, 0);

const keyboard = environment();
const keyboardElement = keyboard.root.render({ active: true });
const keyboardChild = keyboard.component(keyboardElement.type);
keyboardChild.render(keyboardElement.props);
keyboard.advance(3000);
let prevented = false;
keyboardChild.render(keyboardElement.props).node.props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
assert.equal(keyboard.root.render({ active: true }), null);
console.log(`PASS: three-second delay, load handling, cancellation, gating, dismissal, Escape, secure CTA and ${preserved} protected source/assets unchanged`);
