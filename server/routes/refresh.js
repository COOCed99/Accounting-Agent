import { Router } from 'express';
import { getSyncLog } from '../db/queries.js';
import { sync } from '../plaid/sync.js';

export const refresh = Router();

// Serialized: two overlapping syncs against the same cursor would replay pages.
let inFlight = null;

refresh.post('/refresh', async (req, res) => {
  if (inFlight) {
    const result = await inFlight;
    return res.json({ ...result, coalesced: true });
  }

  inFlight = sync('manual');
  try {
    const result = await inFlight;
    res.status(result.error ? 502 : 200).json(result);
  } finally {
    inFlight = null;
  }
});

refresh.get('/sync-log', (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '20', 10) || 20, 1), 200);
  res.json({ sync_log: getSyncLog(limit) });
});
