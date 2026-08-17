import test from 'node:test';
import assert from 'node:assert/strict';

import {
  budgetFlexPerDay,
  demonstratedFlexPerDay,
  expandRule,
  isProjectable,
  isUnknown,
  project,
  signedAmount
} from './project.js';
import { classify, compileRules, isFlexSpend, resolveCategory } from './classify.js';
import { addDays, dayOfWeek, diffDays } from './dates.js';
import { loadBudgets, loadRules, loadTransactions, ruleByLabel } from './__fixtures__/load.js';

const rules = loadRules();
const budgets = loadBudgets();
const { transactions } = loadTransactions();

const base = {
  startBalance: 10000,
  startDate: '2026-08-17',
  endDate: '2026-09-30',
  rules: [],
  manualEvents: [],
  flexPerDay: 0
};

const eventsOf = (result, label) =>
  result.days.flatMap((d) => d.events.filter((e) => e.label === label).map((e) => ({ ...e, date: d.date })));

// ---------------------------------------------------------------- sign convention

test('income raises the balance and obligations lower it', () => {
  assert.equal(signedAmount({ kind: 'income', expected_amount: 5096.61 }), -5096.61);
  assert.equal(signedAmount({ kind: 'fixed', expected_amount: 3516.35 }), 3516.35);
  assert.equal(signedAmount({ kind: 'transfer', expected_amount: 500 }), 500);
});

test('a magnitude stored with the wrong sign is normalized by kind', () => {
  // Plaid's convention is asserted at the boundary, not re-derived downstream.
  assert.equal(signedAmount({ kind: 'income', expected_amount: -5096.61 }), -5096.61);
  assert.equal(signedAmount({ kind: 'fixed', expected_amount: -3516.35 }), 3516.35);
});

test('a single obligation moves the closing balance by exactly its amount', () => {
  const result = project({
    ...base,
    endDate: '2026-09-05',
    rules: [ruleByLabel('Pennymac')]
  });
  const sept1 = result.days.find((d) => d.date === '2026-09-01');
  assert.equal(sept1.closing, sept1.opening - 3516.35);
});

test('payroll moves it the other way', () => {
  const result = project({ ...base, endDate: '2026-09-05', rules: [ruleByLabel('PanCAN payroll')] });
  const payday = result.days.find((d) => d.date === '2026-08-30');
  assert.equal(payday.closing, payday.opening + 5096.61);
});

// ---------------------------------------------------------------- month-end edges

test('a monthly rule anchored past the end of a short month fires on the last day', () => {
  const rule = { id: 1, label: 'Late', category: 'housing', kind: 'fixed', expected_amount: 100, cadence: 'monthly', anchor_day: 31, active: 1 };
  const dates = expandRule(rule, '2026-01-01', '2026-04-30');
  assert.deepEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('February is clamped correctly in a leap year too', () => {
  const rule = { id: 1, label: 'Late', category: 'housing', kind: 'fixed', expected_amount: 100, cadence: 'monthly', anchor_day: 30, active: 1 };
  assert.deepEqual(expandRule(rule, '2028-02-01', '2028-02-29'), ['2028-02-29']);
});

test('a monthly rule fires once per month and never outside the range', () => {
  const dates = expandRule(ruleByLabel('Pennymac'), '2026-08-17', '2026-11-30');
  assert.deepEqual(dates, ['2026-09-01', '2026-10-01', '2026-11-01']);
});

// ---------------------------------------------------------------- semimonthly

test('semimonthly fires on the anchor and fifteen days later', () => {
  const dates = expandRule(ruleByLabel('Way2Save'), '2026-08-01', '2026-09-30');
  assert.deepEqual(dates, ['2026-08-01', '2026-08-16', '2026-09-01', '2026-09-16']);
});

test('both halves of a semimonthly clamp to the same day only once', () => {
  // anchor 28 in February: 28 and 43-clamped-to-28 collide. Firing twice would
  // double-charge the obligation.
  const rule = { id: 1, label: 'Collide', category: 'debt_service', kind: 'fixed', expected_amount: 100, cadence: 'semimonthly', anchor_day: 28, active: 1 };
  assert.deepEqual(expandRule(rule, '2026-02-01', '2026-02-28'), ['2026-02-28']);
});

test('payroll on the 15th also pays at month end', () => {
  const dates = expandRule(ruleByLabel('PanCAN payroll'), '2026-08-01', '2026-09-30');
  assert.deepEqual(dates, ['2026-08-15', '2026-08-30', '2026-09-15', '2026-09-30']);
});

// ---------------------------------------------------------------- biweekly drift

test('biweekly steps off the last real occurrence, not the day of month', () => {
  const rule = { ...ruleByLabel('Achieve'), last_occurrence: '2026-08-11' };
  const dates = expandRule(rule, '2026-08-17', '2026-09-30');
  assert.deepEqual(dates, ['2026-08-25', '2026-09-08', '2026-09-22']);
  for (const date of dates) {
    assert.notEqual(new Date(`${date}T00:00:00Z`).getUTCDate(), rule.anchor_day);
  }
});

test('biweekly gaps stay exactly fourteen days across several months', () => {
  const rule = { ...ruleByLabel('Achieve'), last_occurrence: '2026-08-11' };
  const dates = expandRule(rule, '2026-08-12', '2027-02-28');
  assert.ok(dates.length > 12);
  for (let i = 1; i < dates.length; i++) {
    assert.equal(diffDays(dates[i - 1], dates[i]), 14, `${dates[i - 1]} -> ${dates[i]} drifted`);
  }
});

test('biweekly does not re-fire the occurrence it was anchored to', () => {
  const rule = { ...ruleByLabel('Achieve'), last_occurrence: '2026-08-17' };
  const dates = expandRule(rule, '2026-08-17', '2026-09-30');
  assert.ok(!dates.includes('2026-08-17'), 'the anchoring payment already happened');
  assert.equal(dates[0], '2026-08-31');
});

test('a biweekly rule with no observed occurrence warns instead of guessing silently', () => {
  const warnings = [];
  const rule = { ...ruleByLabel('Achieve'), last_occurrence: null };
  const dates = expandRule(rule, '2026-08-17', '2026-09-30', warnings);
  assert.ok(dates.length > 0, 'the obligation must still appear');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'biweekly_unanchored');
});

// ---------------------------------------------------------------- weekly

test('weekly reads anchor_day as a day of week', () => {
  const dates = expandRule(ruleByLabel('Fundbox'), '2026-08-17', '2026-09-30');
  assert.ok(dates.length >= 6);
  for (const date of dates) assert.equal(dayOfWeek(date), 2, `${date} is not a Tuesday`);
  for (let i = 1; i < dates.length; i++) assert.equal(diffDays(dates[i - 1], dates[i]), 7);
});

// ---------------------------------------------------------------- what is projectable

test('cadence none never fires', () => {
  assert.equal(isProjectable(ruleByLabel('Nuage transfer')), false);
  assert.deepEqual(expandRule(ruleByLabel('Nuage transfer'), '2026-08-01', '2026-12-31'), []);
});

test('flex rules are not expanded — flexPerDay already covers them', () => {
  for (const label of ['Gaming ATM', 'ATM cash', 'Apple Card', 'Golf']) {
    assert.equal(isProjectable(ruleByLabel(label)), false, `${label} must not be expanded`);
  }
  const result = project({ ...base, rules, flexPerDay: 100 });
  assert.equal(eventsOf(result, 'Gaming ATM').length, 0);
});

test('internal transfers are excluded from the balance projection', () => {
  // They net to zero across accounts we already count.
  assert.equal(isProjectable(ruleByLabel('Internal xfer')), false);
});

test('a savings sweep is NOT excluded — it really does leave checking', () => {
  assert.equal(isProjectable(ruleByLabel('Way2Save')), true);
  const result = project({ ...base, rules: [ruleByLabel('Way2Save')] });
  assert.ok(eventsOf(result, 'Way2Save').length > 0);
});

test('an inactive rule is never projected', () => {
  const result = project({ ...base, rules: [{ ...ruleByLabel('Pennymac'), active: 0 }] });
  assert.equal(eventsOf(result, 'Pennymac').length, 0);
});

// ---------------------------------------------------------------- unknown obligations

test('the four unconfirmed notes are surfaced, not silently skipped', () => {
  const result = project({ ...base, rules });
  const labels = result.unknownRules.map((r) => r.label).sort();
  assert.deepEqual(labels, ['Bright Lending', 'Clear Air', 'Lending Creative', 'MoneyKey']);
});

test('an unknown rule contributes nothing to the balance', () => {
  const withUnknowns = project({ ...base, rules });
  const withoutUnknowns = project({ ...base, rules: rules.filter((r) => !isUnknown(r)) });
  assert.equal(withUnknowns.endBalance, withoutUnknowns.endBalance);
  assert.ok(withUnknowns.unknownRules.length > 0, 'and it must be reported instead');
});

test('flex rules and irregular income are not listed as unknown obligations', () => {
  // They carry a null amount by design; listing them would bury the four that
  // actually need an agreement entered.
  const result = project({ ...base, rules });
  const labels = result.unknownRules.map((r) => r.label);
  for (const noise of ['Gaming ATM', 'Apple Card', 'Nuage transfer', 'AIPP transfer']) {
    assert.ok(!labels.includes(noise), `${noise} should not be an unknown obligation`);
  }
});

// ---------------------------------------------------------------- the walk

test('day zero reports today as known — no events, no flex', () => {
  // startBalance is the bank's available balance right now, so anything that
  // posted today is already inside it.
  const result = project({ ...base, rules, flexPerDay: 109.68 });
  assert.equal(result.days[0].date, base.startDate);
  assert.equal(result.days[0].flex, 0);
  assert.deepEqual(result.days[0].events, []);
  assert.equal(result.days[0].closing, base.startBalance);
});

test('same-day events can be opted back in', () => {
  const rule = { ...ruleByLabel('Pennymac'), cadence: 'monthly', anchor_day: 17 };
  const off = project({ ...base, endDate: '2026-08-20', rules: [rule] });
  const on = project({ ...base, endDate: '2026-08-20', rules: [rule], includeStartDateEvents: true });
  assert.equal(off.days[0].closing, base.startBalance);
  assert.equal(on.days[0].closing, base.startBalance - 3516.35);
});

test('flex is charged every day after day zero', () => {
  const result = project({ ...base, endDate: '2026-08-20', flexPerDay: 100 });
  assert.deepEqual(result.days.map((d) => d.flex), [0, 100, 100, 100]);
  assert.equal(result.endBalance, 10000 - 300);
});

test('each opening equals the previous closing', () => {
  const result = project({ ...base, rules, flexPerDay: 109.68 });
  for (let i = 1; i < result.days.length; i++) {
    assert.equal(result.days[i].opening, result.days[i - 1].closing, `break at ${result.days[i].date}`);
  }
});

test('the range is inclusive on both ends', () => {
  const result = project({ ...base, endDate: '2026-08-19' });
  assert.deepEqual(result.days.map((d) => d.date), ['2026-08-17', '2026-08-18', '2026-08-19']);
});

test('a single-day range is legal', () => {
  const result = project({ ...base, endDate: base.startDate, flexPerDay: 500 });
  assert.equal(result.days.length, 1);
  assert.equal(result.endBalance, base.startBalance);
});

// ---------------------------------------------------------------- low point and breaches

test('the low point is the deepest closing balance, not the last one', () => {
  const result = project({
    ...base,
    startBalance: 4000,
    endDate: '2026-09-20',
    rules: [ruleByLabel('Pennymac')],
    manualEvents: [{ id: 1, date: '2026-09-10', label: 'Consulting invoice', amount: 8000, kind: 'income' }]
  });
  assert.equal(result.lowPoint.date, '2026-09-01');
  // Written out rather than as `4000 - 3516.35`, which in float is
  // 483.6500000000001. The engine rounding to cents is the point.
  assert.equal(result.lowPoint.balance, 483.65);
  assert.ok(result.endBalance > result.lowPoint.balance, 'the invoice should recover it');
});

test('breaches list every day that closes below zero', () => {
  const result = project({
    ...base,
    startBalance: 1000,
    endDate: '2026-09-10',
    rules: [ruleByLabel('Pennymac')]
  });
  assert.ok(result.breaches.length > 0);
  assert.equal(result.breaches[0].date, '2026-09-01');
  for (const breach of result.breaches) assert.ok(breach.balance < 0);
  assert.equal(result.breaches.length, result.days.filter((d) => d.closing < 0).length);
});

test('a solvent projection reports no breaches', () => {
  const result = project({ ...base, startBalance: 500000, rules, flexPerDay: 109.68 });
  assert.deepEqual(result.breaches, []);
  assert.ok(result.lowPoint.balance > 0);
});

// ---------------------------------------------------------------- manual events

test('manual events fire on their date and respect their kind', () => {
  const result = project({
    ...base,
    endDate: '2026-08-25',
    manualEvents: [
      { id: 1, date: '2026-08-20', label: 'Tax bill', amount: 2500, kind: 'fixed', confirmed: 1 },
      { id: 2, date: '2026-08-22', label: 'Refund', amount: 900, kind: 'income', confirmed: 0 }
    ]
  });
  assert.equal(result.days.find((d) => d.date === '2026-08-20').events[0].amount, 2500);
  assert.equal(result.days.find((d) => d.date === '2026-08-22').events[0].amount, -900);
  assert.equal(result.endBalance, 10000 - 2500 + 900);
});

test('a manual event outside the range is ignored', () => {
  const result = project({
    ...base,
    endDate: '2026-08-20',
    manualEvents: [{ id: 1, date: '2027-01-01', label: 'Far off', amount: 5000, kind: 'fixed' }]
  });
  assert.equal(result.endBalance, 10000);
});

test('an income event entered as a positive number is still an inflow', () => {
  const result = project({
    ...base,
    endDate: '2026-08-20',
    manualEvents: [{ id: 1, date: '2026-08-18', label: 'Bonus', amount: 1000, kind: 'income' }]
  });
  assert.equal(result.endBalance, 11000);
});

// ---------------------------------------------------------------- flex modeling

test('budget flex per day is the whole cap spread over the month', () => {
  assert.equal(budgetFlexPerDay(budgets, '2026-08-17'), 109.68); // 3400 / 31
  assert.equal(budgetFlexPerDay(budgets, '2026-09-17'), 113.33); // 3400 / 30
  assert.equal(budgetFlexPerDay(budgets, '2026-02-10'), 121.43); // 3400 / 28
});

test('demonstrated flex is measured from actual flex spend', () => {
  const compiled = compileRules(rules);
  const flex = transactions
    .map((t) => ({ ...t, category: resolveCategory(t, classify(t, compiled)) }))
    .filter((t) => isFlexSpend({ ...t, is_transfer: 0 }, t.category));

  const demonstrated = demonstratedFlexPerDay(flex, '2026-08-17');
  assert.ok(demonstrated > 0);

  const window = flex.filter((t) => t.date > addDays('2026-08-17', -30) && t.date <= '2026-08-17');
  const expected = Math.round((window.reduce((s, t) => s + t.amount, 0) / 30) * 100) / 100;
  assert.equal(demonstrated, expected);
});

test('demonstrated flex outruns budgeted flex on this data', () => {
  // The whole product is the gap between these two curves. If the fixture ever
  // stops showing one, the fixture is wrong.
  const compiled = compileRules(rules);
  const flex = transactions
    .map((t) => ({ ...t, category: resolveCategory(t, classify(t, compiled)) }))
    .filter((t) => isFlexSpend({ ...t, is_transfer: 0 }, t.category));

  assert.ok(demonstratedFlexPerDay(flex, '2026-08-17') > budgetFlexPerDay(budgets, '2026-08-17'));
});

test('demonstrated flex is zero when nothing was spent', () => {
  assert.equal(demonstratedFlexPerDay([], '2026-08-17'), 0);
});

test('the two flex assumptions produce different curves', () => {
  const budgeted = project({ ...base, rules, flexPerDay: 109.68 });
  const demonstrated = project({ ...base, rules, flexPerDay: 340.0 });
  assert.ok(demonstrated.endBalance < budgeted.endBalance);
  assert.ok(demonstrated.lowPoint.balance < budgeted.lowPoint.balance);
});

// ---------------------------------------------------------------- input validation

test('bad input is rejected at the boundary', () => {
  assert.throws(() => project({ ...base, startBalance: 'lots' }), TypeError);
  assert.throws(() => project({ ...base, startBalance: NaN }), TypeError);
  assert.throws(() => project({ ...base, startDate: '08/17/2026' }), TypeError);
  assert.throws(() => project({ ...base, endDate: '2026-08-16' }), RangeError);
  assert.throws(() => project({ ...base, flexPerDay: -5 }), TypeError);
});

test('a zero balance is a legal starting point', () => {
  assert.doesNotThrow(() => project({ ...base, startBalance: 0 }));
});

test('a negative starting balance projects rather than throwing', () => {
  const result = project({ ...base, startBalance: -250, endDate: '2026-08-18' });
  assert.equal(result.days[0].closing, -250);
  assert.equal(result.breaches.length, 2);
});

// ---------------------------------------------------------------- rounding

test('balances stay at cent precision over a long horizon', () => {
  const result = project({ ...base, endDate: '2027-08-17', rules, flexPerDay: 109.68 });
  for (const day of result.days) {
    assert.equal(day.closing, Math.round(day.closing * 100) / 100, `${day.date} drifted off cents`);
  }
});
