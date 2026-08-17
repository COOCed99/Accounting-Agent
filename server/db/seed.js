// Seed data inserted on first migration only. Patterns and amounts are derived
// from actual statement history.
//
// ORDER IS SEMANTIC. Rules are inserted in array order, get ascending ids, and
// are evaluated by ascending id with first-match-wins. `Gaming ATM` must stay
// above `ATM cash` — reverse them and every Pechanga withdrawal disappears into
// generic cash, which is the single most important number on the variance grid.

export const SEED_RULES = [
  // income
  { label: 'PanCAN payroll',   pattern: 'PANCREATIC PAYROLL|BAMBOOHR PAYROLL', category: 'payroll',        kind: 'income',   expected_amount: 5096.61, cadence: 'semimonthly', anchor_day: 15 },
  { label: 'Nuage transfer',   pattern: 'NUAGECONCEPTSCOM PAYMENT',            category: 'consulting',     kind: 'income',   expected_amount: null,    cadence: 'none' },
  { label: 'AIPP transfer',    pattern: 'AI PROJECT PARTN',                    category: 'consulting',     kind: 'income',   expected_amount: null,    cadence: 'none' },
  { label: 'PayPal inbound',   pattern: 'PAYPAL TRANSFER.*DO IT CONSULTING',   category: 'consulting',     kind: 'income',   expected_amount: null,    cadence: 'none' },

  // housing and secured
  { label: 'Pennymac',         pattern: 'PENNYMAC CASH',                       category: 'housing',        kind: 'fixed', expected_amount: 3516.35, tolerance: 0,    cadence: 'monthly', anchor_day: 1 },
  { label: 'Retreat HOA',      pattern: 'RETREAT HOMEOWNERS',                  category: 'housing',        kind: 'fixed', expected_amount: 400.00,  cadence: 'monthly', anchor_day: 4 },
  { label: 'Carmax',           pattern: 'CARMAX AUTO FINANCING',               category: 'auto',           kind: 'fixed', expected_amount: 600.00,  tolerance: 0.35, cadence: 'monthly', anchor_day: 4 },
  { label: 'Mazda Financial',  pattern: 'MAZDA FINANCIAL',                     category: 'auto',           kind: 'fixed', expected_amount: 400.00,  cadence: 'monthly', anchor_day: 16 },
  { label: 'GM Financial',     pattern: 'GM FINANCIAL',                        category: 'auto',           kind: 'fixed', expected_amount: 200.00,  tolerance: 0.5,  cadence: 'monthly', anchor_day: 4 },
  { label: 'Sunnova',          pattern: 'SUNNOVA',                             category: 'utilities',      kind: 'fixed', expected_amount: 100.00,  cadence: 'monthly', anchor_day: 4 },

  // debt service
  { label: 'Achieve',          pattern: 'ACHIEVE\\(CFTPAY\\)',                 category: 'debt_service',   kind: 'fixed', expected_amount: 725.00,  cadence: 'biweekly', anchor_day: 4 },
  { label: 'Chase card',       pattern: 'CHASE CARD SERVICES',                 category: 'debt_service',   kind: 'fixed', expected_amount: 475.00,  cadence: 'monthly', anchor_day: 4 },
  { label: 'Fundbox',          pattern: 'FUNDBOX',                             category: 'debt_service',   kind: 'fixed', expected_amount: 160.15,  cadence: 'weekly',  anchor_day: 2 },
  { label: 'Student loan',     pattern: 'DEPT EDUCATION|NELNET LOAN SERV',     category: 'debt_service',   kind: 'fixed', expected_amount: 410.00,  tolerance: 0.5,  cadence: 'monthly', anchor_day: 18 },
  { label: 'Mohela',           pattern: 'MOHELA',                              category: 'debt_service',   kind: 'fixed', expected_amount: 183.91,  cadence: 'monthly', anchor_day: 14 },
  { label: 'Zales',            pattern: 'ZALES',                               category: 'debt_service',   kind: 'fixed', expected_amount: 228.00,  cadence: 'monthly', anchor_day: 4 },
  { label: 'Amex',             pattern: 'AMERICAN EXPRESS ACH',                category: 'debt_service',   kind: 'fixed', expected_amount: 666.00,  tolerance: 0.9,  cadence: 'monthly', anchor_day: 13 },

  // new notes, first payment 9/1 — amounts UNCONFIRMED, update from agreements
  { label: 'MoneyKey',         pattern: 'MONEYKEY',                            category: 'debt_service',   kind: 'fixed', expected_amount: null, cadence: 'semimonthly', anchor_day: 1 },
  { label: 'Clear Air',        pattern: 'CLEAR AIR',                           category: 'debt_service',   kind: 'fixed', expected_amount: null, cadence: 'semimonthly', anchor_day: 1 },
  { label: 'Bright Lending',   pattern: 'BRIGHT LENDING',                      category: 'debt_service',   kind: 'fixed', expected_amount: null, cadence: 'semimonthly', anchor_day: 1 },
  { label: 'Lending Creative', pattern: 'LENDING CREATIVE',                    category: 'debt_service',   kind: 'fixed', expected_amount: null, cadence: 'semimonthly', anchor_day: 1 },

  // utilities and services
  { label: 'State Farm',       pattern: 'STATE FARM',                          category: 'insurance',      kind: 'fixed', expected_amount: 476.03, tolerance: 0.1, cadence: 'monthly', anchor_day: 4 },
  { label: 'SoCal Edison',     pattern: 'SO CAL EDISON',                       category: 'utilities',      kind: 'fixed', expected_amount: 120.00, tolerance: 0.8, cadence: 'monthly', anchor_day: 8 },
  { label: 'SoCal Gas',        pattern: 'SOUTHERN CALIFORNIA GAS',             category: 'utilities',      kind: 'fixed', expected_amount: 40.35,  tolerance: 0.5, cadence: 'monthly', anchor_day: 4 },
  { label: 'Spectrum',         pattern: 'SPECTRUM SPECTRUM',                   category: 'utilities',      kind: 'fixed', expected_amount: 175.80, cadence: 'monthly', anchor_day: 20 },
  { label: 'Spectrum Mobile',  pattern: 'SPECTRUM MOBILE',                     category: 'utilities',      kind: 'fixed', expected_amount: 105.70, cadence: 'monthly', anchor_day: 27 },

  // savings
  { label: 'Way2Save',         pattern: 'WAY2SAVE',                            category: 'savings',        kind: 'transfer', expected_amount: 500.00, cadence: 'semimonthly', anchor_day: 1 },

  // flex — the lines that decide the month
  { label: 'Apple Card',       pattern: 'APPLECARD GSBANK',                    category: 'card_payments',  kind: 'flex' },
  { label: 'Gaming ATM',       pattern: 'PECHANGA|SAN MANUEL|LAS VEGAS BLVD|CASMIX|CAPRAX|NVNYKX|NVMCOX', category: 'gaming_atm', kind: 'flex' },
  { label: 'ATM cash',         pattern: 'ATM WITHDRAWAL|NON-WF ATM',           category: 'cash_atm',       kind: 'flex' },
  { label: 'Cash App',         pattern: 'CASH APP',                            category: 'p2p_transfers',  kind: 'flex' },
  { label: 'Zelle out',        pattern: 'ZELLE TO',                            category: 'p2p_transfers',  kind: 'flex' },
  { label: 'Golf',             pattern: 'GLF\\*|GOLF|TOPGOLF|ROGER DUNN',      category: 'recreation',     kind: 'flex' },
  { label: 'Tolls',            pattern: 'THE TOLL ROADS',                      category: 'other',          kind: 'flex' },

  // internal, must not count as spend
  { label: 'Internal xfer',    pattern: 'ONLINE TRANSFER FROM HOLMES|ONLINE TRANSFER TO HOLMES', category: 'internal_transfer', kind: 'transfer' }
];

export const SEED_BUDGETS = [
  { category: 'card_payments',  monthly_cap: 500 },
  { category: 'gaming_atm',     monthly_cap: 0 },
  { category: 'cash_atm',       monthly_cap: 400 },
  { category: 'p2p_transfers',  monthly_cap: 800 },
  { category: 'dining',         monthly_cap: 400 },
  { category: 'fuel',           monthly_cap: 300 },
  { category: 'retail',         monthly_cap: 300 },
  { category: 'recreation',     monthly_cap: 400 },
  { category: 'other',          monthly_cap: 300 }
];
