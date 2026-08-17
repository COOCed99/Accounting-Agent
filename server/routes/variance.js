import { Router } from 'express';
import { getBudgets, getTransactions } from '../db/queries.js';
import { startOfMonth, today } from '../engine/dates.js';
import { variance as computeVariance } from '../engine/variance.js';

export const variance = Router();

variance.get('/variance', (req, res) => {
  const asOf = req.query.asOf ?? today();
  const rows = computeVariance(
    getTransactions({ from: startOfMonth(asOf), to: asOf }),
    getBudgets(),
    asOf
  );

  res.json({
    asOf,
    rows,
    totals: {
      monthlyCap: round(rows.reduce((s, r) => s + r.monthlyCap, 0)),
      actualMTD: round(rows.reduce((s, r) => s + r.actualMTD, 0)),
      projectedFullMonth: round(rows.reduce((s, r) => s + r.projectedFullMonth, 0)),
      variance: round(rows.reduce((s, r) => s + r.variance, 0))
    }
  });
});

const round = (n) => Math.round(n * 100) / 100;
