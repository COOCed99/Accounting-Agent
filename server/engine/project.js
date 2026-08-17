// Projection engine. Pure functions — no DB access, no I/O.
//
// SIGN CONVENTION, asserted here and nowhere else downstream:
//   event.amount POSITIVE = outflow, NEGATIVE = inflow (Plaid's convention).
//   closing = opening - sum(amounts) - flex
//
// `rule.expected_amount` is a magnitude; its direction comes from `rule.kind`.

import {
  addDays,
  assertISODate,
  clampToMonth,
  dayOfWeek,
  daysInMonth,
  diffDays,
  eachDay,
  eachMonth,
  isBetween
} from './dates.js';
import { INTERNAL_TRANSFER } from './taxonomy.js';

const round = (n) => Math.round(n * 100) / 100;

/**
 * Signed amount in Plaid convention for a scheduled rule occurrence.
 * Income is an inflow; fixed obligations and transfers are outflows.
 */
export function signedAmount(rule) {
  const magnitude = Math.abs(rule.expected_amount);
  return rule.kind === 'income' ? -magnitude : magnitude;
}

/**
 * A rule participates in the balance projection unless it is discretionary
 * (flex, already covered by flexPerDay) or nets to zero across own accounts.
 *
 * A `savings` transfer is NOT excluded here. It leaves checking and it lowers
 * the balance; it is excluded from SPEND math only. Only `internal_transfer`
 * is money moving between accounts we already count.
 */
export function isProjectable(rule) {
  if (rule.active === 0) return false;
  if (rule.kind === 'flex') return false;
  if (rule.category === INTERNAL_TRANSFER) return false;
  if (!rule.cadence || rule.cadence === 'none') return false;
  return true;
}

/**
 * A projectable rule whose amount nobody has entered yet. These are surfaced
 * as `unknownRules` rather than silently dropped — a projection that quietly
 * omits real monthly obligation is worse than no projection at all.
 *
 * Scoped to rules the engine WOULD have expanded. Flex rules and irregular
 * consulting income also carry a null amount, but by design (`null for flex`),
 * so listing them here would bury the four that need action in noise.
 */
export function isUnknown(rule) {
  return isProjectable(rule) && (rule.expected_amount === null || rule.expected_amount === undefined);
}

/**
 * Expand one rule into the dates it fires on within [start, end].
 *
 * monthly      anchor_day of each month; clamped to the last day of short months
 * semimonthly  anchor_day and anchor_day + 15, each clamped
 * biweekly     every 14 days stepped off the most recent ACTUAL occurrence,
 *              never off a day of month — biweekly drifts against the calendar
 *              and a day-of-month anchor is wrong inside two months
 * weekly       anchor_day read as day of week, 0 = Sunday
 *
 * @param {Object} rule
 * @param {string} start - YYYY-MM-DD
 * @param {string} end   - YYYY-MM-DD
 * @param {Array}  warnings - mutated; collects anything the caller should see
 * @returns {string[]} fire dates, ascending
 */
export function expandRule(rule, start, end, warnings = []) {
  const dates = [];

  switch (rule.cadence) {
    case 'monthly': {
      for (const { year, month } of eachMonth(start, end)) {
        const date = clampToMonth(year, month, rule.anchor_day ?? 1);
        if (isBetween(date, start, end)) dates.push(date);
      }
      break;
    }

    case 'semimonthly': {
      const anchor = rule.anchor_day ?? 1;
      for (const { year, month } of eachMonth(start, end)) {
        const last = daysInMonth(year, month);
        // Clamping both halves can collide (e.g. anchor 20 in February gives
        // 20 and 28-clamped-from-35). Dedupe so the payment fires once.
        const days = [...new Set([Math.min(anchor, last), Math.min(anchor + 15, last)])];
        for (const day of days) {
          const date = clampToMonth(year, month, day);
          if (isBetween(date, start, end)) dates.push(date);
        }
      }
      break;
    }

    case 'biweekly': {
      const seed = rule.last_occurrence ?? rule.lastOccurrence ?? null;
      let cursor;
      if (seed) {
        assertISODate(seed, `rule ${rule.label} last_occurrence`);
        // Step forward from the real occurrence in exact 14-day multiples,
        // landing on the first fire strictly after it.
        const gap = diffDays(seed, start);
        const periods = gap > 0 ? Math.ceil(gap / 14) : 0;
        cursor = addDays(seed, periods * 14);
        if (cursor <= seed) cursor = addDays(seed, 14);
      } else {
        // No observed occurrence to anchor to. Seed from the range start so the
        // obligation still appears, and say so loudly — the cadence is right
        // but the phase is a guess until a real payment lands.
        cursor = start;
        warnings.push({
          rule_id: rule.id ?? null,
          label: rule.label,
          code: 'biweekly_unanchored',
          message: `Biweekly rule '${rule.label}' has no observed occurrence to anchor to. Fire dates are phase-guessed from ${start} and will be wrong by up to 13 days until a real payment syncs.`
        });
      }
      for (; cursor <= end; cursor = addDays(cursor, 14)) {
        if (cursor >= start) dates.push(cursor);
      }
      break;
    }

    case 'weekly': {
      const target = ((rule.anchor_day ?? 0) % 7 + 7) % 7;
      for (const date of eachDay(start, end)) {
        if (dayOfWeek(date) === target) dates.push(date);
      }
      break;
    }

    default:
      break;
  }

  return dates.sort();
}

/** Normalize a manual event onto the Plaid sign convention. */
export function signedManualAmount(event) {
  const magnitude = Math.abs(event.amount);
  return event.kind === 'income' ? -magnitude : magnitude;
}

/**
 * @param {Object} input
 * @param {number} input.startBalance    available balance today
 * @param {string} input.startDate       YYYY-MM-DD
 * @param {string} input.endDate         YYYY-MM-DD
 * @param {Array}  input.rules           active rules
 * @param {Array}  input.manualEvents    one off known items
 * @param {number} input.flexPerDay      daily discretionary assumption
 * @param {boolean} [input.includeStartDateEvents=false]
 *        Off by default. `startBalance` is the bank's available balance as of
 *        today, so anything that already posted today is baked into it, and
 *        charging a full day of flex to a day that is mostly over overstates
 *        the burn. Day 0 therefore reports today as known: no events, no flex.
 * @returns {Object}
 *   days:        [{ date, opening, events[], flex, closing }]
 *   lowPoint:    { date, balance }
 *   breaches:    [{ date, balance }]        days closing below zero
 *   endBalance:  number
 *   unknownRules: [{ id, label, category, cadence }]
 *   warnings:    [{ code, message, ... }]
 */
export function project(input) {
  const {
    startBalance,
    startDate,
    endDate,
    rules = [],
    manualEvents = [],
    flexPerDay = 0,
    includeStartDateEvents = false
  } = input ?? {};

  if (typeof startBalance !== 'number' || !Number.isFinite(startBalance)) {
    throw new TypeError(`startBalance must be a finite number, got ${JSON.stringify(startBalance)}`);
  }
  assertISODate(startDate, 'startDate');
  assertISODate(endDate, 'endDate');
  if (endDate < startDate) {
    throw new RangeError(`endDate ${endDate} precedes startDate ${startDate}`);
  }
  if (typeof flexPerDay !== 'number' || !Number.isFinite(flexPerDay) || flexPerDay < 0) {
    throw new TypeError(`flexPerDay must be a non-negative finite number, got ${JSON.stringify(flexPerDay)}`);
  }

  const warnings = [];
  const unknownRules = [];
  const byDate = new Map();

  const push = (date, event) => {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(event);
  };

  for (const rule of rules) {
    if (isUnknown(rule)) {
      unknownRules.push({
        id: rule.id ?? null,
        label: rule.label,
        category: rule.category,
        kind: rule.kind,
        cadence: rule.cadence,
        anchor_day: rule.anchor_day ?? null
      });
      continue;
    }
    if (!isProjectable(rule)) continue;
    if (rule.expected_amount === null || rule.expected_amount === undefined) continue;

    const amount = signedAmount(rule);
    for (const date of expandRule(rule, startDate, endDate, warnings)) {
      push(date, {
        source: 'rule',
        rule_id: rule.id ?? null,
        label: rule.label,
        category: rule.category,
        kind: rule.kind,
        amount: round(amount)
      });
    }
  }

  for (const event of manualEvents) {
    if (!isBetween(event.date, startDate, endDate)) continue;
    push(event.date, {
      source: 'manual',
      manual_event_id: event.id ?? null,
      label: event.label,
      category: null,
      kind: event.kind,
      confirmed: event.confirmed === 1 || event.confirmed === true,
      amount: round(signedManualAmount(event))
    });
  }

  const days = [];
  let balance = startBalance;

  for (const date of eachDay(startDate, endDate)) {
    const isStart = date === startDate;
    const live = !isStart || includeStartDateEvents;

    const events = live ? (byDate.get(date) ?? []) : [];
    const flex = live ? round(flexPerDay) : 0;
    const opening = round(balance);

    const outflow = events.reduce((sum, event) => sum + event.amount, 0);
    balance = round(opening - outflow - flex);

    days.push({ date, opening, events, flex, closing: balance });
  }

  let lowPoint = { date: days[0].date, balance: days[0].closing };
  for (const day of days) {
    if (day.closing < lowPoint.balance) lowPoint = { date: day.date, balance: day.closing };
  }

  const breaches = days
    .filter((day) => day.closing < 0)
    .map((day) => ({ date: day.date, balance: day.closing }));

  return {
    days,
    lowPoint,
    breaches,
    endBalance: days[days.length - 1].closing,
    unknownRules,
    warnings
  };
}

/**
 * Budgeted discretionary burn: the whole flex cap spread evenly over the month
 * the projection starts in.
 */
export function budgetFlexPerDay(budgets, asOfDate) {
  const total = budgets.reduce((sum, b) => sum + b.monthly_cap, 0);
  const [year, month] = asOfDate.split('-').map(Number);
  return round(total / daysInMonth(year, month));
}

/**
 * Observed discretionary burn over a trailing window. This is the curve that
 * disagrees with the budget one, and the gap between them is the product.
 *
 * @param {Array} flexTransactions - already filtered to flex spend
 * @param {string} asOfDate
 * @param {number} [windowDays=30]
 */
export function demonstratedFlexPerDay(flexTransactions, asOfDate, windowDays = 30) {
  const from = addDays(asOfDate, -windowDays);
  const total = flexTransactions
    .filter((t) => t.date > from && t.date <= asOfDate)
    .reduce((sum, t) => sum + t.amount, 0);
  return round(Math.max(total, 0) / windowDays);
}
