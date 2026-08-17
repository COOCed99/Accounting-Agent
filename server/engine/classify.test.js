import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classify,
  classifyAll,
  compileRules,
  fallbackCategory,
  isValidPattern,
  resolveCategory
} from './classify.js';
import { ALL_CATEGORIES, KINDS } from './taxonomy.js';
import { loadRules, loadTransactions } from './__fixtures__/load.js';

const rules = loadRules();
const compiled = compileRules(rules);
const { transactions, source } = loadTransactions();

const find = (name) => {
  const t = transactions.find((tx) => tx.name === name);
  if (!t) throw new Error(`fixture has no transaction named '${name}'`);
  return t;
};

const categoryOf = (name) => {
  const t = find(name);
  return resolveCategory(t, classify(t, compiled));
};

test('every seed rule is well formed', () => {
  for (const rule of rules) {
    assert.ok(isValidPattern(rule.pattern), `${rule.label}: pattern is not a valid regex`);
    assert.ok(KINDS.includes(rule.kind), `${rule.label}: unknown kind '${rule.kind}'`);
    assert.ok(ALL_CATEGORIES.includes(rule.category), `${rule.label}: unknown category '${rule.category}'`);
  }
});

test('rules are evaluated in ascending id order', () => {
  const ids = rules.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('Gaming ATM is ordered above ATM cash', () => {
  const gaming = rules.find((r) => r.label === 'Gaming ATM');
  const cash = rules.find((r) => r.label === 'ATM cash');
  assert.ok(
    gaming.id < cash.id,
    'Gaming ATM must be evaluated first, or casino withdrawals vanish into generic cash'
  );
});

test('a casino withdrawal that also reads as a generic ATM lands in gaming_atm', () => {
  // Matches BOTH 'NON-WF ATM' (ATM cash) and 'LAS VEGAS BLVD' (Gaming ATM).
  // Ordering is the only thing that decides this, and it is the single most
  // important classification in the app.
  assert.equal(categoryOf('NON-WF ATM WITHDRAWAL LAS VEGAS BLVD'), 'gaming_atm');
});

test('an ordinary ATM withdrawal stays in cash_atm', () => {
  assert.equal(categoryOf('ATM WITHDRAWAL 08/03 TEMECULA CA'), 'cash_atm');
  assert.equal(categoryOf('NON-WF ATM WITHDRAWAL MURRIETA CA'), 'cash_atm');
});

test('regex metacharacters in descriptors are matched literally', () => {
  // 'ACHIEVE\(CFTPAY\)' — unescaped parens would silently match nothing.
  assert.equal(categoryOf('ACHIEVE(CFTPAY) DEBIT 250602'), 'debt_service');
  assert.equal(categoryOf('GLF*ROGER DUNN GOLF SHOPS'), 'recreation');
});

test('fixed obligations classify to their categories', () => {
  assert.equal(categoryOf('PENNYMAC CASH  MTG PYMT 250601'), 'housing');
  assert.equal(categoryOf('RETREAT HOMEOWNERS ASSN DUES'), 'housing');
  assert.equal(categoryOf('CARMAX AUTO FINANCING PAYMENT'), 'auto');
  assert.equal(categoryOf('MAZDA FINANCIAL SERVICES'), 'auto');
  assert.equal(categoryOf('STATE FARM INSURANCE AUTOPAY'), 'insurance');
  assert.equal(categoryOf('SPECTRUM MOBILE PAYMENT'), 'utilities');
  assert.equal(categoryOf('MOHELA STUDENT LN PYMT'), 'debt_service');
});

test('Spectrum Mobile does not get swallowed by the Spectrum rule', () => {
  // Both resolve to utilities, so only the rule id proves they stayed distinct.
  const mobile = classify(find('SPECTRUM MOBILE PAYMENT'), compiled);
  const internet = classify(find('SPECTRUM SPECTRUM PAYMENT'), compiled);
  assert.equal(mobile.label, 'Spectrum Mobile');
  assert.equal(internet.label, 'Spectrum');
});

test('payroll classifies as income under either descriptor', () => {
  assert.equal(categoryOf('PANCREATIC PAYROLL DIRECT DEP'), 'payroll');
  assert.equal(categoryOf('BAMBOOHR PAYROLL DIRECT DEP'), 'payroll');
});

test('consulting inflows classify as income', () => {
  assert.equal(categoryOf('NUAGECONCEPTSCOM PAYMENT ACH'), 'consulting');
  assert.equal(categoryOf('AI PROJECT PARTNERS LLC XFER'), 'consulting');
  assert.equal(categoryOf('PAYPAL TRANSFER FROM DO IT CONSULTING'), 'consulting');
});

test('savings sweeps and internal moves are both flagged as transfers', () => {
  const classified = classifyAll(transactions, rules);
  const by = (name) => classified.find((c) => c.id === find(name).id);

  const way2save = by('WAY2SAVE SAVINGS TRANSFER');
  assert.equal(way2save.category, 'savings');
  assert.equal(way2save.is_transfer, 1, 'Way2Save must not count as spend');

  const internalOut = by('ONLINE TRANSFER TO HOLMES C SAVINGS');
  assert.equal(internalOut.category, 'internal_transfer');
  assert.equal(internalOut.is_transfer, 1);

  const internalIn = by('ONLINE TRANSFER FROM HOLMES C SAVINGS');
  assert.equal(internalIn.category, 'internal_transfer');
  assert.equal(internalIn.is_transfer, 1);
});

test('unmatched outflows fall back to the Plaid category', () => {
  assert.equal(categoryOf('CHICK-FIL-A #02471'), 'dining');
  assert.equal(categoryOf('CHEESECAKE FACTORY TEMECULA'), 'dining');
  assert.equal(categoryOf('CHEVRON 0094521'), 'fuel');
  assert.equal(categoryOf('COSTCO GAS #1084'), 'fuel');
  assert.equal(categoryOf('TARGET 00021845'), 'retail');
});

test('dining, fuel and retail are reachable at all', () => {
  // These three have budgets but no seed rules. Without the Plaid fallback map
  // their variance rows would read $0 forever and the grid would understate.
  const seen = new Set(classifyAll(transactions, rules).map((c) => c.category));
  for (const category of ['dining', 'fuel', 'retail']) {
    assert.ok(seen.has(category), `nothing ever classifies as ${category}`);
  }
});

test('an unmatched outflow with no Plaid hint becomes other', () => {
  const tx = { name: 'SOME UNKNOWN MERCHANT', amount: 42, plaid_category: null };
  assert.equal(resolveCategory(tx, null), 'other');
});

test('an unmatched inflow is left uncategorized, not dropped into other', () => {
  // 'other' is a $300/mo flex SPEND bucket. A deposit landing there would
  // credit the discretionary budget and hide overspend.
  const tx = { name: 'MYSTERY DEPOSIT', amount: -1500, plaid_category: null };
  assert.equal(resolveCategory(tx, null), null);
});

test('a user override beats the matched rule', () => {
  const tx = { ...find('PECHANGA RESORT CASINO ATM'), category_override: 'recreation' };
  assert.equal(resolveCategory(tx, classify(tx, compiled)), 'recreation');
});

test('an invalid user pattern is skipped instead of throwing', () => {
  const broken = [{ id: 1, label: 'bad', pattern: '([unclosed', category: 'other', kind: 'flex', active: 1 }];
  assert.equal(isValidPattern('([unclosed'), false);
  assert.doesNotThrow(() => classify({ name: 'ANYTHING' }, compileRules(broken)));
  assert.equal(classify({ name: 'ANYTHING' }, compileRules(broken)), null);
});

test('an inactive rule never matches', () => {
  const inactive = rules.map((r) => (r.label === 'Pennymac' ? { ...r, active: 0 } : r));
  const tx = find('PENNYMAC CASH  MTG PYMT 250601');
  assert.equal(classify(tx, compileRules(inactive)), null);
});

test('a transaction with no descriptor matches nothing', () => {
  assert.equal(classify({ name: '', merchant_name: null }, compiled), null);
});

test('fallbackCategory ignores categories it does not know', () => {
  assert.equal(fallbackCategory('GOVERNMENT_AND_NON_PROFIT_DONATIONS'), null);
  assert.equal(fallbackCategory(null), null);
  assert.equal(fallbackCategory('FOOD_AND_DRINK_COFFEE'), 'dining');
});

test('every classified category is inside the taxonomy', () => {
  for (const { id, category } of classifyAll(transactions, rules)) {
    if (category === null) continue;
    assert.ok(ALL_CATEGORIES.includes(category), `${id} classified as unknown category '${category}'`);
  }
});

test('fixture coverage is reported', () => {
  // Not an assertion about the sample set — a signal for when the real export
  // replaces it. A seed pattern matching nothing in 90 days of real data is a
  // pattern that needs fixing.
  const matched = new Set(
    classifyAll(transactions, rules)
      .map((c) => c.rule_id)
      .filter(Boolean)
  );
  const unmatched = rules.filter((r) => !matched.has(r.id)).map((r) => r.label);
  console.log(`  fixture source: ${source}, ${transactions.length} transactions`);
  console.log(`  rules matched:  ${matched.size}/${rules.length}`);
  if (unmatched.length) console.log(`  unexercised:    ${unmatched.join(', ')}`);
  assert.ok(matched.size > 0);
});
