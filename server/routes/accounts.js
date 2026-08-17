import { Router } from 'express';
import { db } from '../db/index.js';
import { getAccounts, getLastSync } from '../db/queries.js';
import { createLinkToken, exchangePublicToken } from '../plaid/link.js';
import { isConfigured, plaidErrorMessage } from '../plaid/client.js';

export const accounts = Router();

accounts.get('/accounts', (req, res) => {
  const last = getLastSync();
  res.json({
    accounts: getAccounts(),
    last_sync: last?.ran_at ?? null,
    plaid_configured: isConfigured()
  });
});

accounts.patch('/accounts/:id', (req, res) => {
  const { is_primary: isPrimary } = req.body ?? {};
  if (isPrimary !== true && isPrimary !== 1) {
    return res.status(400).json({ error: 'only is_primary: true is settable' });
  }
  const exists = db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'no such account' });

  db.transaction(() => {
    db.prepare('UPDATE accounts SET is_primary = 0').run();
    db.prepare('UPDATE accounts SET is_primary = 1 WHERE id = ?').run(req.params.id);
  })();

  res.json({ accounts: getAccounts() });
});

// ---- one-time Plaid Link flow ------------------------------------------------

accounts.post('/link/token', async (req, res) => {
  try {
    res.json({ link_token: await createLinkToken() });
  } catch (error) {
    res.status(502).json({ error: plaidErrorMessage(error) });
  }
});

accounts.post('/link/exchange', async (req, res) => {
  const { public_token: publicToken } = req.body ?? {};
  if (!publicToken) return res.status(400).json({ error: 'public_token is required' });
  try {
    res.json(await exchangePublicToken(publicToken));
  } catch (error) {
    res.status(502).json({ error: plaidErrorMessage(error) });
  }
});
