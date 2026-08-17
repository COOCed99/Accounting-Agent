-- Runway v2 schema.
--
-- SIGN CONVENTION: every `amount` column in this database is stored in Plaid's
-- convention — POSITIVE = outflow (money leaving the account), NEGATIVE =
-- inflow. This is asserted at the sync boundary (server/plaid/sync.js) and at
-- the manual-event boundary (server/routes/manual-events.js). Nothing
-- downstream re-interprets the sign.
--
-- `rules.expected_amount` is the one exception: it is a MAGNITUDE, always
-- positive, whose direction comes from `rules.kind` ('income' = inflow,
-- everything else = outflow). See server/engine/project.js:signedAmount.

CREATE TABLE IF NOT EXISTS rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,       -- 'Pennymac'
  pattern         TEXT NOT NULL,       -- regex, case insensitive
  category        TEXT NOT NULL,       -- see taxonomy in spec section 3
  kind            TEXT NOT NULL,       -- fixed | flex | income | transfer
  expected_amount REAL,                -- null for flex
  tolerance       REAL DEFAULT 0.02,   -- fraction, 0.02 = 2%
  cadence         TEXT,                -- monthly | biweekly | weekly | semimonthly | none
  anchor_day      INTEGER,             -- day of month, or day of week for weekly
  active          INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,      -- plaid account_id
  item_id         TEXT NOT NULL,
  access_token    TEXT NOT NULL,
  name            TEXT NOT NULL,         -- 'Everyday Checking 5475'
  mask            TEXT,
  type            TEXT,                  -- depository
  subtype         TEXT,                  -- checking, savings
  is_primary      INTEGER DEFAULT 0,
  current_balance REAL,
  available_balance REAL,
  balance_as_of   TEXT,
  cursor          TEXT                   -- plaid sync cursor
);

CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY,   -- plaid transaction_id
  account_id             TEXT NOT NULL REFERENCES accounts(id),
  pending_transaction_id TEXT,               -- links pending to settled
  is_pending             INTEGER NOT NULL,
  date                   TEXT NOT NULL,      -- YYYY-MM-DD
  authorized_date        TEXT,
  name                   TEXT NOT NULL,
  merchant_name          TEXT,
  amount                 REAL NOT NULL,      -- Plaid: positive = outflow
  plaid_category         TEXT,
  rule_id                INTEGER REFERENCES rules(id),
  category_override      TEXT,               -- user set, wins over rule
  is_transfer            INTEGER DEFAULT 0,  -- internal, excluded from spend
  removed                INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_pending ON transactions(pending_transaction_id);

CREATE TABLE IF NOT EXISTS budgets (
  category    TEXT PRIMARY KEY,
  monthly_cap REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  date     TEXT NOT NULL,
  label    TEXT NOT NULL,
  amount   REAL NOT NULL,      -- positive = outflow, matches Plaid convention
  kind     TEXT NOT NULL,      -- fixed | income
  confirmed INTEGER DEFAULT 0  -- 0 = expected, 1 = contracted
);

CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at     TEXT NOT NULL,
  trigger    TEXT NOT NULL,    -- cron | manual
  added      INTEGER,
  modified   INTEGER,
  removed    INTEGER,
  error      TEXT
);
