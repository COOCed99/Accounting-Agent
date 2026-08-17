import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DB_PATH } from './index.js';
import { SEED_RULES, SEED_BUDGETS } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);

  const seeded = { rules: 0, budgets: 0 };

  // Seed only when empty. Rules are user-editable after first run and a
  // re-migration must never stomp edits or duplicate the rule set.
  const ruleCount = db.prepare('SELECT COUNT(*) AS n FROM rules').get().n;
  if (ruleCount === 0) {
    const insert = db.prepare(`
      INSERT INTO rules (label, pattern, category, kind, expected_amount, tolerance, cadence, anchor_day, active)
      VALUES (@label, @pattern, @category, @kind, @expected_amount, @tolerance, @cadence, @anchor_day, 1)
    `);
    // One transaction, so rule ids stay contiguous and in array order.
    // Evaluation order is `ORDER BY id` — see engine/classify.js.
    db.transaction((rules) => {
      for (const r of rules) {
        insert.run({
          label: r.label,
          pattern: r.pattern,
          category: r.category,
          kind: r.kind,
          expected_amount: r.expected_amount ?? null,
          // `tolerance: 0` is meaningful (Pennymac is exact), so check for
          // undefined rather than falling back on falsiness.
          tolerance: r.tolerance === undefined ? 0.02 : r.tolerance,
          cadence: r.cadence ?? null,
          anchor_day: r.anchor_day ?? null
        });
      }
    })(SEED_RULES);
    seeded.rules = SEED_RULES.length;
  }

  const budgetCount = db.prepare('SELECT COUNT(*) AS n FROM budgets').get().n;
  if (budgetCount === 0) {
    const insert = db.prepare('INSERT INTO budgets (category, monthly_cap) VALUES (?, ?)');
    db.transaction((budgets) => {
      for (const b of budgets) insert.run(b.category, b.monthly_cap);
    })(SEED_BUDGETS);
    seeded.budgets = SEED_BUDGETS.length;
  }

  return seeded;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeded = migrate();
  console.log(`migrated ${DB_PATH}`);
  console.log(`  rules seeded:   ${seeded.rules || 'already present, left alone'}`);
  console.log(`  budgets seeded: ${seeded.budgets || 'already present, left alone'}`);
}
