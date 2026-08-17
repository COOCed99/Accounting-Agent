// Rule matcher. Pure — no DB access, no I/O.

import { FLEX_CATEGORIES, INTERNAL_TRANSFER } from './taxonomy.js';

/**
 * Fallback map for transactions that match no rule, keyed by prefix of Plaid's
 * personal_finance_category (primary or detailed).
 *
 * This is load-bearing, not decoration: `dining`, `fuel` and `retail` have
 * budgets but no seed rules, so without this map those three rows of the
 * variance grid would read $0 forever and the grid would understate the month.
 */
const PLAID_CATEGORY_MAP = [
  ['FOOD_AND_DRINK', 'dining'],
  ['TRANSPORTATION_GAS', 'fuel'],
  ['TRANSPORTATION', 'fuel'],
  ['GENERAL_MERCHANDISE', 'retail'],
  ['ENTERTAINMENT', 'recreation'],
  ['PERSONAL_CARE', 'retail'],
  ['TRAVEL', 'recreation'],
  ['RENT_AND_UTILITIES', 'utilities'],
  ['LOAN_PAYMENTS', 'debt_service'],
  ['HOME_IMPROVEMENT', 'retail'],
  ['MEDICAL', 'other'],
  ['GENERAL_SERVICES', 'other'],
  ['BANK_FEES', 'other']
];

/**
 * Compile a rule's pattern once. Invalid user-authored patterns must not be
 * able to take down a sync, so a bad regex compiles to `null` and is skipped
 * at match time rather than thrown.
 */
export function compileRule(rule) {
  try {
    return new RegExp(rule.pattern, 'i');
  } catch {
    return null;
  }
}

/** True if `pattern` is a regex this engine can actually use. */
export function isValidPattern(pattern) {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

export function compileRules(rules) {
  return rules.map((rule) => ({ ...rule, regex: compileRule(rule) }));
}

/**
 * First-match-wins against the transaction's descriptor.
 *
 * `rules` MUST arrive in evaluation order (ascending id). Gaming ATM sits
 * above ATM cash in that order on purpose.
 *
 * @param {{name: string, merchant_name?: string|null}} transaction
 * @param {Array} rules - active rules, in evaluation order; may be pre-compiled
 * @returns {Object|null} the matched rule, or null
 */
export function classify(transaction, rules) {
  const haystack = [transaction.name, transaction.merchant_name]
    .filter(Boolean)
    .join(' ');
  if (!haystack) return null;

  for (const rule of rules) {
    if (rule.active === 0) continue;
    const regex = rule.regex !== undefined ? rule.regex : compileRule(rule);
    if (!regex) continue;
    if (regex.test(haystack)) return rule;
  }
  return null;
}

/** Map a Plaid personal_finance_category string onto our taxonomy, or null. */
export function fallbackCategory(plaidCategory) {
  if (!plaidCategory) return null;
  const value = String(plaidCategory).toUpperCase();
  for (const [prefix, category] of PLAID_CATEGORY_MAP) {
    if (value.startsWith(prefix)) return category;
  }
  return null;
}

/**
 * The category actually used by every downstream calculation.
 *
 * Precedence: user override > matched rule > Plaid category > 'other'.
 *
 * An inflow that resolves to nothing stays `null` rather than falling into
 * 'other'. 'other' is a flex SPEND bucket with a $300 cap; letting a deposit
 * land there would silently credit the month's discretionary budget.
 *
 * @param {Object} transaction - needs category_override, plaid_category, amount
 * @param {Object|null} rule - the matched rule, if any
 * @returns {string|null}
 */
export function resolveCategory(transaction, rule) {
  if (transaction.category_override) return transaction.category_override;
  if (rule?.category) return rule.category;

  const fallback = fallbackCategory(transaction.plaid_category);
  if (fallback) return fallback;

  // Plaid convention: positive = outflow.
  return transaction.amount > 0 ? 'other' : null;
}

/**
 * Classify a batch, returning only the fields sync needs to persist.
 *
 * @returns {Array<{id, rule_id, is_transfer, category}>}
 */
export function classifyAll(transactions, rules) {
  const compiled = compileRules(rules);
  return transactions.map((transaction) => {
    const rule = classify(transaction, compiled);
    const category = resolveCategory(transaction, rule);
    return {
      id: transaction.id,
      rule_id: rule ? rule.id : null,
      // Both savings sweeps and true internal moves are `transfer` kind, and
      // both are excluded from SPEND. Only `internal_transfer` is additionally
      // excluded from the balance projection — see project.js.
      is_transfer: rule?.kind === 'transfer' || category === INTERNAL_TRANSFER ? 1 : 0,
      category
    };
  });
}

/** True if this transaction counts toward discretionary spend. */
export function isFlexSpend(transaction, category) {
  if (transaction.removed) return false;
  if (transaction.is_transfer) return false;
  if (!FLEX_CATEGORIES.includes(category)) return false;
  return transaction.amount > 0;
}
