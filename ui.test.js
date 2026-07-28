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
  for (const fn of ['Calc.orderTotals', 'Calc.printUnitCost', 'Calc.printSubtotal', 'Calc.rowCost', 'Calc.filamentUsage']) {
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
    'filament-usage', 'filament-usage-list', 'filament-usage-total',
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

function makeSandbox(storedJson, libraryJson) {
  const store = {};
  if (storedJson !== undefined) store.printCostCalculator = storedJson;
  if (libraryJson !== undefined) store.printCostLibrary = libraryJson;
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
  const sandbox = { document, localStorage, window, Calc: require('./calc.js'), console, setTimeout: () => 0 };
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

test('runtime: filament usage totals grams and merges rows with the same name', () => {
  const v3 = {
    v: 3,
    currency: '£',
    salePrice: '',
    settings: { printer: 'Custom', watts: '', kwhRegion: 'uk', kwhPrice: '0.2611', wage: '' },
    prints: [
      {
        name: 'A', qty: '2', hours: '', labourMinutes: '',
        rows: [{ color: '#2274A5', name: 'PLA Blue', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '50' }]
      },
      {
        name: 'B', qty: '1', hours: '', labourMinutes: '',
        rows: [
          { color: '#7A4EAB', name: ' pla blue ', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '25' },
          { color: '#4A4E57', name: 'PETG Grey', spoolPrice: '25', spoolWeight: '1000', gramsUsed: '10.5' }
        ]
      }
    ],
    postage: { service: 'none', price: '0', packaging: '' }
  };
  const sb = makeSandbox(JSON.stringify(v3));
  runScripts(sb);
  assert.strictEqual(sb.byId['filament-usage'].hidden, false);
  // 'PLA Blue' merges with ' pla blue ' (2×50 + 25 = 125 g); PETG Grey 10.5 g.
  const items = sb.byId['filament-usage-list'].children;
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].children[1].textContent, 'PLA Blue');
  assert.strictEqual(items[0].children[2].textContent, '125\u00a0g');
  assert.strictEqual(items[0].children[0].style.backgroundColor, '#2274A5');
  assert.strictEqual(items[1].children[1].textContent, 'PETG Grey');
  assert.strictEqual(items[1].children[2].textContent, '10.5\u00a0g');
  assert.strictEqual(sb.byId['filament-usage-total'].textContent, '135.5\u00a0g');
});

test('runtime: filament usage section stays hidden when nothing is used', () => {
  const sb = makeSandbox();
  runScripts(sb);
  assert.strictEqual(sb.byId['filament-usage'].hidden, true);
  assert.strictEqual(sb.byId['filament-usage-list'].children.length, 0);
});

/* ---------- Library: reusable parts and filament presets ---------- */

test('library markup, pickers and storage key are present', () => {
  assert.ok(html.includes("'printCostLibrary'"), 'expected dedicated library storage key');
  for (const id of ['add-saved-part', 'library-empty', 'library-parts', 'library-filaments']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing element id ' + id);
  }
  assert.ok(html.includes('Add saved part…'));
  assert.ok(html.includes('Add saved filament…'));
});

function libOf(sb) {
  return JSON.parse(sb.store.printCostLibrary);
}

// One named print with one filament row, no sale price.
const seededOrder = {
  v: 3,
  currency: '£',
  salePrice: '',
  settings: { printer: 'Custom', watts: '', kwhRegion: 'uk', kwhPrice: '0.2611', wage: '' },
  prints: [{
    name: 'Dragon — large', qty: '2', hours: '3', labourMinutes: '15',
    rows: [{ color: '#2274A5', name: 'PLA Galaxy Black', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '80' }]
  }],
  postage: { service: 'none', price: '0', packaging: '' }
};

const seededLibrary = {
  v: 1,
  parts: [{
    name: 'Dragon — large', hours: '3', labourMinutes: '15',
    rows: [{ color: '#2274A5', name: 'PLA Galaxy Black', spoolPrice: '20', spoolWeight: '1000', gramsUsed: '80' }]
  }],
  filaments: [{ color: '#7A4EAB', name: 'PETG Purple', spoolPrice: '30', spoolWeight: '500' }]
};

/* Card child order: head(0) gridA(1) gridB(2) rowsHead(3) rowsWrap(4) addRow(5) filSel(6) foot(7).
   Head child order: title(0) save(1) remove(2).
   Filament row child order: swatch(0) name(1) price(2) weight(3) used(4) save(5) remove(6). */

test('runtime: Save on a print card stores the part in the library', () => {
  const sb = makeSandbox(JSON.stringify(seededOrder));
  runScripts(sb);
  const card = sb.byId['prints'].children[0];
  card.children[0].children[1].fire('click');
  const lib = libOf(sb);
  assert.strictEqual(lib.v, 1);
  assert.strictEqual(lib.parts.length, 1);
  const part = lib.parts[0];
  assert.strictEqual(part.name, 'Dragon — large');
  assert.strictEqual(part.hours, '3');
  assert.strictEqual(part.labourMinutes, '15');
  assert.strictEqual(part.rows.length, 1);
  assert.strictEqual(part.rows[0].gramsUsed, '80');
  assert.ok(!('qty' in part), 'a saved part carries no order quantity');
  assert.strictEqual(sb.byId['library-parts'].children.length, 1);
  assert.strictEqual(sb.byId['add-saved-part'].hidden, false);
  assert.strictEqual(sb.byId['library-empty'].hidden, true);
});

test('runtime: saving the same part name twice updates it in place', () => {
  const sb = makeSandbox(JSON.stringify(seededOrder));
  runScripts(sb);
  const card = sb.byId['prints'].children[0];
  card.children[0].children[1].fire('click');
  const hoursIn = card.children[2].children[0].children[1];
  hoursIn.value = '5';
  hoursIn.fire('input');
  card.children[0].children[1].fire('click');
  const lib = libOf(sb);
  assert.strictEqual(lib.parts.length, 1);
  assert.strictEqual(lib.parts[0].hours, '5');
});

test('runtime: ☆ on a filament row saves a spool preset without grams used', () => {
  const sb = makeSandbox(JSON.stringify(seededOrder));
  runScripts(sb);
  const rowEl = sb.byId['prints'].children[0].children[4].children[0];
  rowEl.children[5].fire('click');
  const lib = libOf(sb);
  assert.strictEqual(lib.filaments.length, 1);
  const f = lib.filaments[0];
  assert.strictEqual(f.name, 'PLA Galaxy Black');
  assert.strictEqual(f.color, '#2274A5');
  assert.strictEqual(f.spoolPrice, '20');
  assert.strictEqual(f.spoolWeight, '1000');
  assert.ok(!('gramsUsed' in f), 'spool presets must not remember grams used');
  assert.strictEqual(sb.byId['library-filaments'].children.length, 1);
});

test('runtime: add-saved-part picker appends independent copies of the part', () => {
  const sb = makeSandbox(undefined, JSON.stringify(seededLibrary));
  runScripts(sb);
  const sel = sb.byId['add-saved-part'];
  assert.strictEqual(sel.hidden, false);
  sel.value = 'Dragon — large';
  sel.fire('change');
  sel.value = 'Dragon — large';
  sel.fire('change');
  let saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.prints.length, 3);
  const added = saved.prints[1];
  assert.strictEqual(added.name, 'Dragon — large');
  assert.strictEqual(added.qty, '1');
  assert.strictEqual(added.hours, '3');
  assert.strictEqual(added.rows[0].gramsUsed, '80');
  assert.strictEqual(sel.value, '', 'picker resets to its placeholder');
  // Editing one added copy must not bleed into the other (no aliasing).
  const rowEl = sb.byId['prints'].children[1].children[4].children[0];
  const priceIn = rowEl.children[2].children[1];
  priceIn.value = '99';
  priceIn.fire('input');
  saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.prints[1].rows[0].spoolPrice, '99');
  assert.strictEqual(saved.prints[2].rows[0].spoolPrice, '20');
});

test('runtime: per-card saved-filament picker appends a row with empty grams', () => {
  const sb = makeSandbox(undefined, JSON.stringify(seededLibrary));
  runScripts(sb);
  const filSel = sb.byId['prints'].children[0].children[6];
  assert.strictEqual(filSel.hidden, false);
  filSel.value = 'PETG Purple';
  filSel.fire('change');
  const saved = JSON.parse(sb.store.printCostCalculator);
  assert.strictEqual(saved.prints[0].rows.length, 2);
  const row = saved.prints[0].rows[1];
  assert.strictEqual(row.name, 'PETG Purple');
  assert.strictEqual(row.color, '#7A4EAB');
  assert.strictEqual(row.spoolPrice, '30');
  assert.strictEqual(row.spoolWeight, '500');
  assert.strictEqual(row.gramsUsed, '');
});

test('runtime: library delete buttons remove presets and hide pickers', () => {
  const sb = makeSandbox(undefined, JSON.stringify(seededLibrary));
  runScripts(sb);
  const partLi = sb.byId['library-parts'].children[0];
  partLi.children[partLi.children.length - 1].fire('click');
  const filLi = sb.byId['library-filaments'].children[0];
  filLi.children[filLi.children.length - 1].fire('click');
  const lib = libOf(sb);
  assert.strictEqual(lib.parts.length, 0);
  assert.strictEqual(lib.filaments.length, 0);
  assert.strictEqual(sb.byId['add-saved-part'].hidden, true);
  assert.strictEqual(sb.byId['library-empty'].hidden, false);
  assert.strictEqual(sb.byId['prints'].children[0].children[6].hidden, true);
});

test('runtime: invalid stored colours fall back to the default swatch', () => {
  const lib = {
    v: 1,
    parts: [],
    filaments: [{ color: 'url(javascript:x)', name: 'Weird', spoolPrice: '1', spoolWeight: '1000' }]
  };
  const sb = makeSandbox(undefined, JSON.stringify(lib));
  runScripts(sb);
  const li = sb.byId['library-filaments'].children[0];
  assert.strictEqual(li.children[0].style.backgroundColor, '#E8500F');
});

test('runtime: library lists are capped at 200 entries on load', () => {
  const filaments = [];
  for (let i = 0; i < 250; i++) {
    filaments.push({ color: '#2274A5', name: 'F' + i, spoolPrice: '1', spoolWeight: '1000' });
  }
  const sb = makeSandbox(undefined, JSON.stringify({ v: 1, parts: [], filaments }));
  runScripts(sb);
  assert.strictEqual(sb.byId['library-filaments'].children.length, 200);
});

test('runtime: corrupt library storage falls back to an empty library', () => {
  const sb = makeSandbox(undefined, '{not valid json');
  runScripts(sb);
  assert.strictEqual(sb.byId['add-saved-part'].hidden, true);
  assert.strictEqual(sb.byId['library-empty'].hidden, false);
  assert.strictEqual(sb.byId['library-parts'].children.length, 0);
  assert.strictEqual(sb.byId['library-filaments'].children.length, 0);
});
