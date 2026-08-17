// Loads the sample fixtures into the database so the dashboard can be driven
// end to end before Plaid is connected.
//
// DEVELOPMENT ONLY. It writes a fake account with a placeholder access token
// and transactions whose dates and flex amounts are invented. Run
// `npm run seed:demo -- --reset` to clear it out again before linking a real
// bank, or just delete data/runway.db.

import { db } from './index.js';
import { migrate } from './migrate.js';
import { loadTransactions } from '../engine/__fixtures__/load.js';
import { classifyUnmatched } from '../plaid/sync.js';

const DEMO_ACCOUNT = 'acc_chk';
const DEMO_ITEM = 'item_demo';

function reset() {
  db.transaction(() => {
    db.prepare('DELETE FROM transactions WHERE account_id = ?').run(DEMO_ACCOUNT);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(DEMO_ACCOUNT);
    db.prepare("DELETE FROM sync_log WHERE trigger = 'demo'").run();
  })();
  console.log('demo data removed');
}

function seed() {
  migrate();
  const { transactions, source } = loadTransactions();

  db.prepare(`
    INSERT INTO accounts (id, item_id, access_token, name, mask, type, subtype, is_primary, current_balance, available_balance, balance_as_of, cursor)
    VALUES (?, ?, 'DEMO-NOT-A-REAL-TOKEN', 'Everyday Checking 5475', '5475', 'depository', 'checking', 1, 8412.77, 8009.87, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET current_balance = excluded.current_balance, available_balance = excluded.available_balance, balance_as_of = excluded.balance_as_of
  `).run(DEMO_ACCOUNT, DEMO_ITEM, new Date().toISOString());

  const insert = db.prepare(`
    INSERT INTO transactions (id, account_id, pending_transaction_id, is_pending, date, authorized_date, name, merchant_name, amount, plaid_category, removed)
    VALUES (@id, @account_id, NULL, @is_pending, @date, NULL, @name, @merchant_name, @amount, @plaid_category, 0)
    ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, date = excluded.date
  `);

  db.transaction((rows) => {
    for (const row of rows) {
      insert.run({
        id: row.id,
        account_id: DEMO_ACCOUNT,
        is_pending: row.is_pending ?? 0,
        date: row.date,
        name: row.name,
        merchant_name: row.merchant_name ?? null,
        amount: row.amount,
        plaid_category: row.plaid_category ?? null
      });
    }
  })(transactions);

  const classified = classifyUnmatched();
  db.prepare('INSERT INTO sync_log (ran_at, trigger, added, modified, removed, error) VALUES (?, ?, ?, 0, 0, NULL)')
    .run(new Date().toISOString(), 'demo', transactions.length);

  console.log(`seeded ${transactions.length} ${source} transactions and 1 demo account`);
  console.log(`classified ${classified} of them against the seed rules`);
  console.log('\nthis is NOT real data — run `npm run seed:demo -- --reset` before linking a bank');
}

if (process.argv.includes('--reset')) reset();
else seed();
