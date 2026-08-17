// Actual vs budget. Pure — no DB access, no I/O.

import { daysInMonthOf, dayOfMonth, startOfMonth } from './dates.js';
import { FLEX_CATEGORIES } from './taxonomy.js';

const round = (n) => Math.round(n * 100) / 100;

/** Projected spend crosses this fraction of cap and the row goes amber. */
const WARNING_THRESHOLD = 0.8;

/**
 * @param {Array} transactions
 *        Each needs { date, amount, category, is_transfer, removed }.
 *        `category` must already be resolved through
 *        classify.resolveCategory — override, then rule, then Plaid.
 *
 *        PENDING ROWS ARE INCLUDED, and that is safe rather than the
 *        double-count trap it looks like: sync deletes the pending row the
 *        moment its settled twin arrives, so a charge is never represented
 *        twice. Dropping pending instead would make the grid lag the card by
 *        a couple of days, which defeats the point of reading it on day 8.
 * @param {Array} budgets - [{ category, monthly_cap }]
 * @param {string} asOfDate - YYYY-MM-DD
 * @returns {Array} [{
 *   category, monthlyCap, actualMTD, projectedFullMonth, variance, status
 * }] sorted by absolute variance, descending
 */
export function variance(transactions, budgets, asOfDate) {
  const monthStart = startOfMonth(asOfDate);
  const inMonth = daysInMonthOf(asOfDate);
  const elapsed = dayOfMonth(asOfDate);

  const spent = new Map();
  for (const t of transactions) {
    if (t.removed) continue;
    if (t.is_transfer) continue;
    if (t.amount <= 0) continue; // inflows are not spend
    if (!FLEX_CATEGORIES.includes(t.category)) continue;
    if (t.date < monthStart || t.date > asOfDate) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) + t.amount);
  }

  const rows = budgets.map(({ category, monthly_cap: monthlyCap }) => {
    const actualMTD = round(spent.get(category) ?? 0);
    const projectedFullMonth = round((actualMTD / elapsed) * inMonth);
    return {
      category,
      monthlyCap,
      actualMTD,
      projectedFullMonth,
      variance: round(projectedFullMonth - monthlyCap),
      status: status(projectedFullMonth, monthlyCap)
    };
  });

  // Largest overspend first, always. No alphabetical fallback, no user
  // reordering — the top row is supposed to tell you what to stop doing.
  return rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

/**
 * A zero cap cannot be expressed as a ratio, and `gaming_atm` is capped at
 * zero on purpose. Any spend against a zero cap is a breach.
 */
function status(projected, cap) {
  if (cap <= 0) return projected > 0 ? 'breach' : 'ok';
  const ratio = projected / cap;
  if (ratio > 1) return 'breach';
  if (ratio >= WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

/**
 * Did a fixed obligation post at the amount its rule expects?
 * `tolerance` is a fraction of expected_amount; 0 means exact.
 */
export function withinTolerance(actual, rule) {
  if (rule.expected_amount === null || rule.expected_amount === undefined) return null;
  const expected = Math.abs(rule.expected_amount);
  const allowed = expected * (rule.tolerance ?? 0.02);
  return Math.abs(Math.abs(actual) - expected) <= allowed;
}
