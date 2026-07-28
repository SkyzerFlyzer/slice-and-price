/* Pure calculation logic for the 3D printing cost calculator.
   No DOM code. Works in the browser via <script> and in Node via require(). */
(function () {
  'use strict';

  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    if (typeof value === 'string' && value.trim() !== '') {
      var n = Number(value);
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  // Cost of one filament row. Guards: spoolWeight <= 0 or any missing/NaN input -> 0.
  function rowCost(row) {
    if (!row || typeof row !== 'object') return 0;
    var spoolPrice = toNumber(row.spoolPrice);
    var spoolWeight = toNumber(row.spoolWeight);
    var gramsUsed = toNumber(row.gramsUsed);
    if (isNaN(spoolPrice) || isNaN(spoolWeight) || isNaN(gramsUsed)) return 0;
    if (spoolWeight <= 0) return 0;
    return (spoolPrice / spoolWeight) * gramsUsed;
  }

  // Sum of all row costs.
  function materialCost(rows) {
    if (!Array.isArray(rows)) return 0;
    var total = 0;
    for (var i = 0; i < rows.length; i++) total += rowCost(rows[i]);
    return total;
  }

  // Profit = sale price - material cost. Missing/NaN sale price treated as 0.
  function profit(salePrice, rows) {
    var sale = toNumber(salePrice);
    if (isNaN(sale)) sale = 0;
    return sale - materialCost(rows);
  }

  // Margin % = profit / salePrice * 100. Null when salePrice is not > 0.
  function margin(salePrice, rows) {
    var sale = toNumber(salePrice);
    if (isNaN(sale) || sale <= 0) return null;
    return (profit(sale, rows) / sale) * 100;
  }

  // Non-negative number, or 0 for missing/NaN/negative.
  function nonNeg(value) {
    var n = toNumber(value);
    return (isNaN(n) || n < 0) ? 0 : n;
  }

  // Quantity: integer, defaults to 1 for missing/NaN/negative input.
  function toQty(qty) {
    var n = toNumber(qty);
    if (isNaN(n) || n < 0) return 1;
    return Math.floor(n);
  }

  // Electricity cost = watts/1000 * printHours * kwhPrice * qty.
  // Any NaN/negative watts, hours or price -> 0. qty defaults to 1.
  function electricityCost(watts, printHours, kwhPrice, qty) {
    var w = toNumber(watts);
    var h = toNumber(printHours);
    var p = toNumber(kwhPrice);
    if (isNaN(w) || w < 0 || isNaN(h) || h < 0 || isNaN(p) || p < 0) return 0;
    return (w / 1000) * h * p * toQty(qty);
  }

  // Labour cost = labourMinutes/60 * hourlyWage * qty.
  // Any NaN/negative minutes or wage -> 0. qty defaults to 1.
  function labourCost(labourMinutes, hourlyWage, qty) {
    var m = toNumber(labourMinutes);
    var w = toNumber(hourlyWage);
    if (isNaN(m) || m < 0 || isNaN(w) || w < 0) return 0;
    return (m / 60) * w * toQty(qty);
  }

  // Cost of one unit of a print: materials + electricity + labour (qty 1).
  // settings: { watts, kwhPrice, wage }
  function printUnitCost(print, settings) {
    if (!print || typeof print !== 'object') return 0;
    settings = (settings && typeof settings === 'object') ? settings : {};
    return materialCost(print.rows) +
      electricityCost(settings.watts, print.printHours, settings.kwhPrice, 1) +
      labourCost(print.labourMinutes, settings.wage, 1);
  }

  // Unit cost multiplied by quantity.
  function printSubtotal(print, settings) {
    if (!print || typeof print !== 'object') return 0;
    return printUnitCost(print, settings) * toQty(print.qty);
  }

  // Order-level totals across all prints plus postage & packaging.
  // Revenue is the order's single sale price (prints are cost components,
  // not individually priced products).
  // salePrice: number|string — NaN/negative/missing -> 0 revenue
  // prints: [{ qty, printHours, labourMinutes, rows }]
  // postage: { price, packaging }
  // settings: { watts, kwhPrice, wage }
  function orderTotals(salePrice, prints, postage, settings) {
    if (!Array.isArray(prints)) prints = [];
    postage = (postage && typeof postage === 'object') ? postage : {};
    settings = (settings && typeof settings === 'object') ? settings : {};

    var materials = 0;
    var electricity = 0;
    var labour = 0;
    var revenue = nonNeg(salePrice);

    for (var i = 0; i < prints.length; i++) {
      var p = prints[i];
      if (!p || typeof p !== 'object') continue;
      var q = toQty(p.qty);
      materials += materialCost(p.rows) * q;
      electricity += electricityCost(settings.watts, p.printHours, settings.kwhPrice, q);
      labour += labourCost(p.labourMinutes, settings.wage, q);
    }

    var postagePackaging = nonNeg(postage.price) + nonNeg(postage.packaging);
    var totalCost = materials + electricity + labour + postagePackaging;
    var profitVal = revenue - totalCost;
    var marginVal = revenue > 0 ? (profitVal / revenue) * 100 : null;

    return {
      materials: materials,
      electricity: electricity,
      labour: labour,
      postagePackaging: postagePackaging,
      totalCost: totalCost,
      revenue: revenue,
      profit: profitVal,
      margin: marginVal
    };
  }

  // Grams of filament used across all prints (row grams × print qty),
  // merged case-insensitively by trimmed name; unnamed rows merge into one
  // '' entry. Display name and colour come from the first row seen for each
  // name (first non-empty colour wins). NaN/negative grams count as 0.
  // Returns { total, filaments: [{ name, color, grams }] } in first-seen order.
  function filamentUsage(prints) {
    if (!Array.isArray(prints)) prints = [];
    var byKey = Object.create(null);
    var filaments = [];
    var total = 0;
    for (var i = 0; i < prints.length; i++) {
      var p = prints[i];
      if (!p || typeof p !== 'object' || !Array.isArray(p.rows)) continue;
      var q = toQty(p.qty);
      for (var j = 0; j < p.rows.length; j++) {
        var row = p.rows[j];
        if (!row || typeof row !== 'object') continue;
        var name = typeof row.name === 'string' ? row.name.trim() : '';
        var key = name.toLowerCase();
        var entry = byKey[key];
        if (!entry) {
          entry = { name: name, color: null, grams: 0 };
          byKey[key] = entry;
          filaments.push(entry);
        }
        if (!entry.color && typeof row.color === 'string' && row.color !== '') {
          entry.color = row.color;
        }
        var grams = nonNeg(row.gramsUsed) * q;
        entry.grams += grams;
        total += grams;
      }
    }
    return { total: total, filaments: filaments };
  }

  var Calc = {
    rowCost: rowCost,
    materialCost: materialCost,
    profit: profit,
    margin: margin,
    electricityCost: electricityCost,
    labourCost: labourCost,
    printUnitCost: printUnitCost,
    printSubtotal: printSubtotal,
    orderTotals: orderTotals,
    filamentUsage: filamentUsage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calc;
  } else {
    window.Calc = Calc;
  }
})();
