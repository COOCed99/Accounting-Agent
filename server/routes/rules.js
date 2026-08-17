import { Router } from 'express';
import { db } from '../db/index.js';
import { getRules } from '../db/queries.js';
import { isValidPattern } from '../engine/classify.js';
import { isUnknown } from '../engine/project.js';
import { ALL_CATEGORIES, CADENCES, KINDS } from '../engine/taxonomy.js';
import { classifyUnmatched } from '../plaid/sync.js';

export const rules = Router();

function validate(body, { partial = false } = {}) {
  const errors = [];
  const has = (field) => body[field] !== undefined;
  const required = (field) => !partial && !has(field);

  if (required('label') || (has('label') && !String(body.label).trim())) {
    errors.push('label is required');
  }
  if (required('pattern')) errors.push('pattern is required');
  if (has('pattern') && !isValidPattern(body.pattern)) errors.push('pattern is not a valid regex');

  if (required('category')) errors.push('category is required');
  if (has('category') && !ALL_CATEGORIES.includes(body.category)) {
    errors.push(`category must be one of: ${ALL_CATEGORIES.join(', ')}`);
  }

  if (required('kind')) errors.push('kind is required');
  if (has('kind') && !KINDS.includes(body.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`);

  if (has('cadence') && body.cadence !== null && !CADENCES.includes(body.cadence)) {
    errors.push(`cadence must be null or one of: ${CADENCES.join(', ')}`);
  }
  if (has('expected_amount') && body.expected_amount !== null) {
    const amount = Number(body.expected_amount);
    if (!Number.isFinite(amount)) errors.push('expected_amount must be a number or null');
    // A magnitude — direction comes from `kind`. Reject a negative so nobody
    // encodes an income rule as a negative fixed one and gets a silent flip.
    else if (amount < 0) errors.push('expected_amount is a magnitude; use kind: "income" for inflows');
  }
  if (has('tolerance') && body.tolerance !== null) {
    const tolerance = Number(body.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) errors.push('tolerance must be a non-negative number');
  }
  if (has('anchor_day') && body.anchor_day !== null) {
    const day = Number(body.anchor_day);
    if (!Number.isInteger(day) || day < 0 || day > 31) errors.push('anchor_day must be 0-31');
  }
  return errors;
}

rules.get('/rules', (req, res) => {
  const all = getRules();
  res.json({
    rules: all,
    // The dashboard's "unknown obligations" region. Scoped to rules the
    // projection would have expanded — flex rules carry a null amount by
    // design and are not missing information.
    unknown: all.filter((rule) => rule.active === 1 && isUnknown(rule))
  });
});

rules.post('/rules', (req, res) => {
  const body = req.body ?? {};
  const errors = validate(body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const info = db
    .prepare(`
      INSERT INTO rules (label, pattern, category, kind, expected_amount, tolerance, cadence, anchor_day, active)
      VALUES (@label, @pattern, @category, @kind, @expected_amount, @tolerance, @cadence, @anchor_day, @active)
    `)
    .run({
      label: String(body.label).trim(),
      pattern: body.pattern,
      category: body.category,
      kind: body.kind,
      expected_amount: body.expected_amount ?? null,
      tolerance: body.tolerance === undefined ? 0.02 : body.tolerance,
      cadence: body.cadence ?? null,
      anchor_day: body.anchor_day ?? null,
      active: body.active === 0 || body.active === false ? 0 : 1
    });

  // A new rule appended to the end is evaluated last, so it can only claim
  // transactions no existing rule wanted. Re-run the unmatched backlog.
  const classified = classifyUnmatched();

  res.status(201).json({
    rule: db.prepare('SELECT * FROM rules WHERE id = ?').get(info.lastInsertRowid),
    reclassified: classified
  });
});

rules.patch('/rules/:id', (req, res) => {
  const body = req.body ?? {};
  const existing = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'no such rule' });

  const errors = validate(body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const fields = ['label', 'pattern', 'category', 'kind', 'expected_amount', 'tolerance', 'cadence', 'anchor_day', 'active'];
  const updates = fields.filter((field) => body[field] !== undefined);
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  db.prepare(`UPDATE rules SET ${updates.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`)
    .run({ ...Object.fromEntries(updates.map((f) => [f, body[f]])), id: existing.id });

  res.json({ rule: db.prepare('SELECT * FROM rules WHERE id = ?').get(existing.id) });
});
