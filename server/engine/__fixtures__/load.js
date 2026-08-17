import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_RULES, SEED_BUDGETS } from '../../db/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const REAL = path.join(here, 'transactions.real.json');
const SAMPLE = path.join(here, 'transactions.sample.json');

/**
 * Prefers the real 90-day export when RUNWAY_FIXTURES=real and the export
 * exists. See ./README.md — the sample is a stand-in with real descriptor
 * strings but invented dates and flex amounts.
 */
export function loadTransactions() {
  const useReal = process.env.RUNWAY_FIXTURES === 'real' && fs.existsSync(REAL);
  const file = useReal ? REAL : SAMPLE;
  return {
    source: useReal ? 'real' : 'sample',
    transactions: JSON.parse(fs.readFileSync(file, 'utf8'))
  };
}

/**
 * Seed rules with the ids and defaults the database would have assigned.
 * Insertion order becomes id order, which is evaluation order.
 */
export function loadRules() {
  return SEED_RULES.map((rule, i) => ({
    id: i + 1,
    label: rule.label,
    pattern: rule.pattern,
    category: rule.category,
    kind: rule.kind,
    expected_amount: rule.expected_amount ?? null,
    tolerance: rule.tolerance === undefined ? 0.02 : rule.tolerance,
    cadence: rule.cadence ?? null,
    anchor_day: rule.anchor_day ?? null,
    active: 1
  }));
}

export function loadBudgets() {
  return SEED_BUDGETS.map((b) => ({ ...b }));
}

export function ruleByLabel(label) {
  const rule = loadRules().find((r) => r.label === label);
  if (!rule) throw new Error(`no seed rule labelled '${label}'`);
  return rule;
}
