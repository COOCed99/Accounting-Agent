import test from 'node:test';
import assert from 'node:assert/strict';

import { variance, withinTolerance } from './variance.js';
import { classify, classifyAll, compileRules, resolveCategory } from './classify.js';
import { FLEX_CATEGORIES } from './taxonomy.js';
import { loadBudgets, loadRules, loadTransactions, ruleByLabel } from './__fixtures__/load.js';

const rules = loadRules();
const budgets = loadBudgets();
const { transactions } = loadTransactions();
const compiled = compileRules(rules);

const AS_OF = '2026-08-17'; // day 17 of a 31-day month

/** Transactions as the API serves them: category resolved, transfers flagged. */
function prepared() {
  const flags = new Map(classifyAll(transactions, rules).map((c) => [c.id, c]));
  return transactions.map((t) => ({
    ...t,
    category: resolveCategory(t, classify(t, compiled)),
    is_transfer: flags.get(t.id).is_transfer,
    removed: 0
  }));
}

const rows = () => variance(prepared(), budgets, AS_OF);
const row = (category) => rows().find((r) => r.category === category);

test('every budgeted category gets a row', () => {
  assert.equal(rows().length, budgets.length);
  for (const b of budgets) assert.ok(row(b.category), `${b.category} is missing`);
});

test('rows are sorted by absolute variance, descending', () => {
  const magnitudes = rows().map((r) => Math.abs(r.variance));
  assert.deepEqual(magnitudes, [...magnitudes].sort((a, b) => b - a));
});

test('the largest overspend is the first row', () => {
  // Not alphabetical, not budget order. The top row is supposed to tell you
  // what to stop doing.
  assert.equal(rows()[0].category, 'gaming_atm');
});

test('a zero cap turns any spend into a breach', () => {
  const gaming = row('gaming_atm');
  assert.equal(gaming.monthlyCap, 0);
  assert.ok(gaming.actualMTD > 0);
  assert.equal(gaming.status, 'breach');
  assert.equal(gaming.variance, gaming.projectedFullMonth);
});

test('a zero cap with zero spend stays ok rather than dividing by zero', () => {
  const [only] = variance([], [{ category: 'gaming_atm', monthly_cap: 0 }], AS_OF);
  assert.equal(only.actualMTD, 0);
  assert.equal(only.projectedFullMonth, 0);
  assert.equal(only.status, 'ok');
  assert.ok(Number.isFinite(only.variance));
});

test('projected full month extrapolates from days elapsed', () => {
  const cash = row('cash_atm');
  assert.equal(cash.actualMTD, 503); // 200 on the 3rd + 303 on the 11th
  assert.equal(cash.projectedFullMonth, Math.round((503 / 17) * 31 * 100) / 100);
  assert.equal(cash.variance, Math.round((cash.projectedFullMonth - 400) * 100) / 100);
  assert.equal(cash.status, 'breach');
});

test('casino withdrawals are counted apart from ordinary cash', () => {
  // If the two rules were merged, or ordered the other way, gaming would read
  // 0 and cash_atm would absorb it.
  assert.equal(row('gaming_atm').actualMTD, 1713.5);
  assert.equal(row('cash_atm').actualMTD, 503);
});

test('the warning band sits between 80 and 100 percent of cap', () => {
  const dining = row('dining');
  const ratio = dining.projectedFullMonth / dining.monthlyCap;
  assert.ok(ratio >= 0.8 && ratio <= 1, `dining projected at ${ratio.toFixed(2)} of cap`);
  assert.equal(dining.status, 'warning');
});

test('spending well under cap reads ok', () => {
  const other = row('other');
  assert.ok(other.projectedFullMonth < other.monthlyCap * 0.8);
  assert.equal(other.status, 'ok');
  assert.ok(other.variance < 0, 'under budget is a negative variance');
});

test('status thresholds are exact at the boundaries', () => {
  const at = (actual) =>
    variance(
      [{ date: '2026-08-17', amount: actual, category: 'dining', is_transfer: 0, removed: 0 }],
      [{ category: 'dining', monthly_cap: 31 }],
      '2026-08-17'
    )[0];
  // elapsed 17, month 31 — an amount of A projects to A/17*31.
  assert.equal(at(13).status, 'ok');        // 23.71 of 31 = 0.76
  assert.equal(at(13.7).status, 'warning'); // 24.98 of 31 = 0.81
  assert.equal(at(17).status, 'warning');   // exactly 100% is the top of the band
  assert.equal(at(17.6).status, 'breach');  // 32.09 of 31 = 1.04, strictly over
});

test('internal transfers never count as spend', () => {
  const withTransfers = variance(
    [
      { date: '2026-08-05', amount: 800, category: 'internal_transfer', is_transfer: 1, removed: 0 },
      { date: '2026-08-05', amount: 500, category: 'savings', is_transfer: 1, removed: 0 },
      { date: '2026-08-05', amount: 100, category: 'dining', is_transfer: 0, removed: 0 }
    ],
    [{ category: 'dining', monthly_cap: 400 }],
    AS_OF
  );
  assert.equal(withTransfers[0].actualMTD, 100);
});

test('the Way2Save sweep does not inflate outflow', () => {
  // $1,000/month of savings sweeps would swamp several flex caps.
  const savings = prepared().filter((t) => t.category === 'savings');
  assert.ok(savings.length > 0, 'fixture should contain sweeps');
  for (const t of savings) assert.equal(t.is_transfer, 1);
  assert.ok(!FLEX_CATEGORIES.includes('savings'));
});

test('inflows are not spend', () => {
  const result = variance(
    [
      { date: '2026-08-05', amount: -2400, category: 'other', is_transfer: 0, removed: 0 },
      { date: '2026-08-06', amount: 50, category: 'other', is_transfer: 0, removed: 0 }
    ],
    [{ category: 'other', monthly_cap: 300 }],
    AS_OF
  );
  assert.equal(result[0].actualMTD, 50, 'a refund must not net against the cap');
});

test('removed transactions are excluded', () => {
  const result = variance(
    [
      { date: '2026-08-05', amount: 200, category: 'dining', is_transfer: 0, removed: 1 },
      { date: '2026-08-06', amount: 100, category: 'dining', is_transfer: 0, removed: 0 }
    ],
    [{ category: 'dining', monthly_cap: 400 }],
    AS_OF
  );
  assert.equal(result[0].actualMTD, 100);
});

test('pending transactions are included and counted once', () => {
  // Sync deletes the pending row when its settled twin arrives, so including
  // pending cannot double count — and excluding it would make the grid lag the
  // card by days.
  const pending = transactions.filter((t) => t.is_pending === 1);
  assert.ok(pending.length > 0, 'fixture should contain pending rows');

  const gamingPending = prepared().filter((t) => t.is_pending === 1 && t.category === 'gaming_atm');
  const total = row('gaming_atm').actualMTD;
  const settledOnly = variance(
    prepared().filter((t) => t.is_pending !== 1),
    budgets,
    AS_OF
  ).find((r) => r.category === 'gaming_atm').actualMTD;

  const pendingSum = gamingPending.reduce((s, t) => s + t.amount, 0);
  assert.equal(Math.round((settledOnly + pendingSum) * 100) / 100, total);
});

test('only the current month counts toward MTD', () => {
  const julyGaming = prepared().filter((t) => t.category === 'gaming_atm' && t.date < '2026-08-01');
  assert.ok(julyGaming.length > 0, 'fixture should have prior-month casino activity');
  assert.equal(row('gaming_atm').actualMTD, 1713.5, 'July withdrawals must not leak into August');
});

test('a month with no spend produces zeroed rows, not NaN', () => {
  const empty = variance([], budgets, AS_OF);
  for (const r of empty) {
    assert.equal(r.actualMTD, 0);
    assert.equal(r.projectedFullMonth, 0);
    // `-r.monthlyCap` is -0 for the zero-capped gaming row, and -0 is not
    // strictly equal to the 0 the engine produces.
    assert.equal(r.variance, r.monthlyCap === 0 ? 0 : -r.monthlyCap);
    assert.ok(Number.isFinite(r.variance));
  }
});

test('the first of the month does not divide by zero', () => {
  const result = variance(
    [{ date: '2026-08-01', amount: 250, category: 'dining', is_transfer: 0, removed: 0 }],
    [{ category: 'dining', monthly_cap: 400 }],
    '2026-08-01'
  );
  assert.ok(Number.isFinite(result[0].projectedFullMonth));
  assert.equal(result[0].projectedFullMonth, 7750); // 250 * 31
});

// ---------------------------------------------------------------- tolerance

test('a zero-tolerance obligation must match exactly', () => {
  const pennymac = ruleByLabel('Pennymac');
  assert.equal(pennymac.tolerance, 0);
  assert.equal(withinTolerance(3516.35, pennymac), true);
  assert.equal(withinTolerance(3516.36, pennymac), false);
});

test('a wide tolerance absorbs a variable payment', () => {
  const carmax = ruleByLabel('Carmax'); // 600.00 +/- 35%
  assert.equal(withinTolerance(612.44, carmax), true);
  assert.equal(withinTolerance(810, carmax), true);
  assert.equal(withinTolerance(811, carmax), false);
});

test('tolerance compares magnitudes, so income signs do not break it', () => {
  const payroll = ruleByLabel('PanCAN payroll');
  assert.equal(withinTolerance(-5096.61, payroll), true);
});

test('tolerance is unanswerable for a rule with no expected amount', () => {
  assert.equal(withinTolerance(500, ruleByLabel('MoneyKey')), null);
});

test('the default tolerance is two percent', () => {
  const spectrum = ruleByLabel('Spectrum'); // 175.80, default tolerance
  assert.equal(spectrum.tolerance, 0.02);
  assert.equal(withinTolerance(179, spectrum), true);
  assert.equal(withinTolerance(180, spectrum), false);
});
