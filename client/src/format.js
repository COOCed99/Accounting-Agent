const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const money = (n) => usdCents.format(n ?? 0);
export const moneyShort = (n) => usd.format(n ?? 0);

export const signed = (n) => `${n > 0 ? '+' : ''}${usdCents.format(n ?? 0)}`;

/** 'YYYY-MM-DD' -> 'Sep 1'. Parsed as UTC to match the server's date math. */
export function shortDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

const ACRONYMS = { atm: 'ATM', p2p: 'P2P', hoa: 'HOA' };

export function categoryLabel(category) {
  return category
    .split('_')
    .map((word) => ACRONYMS[word] ?? word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export function hoursSince(isoTimestamp) {
  if (!isoTimestamp) return Infinity;
  return (Date.now() - new Date(isoTimestamp).getTime()) / 3_600_000;
}

export function relativeTime(isoTimestamp) {
  if (!isoTimestamp) return 'never';
  const hours = hoursSince(isoTimestamp);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 24) return `${Math.round(hours)} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
