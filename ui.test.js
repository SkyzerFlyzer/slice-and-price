/* Static tests for index.html UI wiring. The pure logic is covered by
   calc.test.js; these checks make sure the page's inline scripts parse and
   that the markup exposes the hooks the script relies on. */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function inlineScripts(src) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

test('index.html contains inline scripts that parse without syntax errors', () => {
  const scripts = inlineScripts(html);
  assert.ok(scripts.length >= 2, 'expected head theme script and main app script');
  for (const code of scripts) {
    assert.doesNotThrow(() => new vm.Script(code));
  }
});

test('loads calc.js and uses its exported order-level API', () => {
  assert.match(html, /<script src="calc\.js"><\/script>/);
  for (const fn of ['Calc.orderTotals', 'Calc.printUnitCost', 'Calc.printSubtotal', 'Calc.rowCost']) {
    assert.ok(html.includes(fn), 'expected page to call ' + fn);
  }
});

test('maps stored print.hours to calc printHours', () => {
  assert.match(html, /printHours:\s*p\.hours/);
});

test('head has favicon, color-scheme meta and pre-paint theme script', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes("data-theme"), 'theme attribute must be applied in <head> before first paint');
  assert.ok(head.includes('prefers-color-scheme'), 'theme default must consult prefers-color-scheme');
});

test('storage key and v3 state shape fields are present', () => {
  assert.ok(html.includes("'printCostCalculator'"));
  for (const key of ['v: 3', 'salePrice', 'kwhRegion', 'kwhPrice', 'labourMinutes', 'packaging']) {
    assert.ok(html.includes(key), 'expected state field ' + key);
  }
  // Per-print unit price is gone from the app's state shape.
  assert.ok(!html.includes("unitPrice: str("), 'sanitizePrint must not keep unitPrice');
  assert.ok(!html.includes("unitPrice: ''"), 'freshPrint must not carry unitPrice');
});

test('old MVP state shape is migrated', () => {
  assert.ok(html.includes('s.v === undefined') && html.includes('Array.isArray(s.rows)'),
    'expected migration branch for old {currency, salePrice, rows} shape');
  assert.match(html, /migrated\.salePrice = str\(s\.salePrice/);
});

test('v2 state shape is migrated to a single order-level sale price', () => {
  assert.ok(html.includes('s.v === 2'), 'expected v2 migration branch');
  assert.match(html, /unitPrice/, 'v2 migration must read the old per-print unitPrice');
});

test('currency options are exactly the ten required symbols', () => {
  assert.ok(html.includes("['£', '$', '€', '¥', '₹', 'A$', 'C$', 'CHF', 'kr', 'zł']"));
});

test('required element ids exist in markup', () => {
  const ids = ['sale-price', 'prints', 'add-print', 'printer', 'watts', 'kwh-price', 'kwh-region',
    'wage', 'currency', 'postage-service', 'postage-hint', 'postage-price', 'packaging',
    'theme-toggle', 'bar', 'legend', 'profit', 'margin',
    'bd-materials', 'bd-electricity', 'bd-labour', 'bd-postage', 'bd-total', 'bd-revenue'];
  for (const id of ids) {
    assert.ok(html.includes('id="' + id + '"'), 'missing element id ' + id);
  }
});

test('dark theme overrides custom properties and hairlines are variables', () => {
  assert.ok(html.includes(':root[data-theme="dark"]'));
  for (const decl of ['--bed: #14181A', '--grid: #212829', '--card: #1B2124', '--border: #2E3639',
    '--ink: #E8ECEA', '--muted: #93A09A', '--profit: #2FA36B', '--loss: #E06550']) {
    assert.ok(html.includes(decl), 'missing dark theme declaration ' + decl);
  }
  assert.ok(html.includes('--hairline'), 'hairline rgba should be a variable');
  assert.ok(html.includes('var(--hairline)'));
});

test('postage panel links to Royal Mail price finder', () => {
  assert.ok(html.includes('https://www.royalmail.com/price-finder'));
  assert.ok(html.includes('None (collection)'));
});

test('swatch cycle and design fonts preserved', () => {
  assert.ok(html.includes("['#E8500F', '#2274A5', '#7A4EAB', '#D4A017', '#C2418B', '#4A4E57']"));
  assert.ok(html.includes('Chakra+Petch') && html.includes('IBM+Plex+Mono') && html.includes('IBM+Plex+Sans'));
});

/* ---------- Runtime smoke tests: execute the inline scripts against a
   minimal DOM stub so boot, persistence and migration actually run. ---------- */

function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    listeners: {},
    style: {},
    attrs: {},
    value: '',
    hidden: false,
    lastElementChild: null,
    _text: '',
    appendChild(c) { this.children.push(c); this.lastElementChild = c; return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type) { (this.listeners[type] || []).forEach(fn => fn()); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = v; if (v === '') { this.children = []; this.lastElementChild = null; } }
  });
  return el;
}

function makeSandbox(storedJson) {
  const store = {};
  if (storedJson !== undefined) store.printCostCalculator = storedJson;
  const byId = {};
  const document = {
    documentElement: makeEl('html'),
    getElementById(id) { return byId[id] || (byId[id] = makeEl('div')); },
    createElement(tag) { return makeEl(tag); }
  };
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  };
  const window = { matchMedia: () => ({ matches: false }) };
  const sandbox = { document, localStorage, window, Calc: require('./calc.js'), console };
  sandbox.store = store;
  sandbox.byId = byId;
  return sandbox;
}

function runScripts(sandbox) {
  for (const code of inlineScripts(html)) {
    vm.runInNewContext(code, sandbox);
  }
}

test('runtime: boots from empty storage and persists v3 state', () => {
  const sb = makeSandbox();
  runScripts(sb);
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.v, 3);
  assert.strictEqual(saved.currency, '£');
  assert.strictEqual(saved.salePrice, '');
  assert.strictEqual(saved.prints.length, 1);
  assert.strictEqual(saved.prints[0].qty, '1');
  assert.ok(!('unitPrice' in saved.prints[0]), 'prints must not carry unitPrice');
  assert.strictEqual(saved.prints[0].rows.length, 1);
  assert.strictEqual(saved.settings.kwhRegion, 'uk');
  assert.strictEqual(saved.settings.kwhPrice, '0.2611');
  assert.strictEqual(saved.settings.wage, '');
  assert.strictEqual(saved.postage.service, 'none');
  // Pre-paint theme script ran and set a theme attribute.
  assert.ok(['light', 'dark'].includes(sb.document.documentElement.getAttribute('data-theme')));
  // Result panel rendered zeroed values.
  assert.strictEqual(sb.byId['bd-total'].textContent, '£0.00');
  assert.strictEqual(sb.byId['profit'].textContent, '£0.00');
  assert.strictEqual(sb.byId['margin'].textContent, '—');
});

test('runtime: migrates old MVP {currency, salePrice, rows} shape to v3', () => {
  const old = {
    currency: '$',
    salePrice: '25',
    rows: [
      { color: '#2274A5', name: 'PLA Blue', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '100' },
      { color: '#7A4EAB', name: 'PLA Purple', spoolPrice: '30', spoolWeight: '500', gramsUsed: '50' }
    ]
  };
  const sb = makeSandbox(JSON.stringify(old));
  runScripts(sb);
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.v, 3);
  assert.strictEqual(saved.currency, '$');
  assert.strictEqual(saved.salePrice, '25');
  assert.strictEqual(saved.prints.length, 1);
  assert.ok(!('unitPrice' in saved.prints[0]), 'migrated print must not carry unitPrice');
  assert.strictEqual(saved.prints[0].qty, '1');
  assert.strictEqual(saved.prints[0].rows.length, 2);
  assert.strictEqual(saved.prints[0].rows[1].name, 'PLA Purple');
  // Materials: 20/1000*100 + 30/500*50 = 2 + 3 = 5; revenue 25 -> profit 20, margin 80%.
  assert.strictEqual(sb.byId['bd-materials'].textContent, '$5.00');
  assert.strictEqual(sb.byId['bd-revenue'].textContent, '$25.00');
  assert.strictEqual(sb.byId['profit'].textContent, '$20.00');
  assert.strictEqual(sb.byId['margin'].textContent, '80.0%');
  // Sale price input restored from migrated state.
  assert.strictEqual(sb.byId['sale-price'].value, '25');
});

test('runtime: migrates v2 per-print unitPrice to order salePrice = Σ unitPrice × qty', () => {
  const v2 = {
    v: 2,
    theme: 'dark',
    currency: '£',
    settings: { printer: 'Custom', watts: '100', kwhRegion: 'uk', kwhPrice: '0.2611', wage: '10' },
    prints: [
      {
        name: 'Body', qty: '2', unitPrice: '15', hours: '1', labourMinutes: '6',
        rows: [{ color: '#2274A5', name: 'PLA', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '100' }]
      },
      {
        name: 'Lid', qty: '', unitPrice: '8', hours: '0', labourMinutes: '0',
        rows: [{ color: '#7A4EAB', name: 'PETG', spoolPrice: '30', spoolWeight: '1000', gramsUsed: '50' }]
      },
      {
        name: 'Junk', qty: '3', unitPrice: '-4', hours: '0', labourMinutes: '0',
        rows: []
      }
    ],
    postage: { service: 'none', price: '0', packaging: '' }
  };
  const sb = makeSandbox(JSON.stringify(v2));
  runScripts(sb);
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.v, 3);
  // 15*2 + 8*1 (empty qty defaults to 1) + 0 (negative unit price ignored) = 38
  assert.strictEqual(saved.salePrice, '38');
  assert.strictEqual(saved.prints.length, 3);
  for (const p of saved.prints) {
    assert.ok(!('unitPrice' in p), 'migrated prints must not carry unitPrice');
  }
  assert.strictEqual(saved.prints[0].name, 'Body');
  assert.strictEqual(saved.prints[0].hours, '1');
  assert.strictEqual(saved.settings.wage, '10');
  assert.strictEqual(saved.theme, 'dark');
  // Revenue now comes from the migrated order-level sale price.
  assert.strictEqual(sb.byId['bd-revenue'].textContent, '£38.00');
  assert.strictEqual(sb.byId['sale-price'].value, '38');
});

test('runtime: v2 migration with no priced prints leaves sale price empty', () => {
  const v2 = {
    v: 2,
    currency: '£',
    settings: { printer: 'Custom', watts: '', kwhRegion: 'uk', kwhPrice: '0.2611', wage: '' },
    prints: [{ name: '', qty: '1', unitPrice: '', hours: '', labourMinutes: '', rows: [] }],
    postage: { service: 'none', price: '0', packaging: '' }
  };
  const sb = makeSandbox(JSON.stringify(v2));
  runScripts(sb);
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.v, 3);
  assert.strictEqual(saved.salePrice, '');
  assert.strictEqual(sb.byId['bd-revenue'].textContent, '£0.00');
  assert.strictEqual(sb.byId['margin'].textContent, '—');
});

test('runtime: corrupt stored state falls back to fresh default', () => {
  const sb = makeSandbox('{not valid json');
  runScripts(sb);
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.v, 3);
  assert.strictEqual(saved.salePrice, '');
  assert.strictEqual(saved.prints.length, 1);
});

test('runtime: theme toggle persists user choice', () => {
  const sb = makeSandbox();
  runScripts(sb);
  const before = sb.document.documentElement.getAttribute('data-theme');
  sb.byId['theme-toggle'].fire('click');
  const after = sb.document.documentElement.getAttribute('data-theme');
  assert.notStrictEqual(before, after);
  assert.strictEqual(JSON.parse(sb.store.printCostCalculator).theme, after);
});

test('runtime: add print creates a second card and order sums both', () => {
  const sb = makeSandbox();
  runScripts(sb);
  sb.byId['add-print'].fire('click');
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.prints.length, 2);
  assert.strictEqual(sb.byId['prints'].children.length, 2);
});

test('runtime: no sale price shows a total-cost headline instead of profit', () => {
  const v3 = {
    v: 3,
    currency: '£',
    salePrice: '',
    settings: { printer: 'Custom', watts: '', kwhRegion: 'uk', kwhPrice: '0.2611', wage: '' },
    prints: [{
      name: '', qty: '1', hours: '', labourMinutes: '',
      rows: [{ color: '#E8500F', name: '', spoolPrice: '25', spoolWeight: '1000', gramsUsed: '80' }]
    }],
    postage: { service: 'none', price: '0', packaging: '' }
  };
  const sb = makeSandbox(JSON.stringify(v3));
  runScripts(sb);
  // Cost mode: headline is the order's total cost, profit chrome hidden.
  assert.strictEqual(sb.byId['figure-label'].textContent, 'Total cost');
  assert.strictEqual(sb.byId['profit'].textContent, '£2.00');
  assert.ok(sb.byId['profit'].className.includes('neutral'));
  assert.strictEqual(sb.byId['line-revenue'].hidden, true);
  assert.strictEqual(sb.byId['margin-line'].hidden, true);
  assert.strictEqual(sb.byId['no-sale-hint'].hidden, false);
  const costModeLegendItems = sb.byId['legend'].children.length;
  // Entering a sale price flips back to profit mode and adds the Profit legend row.
  sb.byId['sale-price'].value = '10';
  sb.byId['sale-price'].fire('input');
  assert.strictEqual(sb.byId['figure-label'].textContent, 'Profit');
  assert.strictEqual(sb.byId['profit'].textContent, '£8.00');
  assert.ok(sb.byId['profit'].className.includes('pos'));
  assert.strictEqual(sb.byId['line-revenue'].hidden, false);
  assert.strictEqual(sb.byId['margin-line'].hidden, false);
  assert.strictEqual(sb.byId['no-sale-hint'].hidden, true);
  assert.strictEqual(sb.byId['legend'].children.length, costModeLegendItems + 1);
});

test('runtime: typing a sale price sets revenue, profit and persists', () => {
  const sb = makeSandbox();
  runScripts(sb);
  sb.byId['sale-price'].value = '12.5';
  sb.byId['sale-price'].fire('input');
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.salePrice, '12.5');
  assert.strictEqual(sb.byId['bd-revenue'].textContent, '£12.50');
  assert.strictEqual(sb.byId['profit'].textContent, '£12.50');
  assert.strictEqual(sb.byId['margin'].textContent, '100.0%');
});
