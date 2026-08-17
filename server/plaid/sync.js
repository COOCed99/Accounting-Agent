// Transaction sync. Everything that can silently corrupt the ledger lives here.

import { db } from '../db/index.js';
import { classifyAll } from '../engine/classify.js';
import { plaid, plaidErrorMessage } from './client.js';

/**
 * Plaid's sign convention, asserted once, at the only place raw Plaid data
 * enters the system: POSITIVE = outflow. Everything downstream trusts this and
 * never re-derives it.
 */
function assertPlaidAmount(transaction) {
  const amount = transaction.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError(`Plaid transaction ${transaction.transaction_id} has a non-numeric amount: ${amount}`);
  }
  return amount;
}

function plaidCategory(transaction) {
  return (
    transaction.personal_finance_category?.detailed ??
    transaction.personal_finance_category?.primary ??
    (Array.isArray(transaction.category) ? transaction.category.join('_').toUpperCase() : null)
  );
}

function toRow(transaction) {
  return {
    id: transaction.transaction_id,
    account_id: transaction.account_id,
    pending_transaction_id: transaction.pending_transaction_id ?? null,
    is_pending: transaction.pending ? 1 : 0,
    date: transaction.date,
    authorized_date: transaction.authorized_date ?? null,
    name: transaction.name ?? '',
    merchant_name: transaction.merchant_name ?? null,
    amount: assertPlaidAmount(transaction),
    plaid_category: plaidCategory(transaction)
  };
}

/**
 * Accounts grouped by Item.
 *
 * The cursor is a per-ITEM value — /transactions/sync is keyed on the access
 * token, not on an account — but the schema hangs `cursor` off each account
 * row. So one cursor is read per Item and written back to every account row
 * belonging to it, keeping them identical. Reading a per-account cursor and
 * syncing each account separately would replay the same pages once per
 * account.
 */
function itemsToSync() {
  const rows = db
    .prepare('SELECT id, item_id, access_token, cursor FROM accounts ORDER BY item_id, id')
    .all();

  const items = new Map();
  for (const row of rows) {
    if (!items.has(row.item_id)) {
      items.set(row.item_id, {
        item_id: row.item_id,
        access_token: row.access_token,
        cursor: row.cursor,
        account_ids: []
      });
    }
    const item = items.get(row.item_id);
    item.account_ids.push(row.id);
    // Any non-null cursor wins; they are kept in lockstep on write.
    if (!item.cursor && row.cursor) item.cursor = row.cursor;
  }
  return [...items.values()];
}

/**
 * Drain /transactions/sync for one Item.
 *
 * Every page is accumulated in memory BEFORE anything is written. The database
 * write and the cursor advance then happen in a single transaction, so a crash
 * mid-pagination replays from the old cursor instead of leaving a permanent
 * hole in the ledger.
 */
async function fetchAll(client, item) {
  const added = [];
  const modified = [];
  const removed = [];

  let cursor = item.cursor ?? undefined;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    const response = await client.transactionsSync({
      access_token: item.access_token,
      cursor,
      count: 500
    });
    const data = response.data;

    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);

    cursor = data.next_cursor;
    hasMore = data.has_more;

    if (++pages > 200) {
      throw new Error(`/transactions/sync did not terminate for item ${item.item_id} after ${pages} pages`);
    }
  }

  return { added, modified, removed, nextCursor: cursor };
}

/**
 * Write one Item's page set and advance its cursor, atomically.
 *
 * Pending reconciliation is the subtle part. When a settled transaction
 * arrives carrying `pending_transaction_id`, the pending row it replaces is
 * still in the table under a different id. Leaving it there double counts the
 * charge — the single most likely cause of the dashboard disagreeing with the
 * bank app. So the settled row inherits the pending row's rule and any manual
 * override, and the pending row is deleted.
 */
const persist = db.transaction((item, batch) => {
  const upsert = db.prepare(`
    INSERT INTO transactions (
      id, account_id, pending_transaction_id, is_pending, date, authorized_date,
      name, merchant_name, amount, plaid_category, removed
    ) VALUES (
      @id, @account_id, @pending_transaction_id, @is_pending, @date, @authorized_date,
      @name, @merchant_name, @amount, @plaid_category, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      account_id             = excluded.account_id,
      pending_transaction_id = excluded.pending_transaction_id,
      is_pending             = excluded.is_pending,
      date                   = excluded.date,
      authorized_date        = excluded.authorized_date,
      name                   = excluded.name,
      merchant_name          = excluded.merchant_name,
      amount                 = excluded.amount,
      plaid_category         = excluded.plaid_category,
      removed                = 0
  `);

  const findPending = db.prepare('SELECT id, rule_id, category_override, is_transfer FROM transactions WHERE id = ?');
  const inherit = db.prepare('UPDATE transactions SET rule_id = ?, category_override = ?, is_transfer = ? WHERE id = ?');
  const dropPending = db.prepare('DELETE FROM transactions WHERE id = ?');
  // Never hard delete a removed transaction — it stays for audit.
  const markRemoved = db.prepare('UPDATE transactions SET removed = 1 WHERE id = ?');

  let reconciled = 0;

  for (const transaction of [...batch.added, ...batch.modified]) {
    const row = toRow(transaction);
    upsert.run(row);

    if (row.pending_transaction_id) {
      const pending = findPending.get(row.pending_transaction_id);
      if (pending) {
        inherit.run(pending.rule_id, pending.category_override, pending.is_transfer, row.id);
        dropPending.run(pending.id);
        reconciled++;
      }
    }
  }

  for (const transaction of batch.removed) {
    markRemoved.run(transaction.transaction_id);
  }

  // Cursor last, inside the same transaction as the writes above.
  const setCursor = db.prepare('UPDATE accounts SET cursor = ? WHERE id = ?');
  for (const id of item.account_ids) setCursor.run(batch.nextCursor, id);

  return reconciled;
});

/** Refresh balances for one Item. */
async function refreshBalances(client, item) {
  const response = await client.accountsBalanceGet({ access_token: item.access_token });
  const asOf = new Date().toISOString();
  const update = db.prepare(`
    UPDATE accounts SET current_balance = ?, available_balance = ?, balance_as_of = ?
    WHERE id = ?
  `);
  db.transaction((accounts) => {
    for (const account of accounts) {
      update.run(
        account.balances.current ?? null,
        account.balances.available ?? null,
        asOf,
        account.account_id
      );
    }
  })(response.data.accounts);
}

/**
 * Classify everything that has not been matched to a rule yet.
 * Idempotent, and safe to call after every sync.
 */
export function classifyUnmatched() {
  const rules = db.prepare('SELECT * FROM rules WHERE active = 1 ORDER BY id').all();
  const pending = db
    .prepare('SELECT id, name, merchant_name, amount, plaid_category, category_override FROM transactions WHERE rule_id IS NULL AND removed = 0')
    .all();
  if (pending.length === 0) return 0;

  const classified = classifyAll(pending, rules);
  const update = db.prepare('UPDATE transactions SET rule_id = ?, is_transfer = ? WHERE id = ?');

  let matched = 0;
  db.transaction((rows) => {
    for (const row of rows) {
      // A transaction that matched nothing keeps rule_id NULL so the next sync
      // — after a new rule is added — reconsiders it.
      if (row.rule_id === null && row.is_transfer === 0) continue;
      update.run(row.rule_id, row.is_transfer, row.id);
      matched++;
    }
  })(classified);

  return matched;
}

/**
 * Full sync across every linked Item.
 * @param {'cron'|'manual'} trigger
 */
export async function sync(trigger = 'manual') {
  const ranAt = new Date().toISOString();
  const totals = { added: 0, modified: 0, removed: 0, reconciled: 0, classified: 0, items: 0 };

  const logRow = db.prepare(
    'INSERT INTO sync_log (ran_at, trigger, added, modified, removed, error) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const items = itemsToSync();
  if (items.length === 0) {
    logRow.run(ranAt, trigger, 0, 0, 0, 'no linked accounts');
    return { ...totals, ran_at: ranAt, trigger, error: 'no linked accounts' };
  }

  try {
    const client = plaid();

    for (const item of items) {
      const batch = await fetchAll(client, item);
      const reconciled = persist(item, batch);
      await refreshBalances(client, item);

      totals.added += batch.added.length;
      totals.modified += batch.modified.length;
      totals.removed += batch.removed.length;
      totals.reconciled += reconciled;
      totals.items++;
    }

    totals.classified = classifyUnmatched();

    logRow.run(ranAt, trigger, totals.added, totals.modified, totals.removed, null);
    return { ...totals, ran_at: ranAt, trigger, error: null };
  } catch (error) {
    const message = plaidErrorMessage(error);
    logRow.run(ranAt, trigger, totals.added, totals.modified, totals.removed, message);
    return { ...totals, ran_at: ranAt, trigger, error: message };
  }
}
