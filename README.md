# Runway v2

Personal cash flow projection. Local only, single user, Plaid connected.

The product is one number and one gap: how long the balance lasts, and the
distance between spending at budget and spending at the demonstrated rate.

## Running it

```sh
npm install
npm install --prefix client
cp .env.example .env      # fill in PLAID_CLIENT_ID and PLAID_SECRET
npm run migrate
npm run dev               # server on :3001, client on :5173
```

For production-ish use on one machine, `npm run build && npm start` serves the
built dashboard from the same process on :3001.

### Seeing it before connecting a bank

```sh
npm run seed:demo         # loads the sample fixtures
npm start
```

Run `npm run seed:demo -- --reset` before linking a real bank.

### Linking a bank

One time, then never again — the access token is stored in SQLite and reused.

1. `POST /api/link/token` returns a Link token.
2. Open Plaid Link in a browser with that token, pick the bank, finish the flow.
3. `POST /api/link/exchange` with the `public_token` Link hands back.
4. `POST /api/refresh` to pull transactions.

### Tests

```sh
npm test
```

89 tests over the three pure engine modules. They need no database, no network
and no credentials.

## How it is put together

```
server/
  db/          schema, migration, seed data, shared reads
  plaid/       client, one-time link exchange, /transactions/sync
  engine/      classify, project, variance — pure, no I/O, tested
  routes/      thin HTTP over the engine
client/src/    the four dashboard regions
```

The engine takes state and returns state. Everything that could be a
correctness bug lives there or in `plaid/sync.js`, and both are covered by
tests or by comments explaining why the ordering is what it is.

## The decisions worth knowing about

**Sign convention.** Plaid's, everywhere: positive is an outflow. It is
asserted where Plaid data enters (`plaid/sync.js`) and where manual events
enter (`routes/manual-events.js`), and never re-derived after that.
`rules.expected_amount` is the one exception — a magnitude whose direction
comes from `rules.kind`, so an income rule cannot be encoded as a negative
fixed one.

**Pending transactions.** When a settled transaction arrives carrying
`pending_transaction_id`, it inherits the pending row's rule and override and
the pending row is deleted. Pending and settled are therefore never summed
together, and the variance grid can safely include pending rows — which it
does, so the grid does not lag the card by two days.

**The cursor is written last.** Every page of `/transactions/sync` is
accumulated in memory before anything is written; the writes and the cursor
advance then share one SQLite transaction. A crash mid-pagination replays from
the old cursor instead of leaving a permanent hole.

The cursor is a per-Item value, but the schema hangs it off each account row,
so accounts are grouped by `item_id` and one cursor is written back to all of
an Item's rows.

**Rule order is semantic.** Rules are evaluated by ascending id, first match
wins. `Gaming ATM` sits above `ATM cash` so that a descriptor like
`NON-WF ATM WITHDRAWAL LAS VEGAS BLVD`, which matches both, lands in
`gaming_atm`. Reverse them and the largest overspend category becomes
invisible. There is a test for exactly this.

**Biweekly is anchored to reality.** It expands 14 days at a time from the most
recent actual occurrence in `transactions`, never from a day of month, because
biweekly drifts against the calendar and a day-of-month anchor is wrong inside
two months. With no observed occurrence to anchor to, it still projects and
attaches a `biweekly_unanchored` warning that the dashboard shows.

**Transfers.** A `savings` sweep lowers the projected balance — the money
really does leave checking — but is excluded from spend. Only
`internal_transfer` is excluded from both, because it nets to zero across
accounts already counted.

**Day 0 is today, as known.** `startBalance` is the bank's available balance
right now, so anything that posted today is already inside it and charging a
full day of flex to a day that is mostly over overstates the burn. A
`days=30` projection returns 31 entries: today, then 30 projected days. Pass
`includeStartDateEvents` to `project()` to opt same-day events back in.

**Available, not current.** The projection starts from `available_balance`,
which already nets pending. That is also why the projection never subtracts
pending transactions itself.

## Two places this deviates from the build spec

**Plaid's Development tier no longer exists.** The spec asks for
`PLAID_ENV=development`; Plaid retired that tier and the v31 SDK does not
define the host. The free allowance the spec was counting on ("free up to 100
Items") now lives on Production. `PLAID_ENV=development` is accepted and mapped
to production with a warning rather than failing on a value taken straight from
the spec. Set `PLAID_ENV=production` to silence it.

**"Unknown obligations" is scoped more narrowly than written.** The spec says
that region lists any rule with `expected_amount IS NULL AND active = 1`. Taken
literally that is ten rules, because flex rules and irregular consulting income
carry a null amount by design — the schema even says `null for flex`. Listing
all ten would bury the four that actually need an agreement entered. The engine
reports a rule as unknown only if it would otherwise have been expanded into
the projection: a non-flex kind, a real cadence, and no amount. That yields
exactly MoneyKey, Clear Air, Bright Lending and Lending Creative.

## Test fixtures are a stand-in

Spec section 10 asks for 90 days of real transactions exported to JSON after
step 3, and says not to write tests against invented data. That export needs a
live Plaid Item, which did not exist when the engine was built. The fixtures
are assembled from the real statement descriptors embedded in the seed rules;
the descriptor strings are real, the dates and flex amounts are not.

So the tests pin down the engine's arithmetic and rule ordering. They do not
prove the patterns match this account's real descriptor formatting.

After the first sync:

```sh
npm run export:fixtures        # writes transactions.real.json, gitignored
RUNWAY_FIXTURES=real npm test  # same assertions, real data
```

`export:fixtures` prints which seed patterns matched nothing across 90 days —
those are patterns that need fixing, not rules that never fired.

## Backups

`data/runway.db` is the entire application state, access tokens included. Copy
it. It is gitignored, as is `.env`.
