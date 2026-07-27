'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Calc = require('./calc.js');

test('single row cost', () => {
  // £20 spool, 1000 g, 50 g used -> 20/1000*50 = 1
  assert.strictEqual(Calc.rowCost({ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 50 }), 1);
});

test('single row cost with string inputs (as they come from the DOM)', () => {
  assert.strictEqual(Calc.rowCost({ spoolPrice: '25', spoolWeight: '500', gramsUsed: '100' }), 5);
});

test('multi-row sum', () => {
  const rows = [
    { spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }, // 2
    { spoolPrice: 30, spoolWeight: 1000, gramsUsed: 50 },  // 1.5
    { spoolPrice: 15, spoolWeight: 750, gramsUsed: 75 }    // 1.5
  ];
  assert.ok(Math.abs(Calc.materialCost(rows) - 5) < 1e-9);
});

test('materialCost of empty list is 0', () => {
  assert.strictEqual(Calc.materialCost([]), 0);
});

test('zero spool weight guards to 0', () => {
  assert.strictEqual(Calc.rowCost({ spoolPrice: 20, spoolWeight: 0, gramsUsed: 50 }), 0);
});

test('negative spool weight guards to 0', () => {
  assert.strictEqual(Calc.rowCost({ spoolPrice: 20, spoolWeight: -10, gramsUsed: 50 }), 0);
});

test('missing spool weight guards to 0', () => {
  assert.strictEqual(Calc.rowCost({ spoolPrice: 20, gramsUsed: 50 }), 0);
});

test('empty/NaN inputs treated as 0-cost row', () => {
  assert.strictEqual(Calc.rowCost({ spoolPrice: '', spoolWeight: '1000', gramsUsed: '50' }), 0);
  assert.strictEqual(Calc.rowCost({ spoolPrice: 'abc', spoolWeight: 1000, gramsUsed: 50 }), 0);
  assert.strictEqual(Calc.rowCost({ spoolPrice: 20, spoolWeight: 1000, gramsUsed: NaN }), 0);
  assert.strictEqual(Calc.rowCost({}), 0);
  assert.strictEqual(Calc.rowCost(null), 0);
});

test('rows with bad inputs do not poison the sum', () => {
  const rows = [
    { spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }, // 2
    { spoolPrice: '', spoolWeight: '', gramsUsed: '' },    // 0
    { spoolPrice: 10, spoolWeight: 0, gramsUsed: 500 }     // 0 (weight guard)
  ];
  assert.strictEqual(Calc.materialCost(rows), 2);
});

test('profit basic', () => {
  const rows = [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }]; // 2
  assert.strictEqual(Calc.profit(10, rows), 8);
});

test('negative profit', () => {
  const rows = [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 500 }]; // 10
  assert.strictEqual(Calc.profit(5, rows), -5);
});

test('profit with empty sale price treats sale as 0', () => {
  const rows = [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }]; // 2
  assert.strictEqual(Calc.profit('', rows), -2);
});

test('margin null when sale price is 0', () => {
  assert.strictEqual(Calc.margin(0, []), null);
});

test('margin null when sale price is empty/NaN/negative', () => {
  assert.strictEqual(Calc.margin('', []), null);
  assert.strictEqual(Calc.margin('abc', []), null);
  assert.strictEqual(Calc.margin(-5, []), null);
});

test('margin value correctness', () => {
  const rows = [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }]; // cost 2
  // profit = 10 - 2 = 8; margin = 8/10*100 = 80
  assert.strictEqual(Calc.margin(10, rows), 80);
});

test('margin 100% with no material cost', () => {
  assert.strictEqual(Calc.margin(10, []), 100);
});

test('negative margin when loss', () => {
  const rows = [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 1000 }]; // cost 20
  // profit = 10 - 20 = -10; margin = -100
  assert.strictEqual(Calc.margin(10, rows), -100);
});

/* ---------- electricityCost ---------- */

test('electricityCost basic', () => {
  // 100 W for 10 h at £0.30/kWh = 0.1 * 10 * 0.3 = 0.3
  assert.ok(Math.abs(Calc.electricityCost(100, 10, 0.3, 1) - 0.3) < 1e-9);
});

test('electricityCost with string inputs (as they come from the DOM)', () => {
  assert.ok(Math.abs(Calc.electricityCost('90', '5.5', '0.2611', '1') - (0.09 * 5.5 * 0.2611)) < 1e-9);
});

test('electricityCost multiplies by qty', () => {
  assert.ok(Math.abs(Calc.electricityCost(100, 10, 0.3, 4) - 1.2) < 1e-9);
});

test('electricityCost qty defaults to 1 when missing/NaN/negative', () => {
  assert.ok(Math.abs(Calc.electricityCost(100, 10, 0.3) - 0.3) < 1e-9);
  assert.ok(Math.abs(Calc.electricityCost(100, 10, 0.3, NaN) - 0.3) < 1e-9);
  assert.ok(Math.abs(Calc.electricityCost(100, 10, 0.3, -2) - 0.3) < 1e-9);
});

test('electricityCost zero inputs give 0', () => {
  assert.strictEqual(Calc.electricityCost(0, 10, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost(100, 0, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost(100, 10, 0, 1), 0);
});

test('electricityCost guards NaN and negative inputs to 0', () => {
  assert.strictEqual(Calc.electricityCost('abc', 10, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost('', 10, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost(-100, 10, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost(100, -1, 0.3, 1), 0);
  assert.strictEqual(Calc.electricityCost(100, 10, -0.3, 1), 0);
});

/* ---------- labourCost ---------- */

test('labourCost basic', () => {
  // 30 min at £12/h = 6
  assert.strictEqual(Calc.labourCost(30, 12, 1), 6);
});

test('labourCost with string inputs', () => {
  assert.ok(Math.abs(Calc.labourCost('15', '12.71', '1') - (0.25 * 12.71)) < 1e-9);
});

test('labourCost multiplies by qty', () => {
  assert.strictEqual(Calc.labourCost(30, 12, 3), 18);
});

test('labourCost qty defaults to 1', () => {
  assert.strictEqual(Calc.labourCost(30, 12), 6);
  assert.strictEqual(Calc.labourCost(30, 12, 'abc'), 6);
  assert.strictEqual(Calc.labourCost(30, 12, -1), 6);
});

test('labourCost zero and empty wage give 0', () => {
  assert.strictEqual(Calc.labourCost(30, 0, 1), 0);
  assert.strictEqual(Calc.labourCost(30, '', 1), 0);
  assert.strictEqual(Calc.labourCost(0, 12, 1), 0);
});

test('labourCost guards NaN and negative to 0', () => {
  assert.strictEqual(Calc.labourCost('abc', 12, 1), 0);
  assert.strictEqual(Calc.labourCost(-30, 12, 1), 0);
  assert.strictEqual(Calc.labourCost(30, -12, 1), 0);
});

/* ---------- printUnitCost / printSubtotal ---------- */

const SETTINGS = { watts: 100, kwhPrice: 0.3, wage: 12 };

test('printUnitCost sums materials + electricity + labour for one unit', () => {
  const print = {
    qty: 5, // must NOT affect unit cost
    printHours: 10,     // elec: 0.1 * 10 * 0.3 = 0.3
    labourMinutes: 30,  // labour: 0.5 * 12 = 6
    rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }] // 2
  };
  assert.ok(Math.abs(Calc.printUnitCost(print, SETTINGS) - 8.3) < 1e-9);
});

test('printUnitCost with empty settings is materials only', () => {
  const print = { printHours: 10, labourMinutes: 30, rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }] };
  assert.strictEqual(Calc.printUnitCost(print, {}), 2);
  assert.strictEqual(Calc.printUnitCost(print), 2);
});

test('printUnitCost guards bad print to 0', () => {
  assert.strictEqual(Calc.printUnitCost(null, SETTINGS), 0);
  assert.strictEqual(Calc.printUnitCost(undefined, SETTINGS), 0);
  assert.strictEqual(Calc.printUnitCost({}, SETTINGS), 0);
});

test('printSubtotal multiplies unit cost by qty', () => {
  const print = {
    qty: 3,
    printHours: 10,
    labourMinutes: 30,
    rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }]
  };
  assert.ok(Math.abs(Calc.printSubtotal(print, SETTINGS) - 24.9) < 1e-9);
});

test('printSubtotal qty defaults to 1 and zero qty gives 0', () => {
  const print = { printHours: 10, labourMinutes: 30, rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }] };
  assert.ok(Math.abs(Calc.printSubtotal(print, SETTINGS) - 8.3) < 1e-9);
  assert.ok(Math.abs(Calc.printSubtotal({ ...print, qty: 'abc' }, SETTINGS) - 8.3) < 1e-9);
  assert.ok(Math.abs(Calc.printSubtotal({ ...print, qty: -4 }, SETTINGS) - 8.3) < 1e-9);
  assert.strictEqual(Calc.printSubtotal({ ...print, qty: 0 }, SETTINGS), 0);
  assert.strictEqual(Calc.printSubtotal(null, SETTINGS), 0);
});

/* ---------- orderTotals ---------- */

test('orderTotals across multiple prints with order-level sale price', () => {
  const prints = [
    {
      qty: 2, printHours: 10, labourMinutes: 30,
      rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }] // 2/unit
    },
    {
      qty: 1, printHours: 5, labourMinutes: 0,
      rows: [{ spoolPrice: 30, spoolWeight: 1000, gramsUsed: 50 }] // 1.5/unit
    }
  ];
  const postage = { price: 3.6, packaging: 0.4 };
  const t = Calc.orderTotals(38, prints, postage, SETTINGS);
  assert.ok(Math.abs(t.materials - (2 * 2 + 1.5)) < 1e-9);          // 5.5
  assert.ok(Math.abs(t.electricity - (0.3 * 2 + 0.15)) < 1e-9);     // 0.75
  assert.ok(Math.abs(t.labour - (6 * 2 + 0)) < 1e-9);               // 12
  assert.ok(Math.abs(t.postagePackaging - 4) < 1e-9);
  assert.ok(Math.abs(t.totalCost - 22.25) < 1e-9);
  assert.ok(Math.abs(t.revenue - 38) < 1e-9);
  assert.ok(Math.abs(t.profit - 15.75) < 1e-9);
  assert.ok(Math.abs(t.margin - (15.75 / 38 * 100)) < 1e-9);
});

test('orderTotals with string inputs (DOM shape)', () => {
  const prints = [{
    qty: '2', printHours: '1', labourMinutes: '6',
    rows: [{ spoolPrice: '25', spoolWeight: '500', gramsUsed: '10' }] // 0.5/unit
  }];
  const t = Calc.orderTotals('20', prints, { price: '2.7', packaging: '' }, { watts: '100', kwhPrice: '0.3', wage: '10' });
  assert.ok(Math.abs(t.materials - 1) < 1e-9);
  assert.ok(Math.abs(t.electricity - 0.06) < 1e-9);   // 0.1*1*0.3*2
  assert.ok(Math.abs(t.labour - 2) < 1e-9);           // 0.1*10*2
  assert.ok(Math.abs(t.postagePackaging - 2.7) < 1e-9);
  assert.ok(Math.abs(t.revenue - 20) < 1e-9);
});

test('orderTotals empty order', () => {
  const t = Calc.orderTotals('', [], {}, {});
  assert.strictEqual(t.materials, 0);
  assert.strictEqual(t.electricity, 0);
  assert.strictEqual(t.labour, 0);
  assert.strictEqual(t.postagePackaging, 0);
  assert.strictEqual(t.totalCost, 0);
  assert.strictEqual(t.revenue, 0);
  assert.strictEqual(t.profit, 0);
  assert.strictEqual(t.margin, null);
});

test('orderTotals guards bad arguments', () => {
  const t = Calc.orderTotals(null, null, null, null);
  assert.strictEqual(t.totalCost, 0);
  assert.strictEqual(t.revenue, 0);
  assert.strictEqual(t.margin, null);
  const t2 = Calc.orderTotals(undefined, [null, 'x', {}], undefined, undefined);
  assert.strictEqual(t2.totalCost, 0);
  assert.strictEqual(t2.revenue, 0);
});

test('orderTotals NaN/empty sale price gives 0 revenue', () => {
  assert.strictEqual(Calc.orderTotals(NaN, [], {}, {}).revenue, 0);
  assert.strictEqual(Calc.orderTotals('abc', [], {}, {}).revenue, 0);
  assert.strictEqual(Calc.orderTotals('', [], {}, {}).revenue, 0);
  assert.strictEqual(Calc.orderTotals(Infinity, [], {}, {}).revenue, 0);
});

test('orderTotals margin null when revenue is 0, negative profit still reported', () => {
  const prints = [{ qty: 1, printHours: 0, labourMinutes: 0, rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 100 }] }];
  const t = Calc.orderTotals('', prints, {}, {});
  assert.strictEqual(t.revenue, 0);
  assert.strictEqual(t.margin, null);
  assert.strictEqual(t.profit, -2);
});

test('orderTotals negative margin on loss', () => {
  const prints = [{ qty: 1, printHours: 0, labourMinutes: 0, rows: [{ spoolPrice: 20, spoolWeight: 1000, gramsUsed: 500 }] }]; // cost 10
  const t = Calc.orderTotals(5, prints, {}, {});
  assert.strictEqual(t.profit, -5);
  assert.strictEqual(t.margin, -100);
});

test('orderTotals ignores negative sale price and negative postage inputs', () => {
  const prints = [{ qty: 2, printHours: 0, labourMinutes: 0, rows: [] }];
  const t = Calc.orderTotals(-10, prints, { price: -3, packaging: -1 }, {});
  assert.strictEqual(t.revenue, 0);
  assert.strictEqual(t.margin, null);
  assert.strictEqual(t.postagePackaging, 0);
});

test('orderTotals qty multiplies materials, electricity and labour but not revenue', () => {
  const prints = [{
    qty: 10, printHours: 1, labourMinutes: 6,
    rows: [{ spoolPrice: 10, spoolWeight: 1000, gramsUsed: 100 }] // 1/unit
  }];
  const t = Calc.orderTotals(25, prints, {}, { watts: 100, kwhPrice: 0.5, wage: 10 });
  assert.ok(Math.abs(t.materials - 10) < 1e-9);
  assert.ok(Math.abs(t.electricity - 0.5) < 1e-9); // 0.1*1*0.5*10
  assert.ok(Math.abs(t.labour - 10) < 1e-9);       // 0.1*10*10
  assert.ok(Math.abs(t.revenue - 25) < 1e-9);
  assert.ok(Math.abs(t.profit - 4.5) < 1e-9);      // 25 - 20.5
});
