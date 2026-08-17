// Category taxonomy. Pure constants, no I/O.
//
// `gaming_atm` is deliberately separate from `cash_atm`. Do not merge them.
// The variance grid only works if the categories driving the shortfall are
// individually visible.

export const FIXED_CATEGORIES = [
  'housing',
  'auto',
  'debt_service',
  'insurance',
  'utilities',
  'subscriptions',
  'savings'
];

export const FLEX_CATEGORIES = [
  'card_payments',
  'cash_atm',
  'gaming_atm',
  'p2p_transfers',
  'dining',
  'fuel',
  'retail',
  'recreation',
  'other'
];

export const INCOME_CATEGORIES = ['payroll', 'consulting', 'loan_proceeds'];

/** Excluded from all spend math, and from balance projection — it nets to zero. */
export const INTERNAL_TRANSFER = 'internal_transfer';

export const ALL_CATEGORIES = [
  ...FIXED_CATEGORIES,
  ...FLEX_CATEGORIES,
  ...INCOME_CATEGORIES,
  INTERNAL_TRANSFER
];

export const KINDS = ['fixed', 'flex', 'income', 'transfer'];

export const CADENCES = ['monthly', 'biweekly', 'weekly', 'semimonthly', 'none'];

export const isFlex = (category) => FLEX_CATEGORIES.includes(category);
export const isIncome = (category) => INCOME_CATEGORIES.includes(category);
export const isInternalTransfer = (category) => category === INTERNAL_TRANSFER;
