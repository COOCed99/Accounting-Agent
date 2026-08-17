import { Router } from 'express';
import {
  getBudgets,
  getManualEvents,
  getPrimaryAccount,
  getRulesForProjection,
  getTransactions
} from '../db/queries.js';
import { addDays, today } from '../engine/dates.js';
import { isFlexSpend } from '../engine/classify.js';
import { budgetFlexPerDay, demonstratedFlexPerDay, project } from '../engine/project.js';

export const projection = Router();

/**
 * Both curves, from one walk of the rules.
 *
 * `days=30` means 30 days AHEAD, so the response holds 31 entries: index 0 is
 * today reported as known, then 30 projected days.
 */
projection.get('/projection', (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days ?? '30', 10) || 30, 1), 365);

  const account = getPrimaryAccount();
  if (!account) {
    return res.status(409).json({ error: 'no linked account; run the Plaid Link flow first' });
  }

  const startDate = today();
  const endDate = addDays(startDate, days);

  // Available balance, not current — it already nets pending, which is why the
  // projection must never also subtract pending transactions.
  const startBalance = account.available_balance ?? account.current_balance ?? 0;

  const rules = getRulesForProjection();
  const manualEvents = getManualEvents({ from: startDate, to: endDate });
  const budgets = getBudgets();

  const trailing = getTransactions({ from: addDays(startDate, -30), to: startDate })
    .filter((t) => isFlexSpend(t, t.category));

  const budgeted = budgetFlexPerDay(budgets, startDate);
  const demonstrated = demonstratedFlexPerDay(trailing, startDate);

  const shared = { startBalance, startDate, endDate, rules, manualEvents };

  res.json({
    startDate,
    endDate,
    startBalance,
    balanceAsOf: account.balance_as_of,
    account: { id: account.id, name: account.name, mask: account.mask },
    flexPerDay: { budgeted, demonstrated },
    budgeted: project({ ...shared, flexPerDay: budgeted }),
    demonstrated: project({ ...shared, flexPerDay: demonstrated })
  });
});
