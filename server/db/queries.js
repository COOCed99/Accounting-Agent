// Shared reads. The one place that joins rules onto transactions and resolves
// the effective category, so every route agrees on what a transaction "is".

import { db } from './index.js';
import { classify, compileRules, resolveCategory } from '../engine/classify.js';

export function getAccounts() {
  return db.prepare('SELECT id, item_id, name, mask, type, subtype, is_primary, current_balance, available_balance, balance_as_of FROM accounts ORDER BY is_primary DESC, name').all();
}

/** The account the projection starts from. */
export function getPrimaryAccount() {
  return (
    db.prepare('SELECT * FROM accounts WHERE is_primary = 1').get() ??
    db.prepare('SELECT * FROM accounts ORDER BY id LIMIT 1').get() ??
    null
  );
}

export function getRules({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active = 1' : '';
  return db.prepare(`SELECT * FROM rules ${where} ORDER BY id`).all();
}

/**
 * Active rules, each carrying the date it most recently actually fired.
 *
 * Biweekly expansion needs this: stepping 14 days off a real occurrence is the
 * only way to keep the cadence in phase with the calendar.
 */
export function getRulesForProjection() {
  const rules = getRules({ activeOnly: true });
  const lastByRule = new Map(
    db
      .prepare('SELECT rule_id, MAX(date) AS last_occurrence FROM transactions WHERE rule_id IS NOT NULL AND removed = 0 GROUP BY rule_id')
      .all()
      .map((r) => [r.rule_id, r.last_occurrence])
  );
  return rules.map((rule) => ({ ...rule, last_occurrence: lastByRule.get(rule.id) ?? null }));
}

export function getBudgets() {
  return db.prepare('SELECT category, monthly_cap FROM budgets ORDER BY category').all();
}

export function getManualEvents({ from, to } = {}) {
  if (from && to) {
    return db.prepare('SELECT * FROM manual_events WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to);
  }
  return db.prepare('SELECT * FROM manual_events ORDER BY date').all();
}

/**
 * Transactions with their rule label and effective category attached.
 * `category` is resolved override > rule > Plaid fallback — never read from
 * the row directly, because there is no category column by design.
 */
export function getTransactions({ from, to, includeRemoved = false } = {}) {
  const clauses = [];
  const params = {};
  if (from) {
    clauses.push('t.date >= @from');
    params.from = from;
  }
  if (to) {
    clauses.push('t.date <= @to');
    params.to = to;
  }
  if (!includeRemoved) clauses.push('t.removed = 0');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT t.*, r.label AS rule_label, r.kind AS rule_kind, r.category AS rule_category,
             r.expected_amount, r.tolerance, a.name AS account_name
      FROM transactions t
      LEFT JOIN rules r ON r.id = t.rule_id
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
      ORDER BY t.date DESC, t.id
    `)
    .all(params);

  const compiled = compileRules(getRules({ activeOnly: true }));

  return rows.map((row) => {
    // A stored rule_id is authoritative. Only rows that were never matched get
    // re-run through the matcher, so a rule edited after the fact does not
    // silently reinterpret history.
    const rule = row.rule_id
      ? { id: row.rule_id, category: row.rule_category, kind: row.rule_kind, label: row.rule_label }
      : classify(row, compiled);
    return { ...row, category: resolveCategory(row, rule) };
  });
}

export function getSyncLog(limit = 20) {
  return db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit);
}

export function getLastSync() {
  return db.prepare('SELECT * FROM sync_log WHERE error IS NULL ORDER BY id DESC LIMIT 1').get() ?? null;
}
