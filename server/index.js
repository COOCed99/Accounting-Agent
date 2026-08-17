import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cron from 'node-cron';
import 'dotenv/config';

import { migrate } from './db/migrate.js';
import { isConfigured } from './plaid/client.js';
import { sync } from './plaid/sync.js';

import { accounts } from './routes/accounts.js';
import { manualEvents } from './routes/manual-events.js';
import { projection } from './routes/projection.js';
import { refresh } from './routes/refresh.js';
import { rules } from './routes/rules.js';
import { transactions } from './routes/transactions.js';
import { variance } from './routes/variance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

migrate();

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, plaid_configured: isConfigured() });
});

app.use('/api', accounts);
app.use('/api', transactions);
app.use('/api', projection);
app.use('/api', variance);
app.use('/api', rules);
app.use('/api', refresh);
app.use('/api', manualEvents);

// Serve the built dashboard when it exists, so `npm run build && npm start`
// is a single process. In development Vite serves the client and proxies /api.
const dist = path.join(here, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: `no route for ${req.method} ${req.path}` }));

app.use((error, req, res, next) => {
  console.error('[api]', error);
  res.status(500).json({ error: error.message ?? 'internal error' });
});

app.listen(PORT, () => {
  console.log(`runway listening on http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.warn('[plaid] PLAID_CLIENT_ID / PLAID_SECRET are unset — sync and Link are disabled.');
  }
});

// Daily backstop. The manual refresh button is the primary path; this just
// guarantees the data is never more than a day stale. No webhooks — they need
// a public URL and solve a scale problem that does not exist here.
cron.schedule('0 6 * * *', async () => {
  if (!isConfigured()) return;
  const result = await sync('cron');
  console.log(`[cron] sync: +${result.added} ~${result.modified} -${result.removed}${result.error ? ` error: ${result.error}` : ''}`);
});
