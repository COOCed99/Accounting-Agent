// Date helpers. Pure, and deliberately UTC-only.
//
// Every date in this app is a bare 'YYYY-MM-DD' calendar day with no time and
// no zone. Doing the arithmetic with local-time Date objects makes projections
// slip a day across DST boundaries, which shows up as a rent payment landing on
// the wrong side of a payday. All math here goes through Date.UTC.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertISODate(value, label = 'date') {
  if (typeof value !== 'string' || !ISO.test(value)) {
    throw new TypeError(`${label} must be 'YYYY-MM-DD', got ${JSON.stringify(value)}`);
  }
  return value;
}

/** 'YYYY-MM-DD' -> Date at UTC midnight. */
export function toDate(iso) {
  assertISODate(iso);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date -> 'YYYY-MM-DD'. */
export function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export function fromParts(year, month, day) {
  return fmt(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(iso, n) {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return fmt(date);
}

/** Clamps rather than overflowing: Jan 31 + 1 month is Feb 28, not Mar 3. */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12) + (m - 1) + n;
  return clampToMonth(Math.floor(total / 12), (total % 12) + 1, d);
}

/** Whole days from `a` to `b`. Negative when `b` precedes `a`. */
export function diffDays(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysInMonthOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return daysInMonth(y, m);
}

/** 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(iso) {
  return toDate(iso).getUTCDay();
}

export function dayOfMonth(iso) {
  return toDate(iso).getUTCDate();
}

/** A day-of-month clamped to the last day of that month. Feb 31 -> Feb 28/29. */
export function clampToMonth(year, month, day) {
  const last = daysInMonth(year, month);
  return fromParts(year, month, Math.min(Math.max(day, 1), last));
}

export function startOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return fromParts(y, m, 1);
}

export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return fromParts(y, m, daysInMonth(y, m));
}

/** Inclusive list of every calendar day from `start` to `end`. */
export function eachDay(start, end) {
  assertISODate(start, 'start');
  assertISODate(end, 'end');
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Inclusive list of { year, month } pairs spanned by the range. */
export function eachMonth(start, end) {
  const out = [];
  let cursor = startOfMonth(start);
  const last = startOfMonth(end);
  while (cursor <= last) {
    const [year, month] = cursor.split('-').map(Number);
    out.push({ year, month });
    cursor = addMonths(cursor, 1);
  }
  return out;
}

export function isBetween(iso, start, end) {
  return iso >= start && iso <= end;
}

/**
 * Today as 'YYYY-MM-DD', in the machine's LOCAL calendar — deliberately not
 * UTC. This runs on one laptop in Pacific time; a UTC "today" would roll over
 * at 4pm or 5pm local and shift the whole projection window forward a day.
 * The only impure function in this file.
 */
export function today() {
  const now = new Date();
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
