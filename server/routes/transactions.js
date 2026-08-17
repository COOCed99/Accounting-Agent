import { Router } from 'express';
import { db } from '../db/index.js';
import { getTransactions } from '../db/queries.js';
import { ALL_CATEGORIES } from '../engine/taxonomy.js';

export const transactions = Router();

transactions.get('/transactions', (req, res) => {
  const { from, to, includeRemoved } = req.query;
  res.json({
    transactions: getTransactions({
      from,
      to,
      includeRemoved: includeRemoved === 'true'
    })
  });
});

transactions.patch('/transactions/:id', (req, res) => {
  const { category_override: override } = req.body ?? {};

  // null clears the override and hands the row back to its rule.
  if (override !== null && !ALL_CATEGORIES.includes(override)) {
    return res.status(400).json({
      error: `category_override must be null or one of: ${ALL_CATEGORIES.join(', ')}`
    });
  }

  const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'no such transaction' });

  db.prepare('UPDATE transactions SET category_override = ? WHERE id = ?').run(override, req.params.id);

  const [updated] = getTransactions({ includeRemoved: true }).filter((t) => t.id === req.params.id);
  res.json({ transaction: updated });
});
