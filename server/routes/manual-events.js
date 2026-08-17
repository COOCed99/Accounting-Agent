import { Router } from 'express';
import { db } from '../db/index.js';
import { getManualEvents } from '../db/queries.js';
import { assertISODate } from '../engine/dates.js';

export const manualEvents = Router();

manualEvents.get('/manual-events', (req, res) => {
  res.json({ manual_events: getManualEvents(req.query) });
});

manualEvents.post('/manual-events', (req, res) => {
  const { date, label, amount, kind, confirmed } = req.body ?? {};

  try {
    assertISODate(date, 'date');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  if (!Number.isFinite(Number(amount))) return res.status(400).json({ error: 'amount must be a number' });
  if (kind !== 'fixed' && kind !== 'income') return res.status(400).json({ error: "kind must be 'fixed' or 'income'" });

  // Normalize onto the Plaid convention at the boundary: positive = outflow,
  // direction taken from kind so an income event entered as +900 is still an
  // inflow rather than a $900 charge.
  const normalized = kind === 'income' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));

  const info = db
    .prepare('INSERT INTO manual_events (date, label, amount, kind, confirmed) VALUES (?, ?, ?, ?, ?)')
    .run(date, String(label).trim(), normalized, kind, confirmed ? 1 : 0);

  res.status(201).json({
    manual_event: db.prepare('SELECT * FROM manual_events WHERE id = ?').get(info.lastInsertRowid)
  });
});

manualEvents.delete('/manual-events/:id', (req, res) => {
  const info = db.prepare('DELETE FROM manual_events WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'no such manual event' });
  res.status(204).end();
});
