// Export 90 days of real transactions as the test fixture set, per spec
// section 10: "Do not write tests against invented data."
//
// Run once the first sync has completed:
//   npm run export:fixtures
//   RUNWAY_FIXTURES=real npm test
//
// The output is gitignored — it is real account data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { getRules } from './queries.js';
import { classifyAll } from '../engine/classify.js';
import { addDays, today } from '../engine/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'engine', '__fixtures__', 'transactions.real.json');

const from = addDays(today(), -90);

const rows = db
  .prepare(`
    SELECT id, account_id, pending_transaction_id, is_pending, date, authorized_date,
           name, merchant_name, amount, plaid_category
    FROM transactions
    WHERE date >= ? AND removed = 0
    ORDER BY date, id
  `)
  .all(from);

if (rows.length === 0) {
  console.error(`No transactions since ${from}. Run a sync first: curl -XPOST localhost:3001/api/refresh`);
  process.exit(1);
}

fs.writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`wrote ${rows.length} transactions since ${from} to ${path.relative(process.cwd(), OUT)}`);

// Coverage. A seed pattern that matches nothing across 90 days of real
// statements is a pattern that needs fixing, not a rule that never fired.
const rules = getRules({ activeOnly: true });
const matched = new Set(classifyAll(rows, rules).map((c) => c.rule_id).filter(Boolean));
const unmatched = rules.filter((r) => !matched.has(r.id));

console.log(`\nrules matched: ${matched.size}/${rules.length}`);
if (unmatched.length) {
  console.log('\nno real transaction matched these patterns — verify the descriptors:');
  for (const rule of unmatched) console.log(`  ${rule.label.padEnd(20)} /${rule.pattern}/i`);
}

const unclassified = classifyAll(rows, rules).filter((c) => c.rule_id === null).length;
console.log(`\ntransactions matching no rule: ${unclassified}/${rows.length} (these fall back to the Plaid category)`);
