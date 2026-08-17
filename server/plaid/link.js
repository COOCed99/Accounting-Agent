// One-time Link token exchange. Run once per bank, then never again — the
// access token lives in the accounts table and is reused forever after.

import { CountryCode, Products } from 'plaid';
import { db } from '../db/index.js';
import { plaid, plaidErrorMessage } from './client.js';

/** Token the browser hands to Plaid Link to open the bank picker. */
export async function createLinkToken() {
  const response = await plaid().linkTokenCreate({
    user: { client_user_id: 'runway-local-user' },
    client_name: 'Runway',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en'
  });
  return response.data.link_token;
}

/**
 * Exchange the public token Link returns for a permanent access token, then
 * store every depository account it unlocks.
 *
 * The access token is a bank credential. It is written to the local SQLite
 * file and nowhere else — never logged, never returned to the client.
 */
export async function exchangePublicToken(publicToken) {
  const client = plaid();

  const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  const accounts = await client.accountsGet({ access_token: accessToken });

  // Only depository accounts. Credit cards and loans carry their own balance
  // semantics and would corrupt a cash-runway projection.
  const depository = accounts.data.accounts.filter((a) => a.type === 'depository');
  if (depository.length === 0) {
    throw new Error('That institution returned no depository accounts; nothing to track.');
  }

  const insert = db.prepare(`
    INSERT INTO accounts (
      id, item_id, access_token, name, mask, type, subtype,
      is_primary, current_balance, available_balance, balance_as_of, cursor
    ) VALUES (
      @id, @item_id, @access_token, @name, @mask, @type, @subtype,
      @is_primary, @current_balance, @available_balance, @balance_as_of, NULL
    )
    ON CONFLICT(id) DO UPDATE SET
      access_token      = excluded.access_token,
      name              = excluded.name,
      current_balance   = excluded.current_balance,
      available_balance = excluded.available_balance,
      balance_as_of     = excluded.balance_as_of
  `);

  const asOf = new Date().toISOString();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;

  db.transaction(() => {
    depository.forEach((account, i) => {
      insert.run({
        id: account.account_id,
        item_id: itemId,
        access_token: accessToken,
        name: account.name,
        mask: account.mask ?? null,
        type: account.type,
        subtype: account.subtype ?? null,
        // The first checking account linked becomes the one the projection
        // starts from. Changeable later via PATCH /api/accounts/:id.
        is_primary: existing === 0 && i === 0 && account.subtype === 'checking' ? 1 : 0,
        current_balance: account.balances.current ?? null,
        available_balance: account.balances.available ?? null,
        balance_as_of: asOf
      });
    });

    // If nothing ended up primary (no checking account), fall back to the first.
    const primary = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE is_primary = 1').get().n;
    if (primary === 0) {
      db.prepare('UPDATE accounts SET is_primary = 1 WHERE id = ?').run(depository[0].account_id);
    }
  })();

  return {
    item_id: itemId,
    accounts: depository.map((a) => ({
      id: a.account_id,
      name: a.name,
      mask: a.mask,
      subtype: a.subtype
    }))
  };
}

export { plaidErrorMessage };
