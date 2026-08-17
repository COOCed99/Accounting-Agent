# Test fixtures

`transactions.sample.json` is a **stand-in**, and the build spec is explicit
that it should not stay one:

> Steps 4 through 6 need real test fixtures. Export 90 days of transactions to
> JSON after step 3 and use that as the fixture set. Do not write tests against
> invented data.

That export could not be produced during the initial build — it requires a live
Plaid Item, and no credentials or linked account existed yet. The engine still
needed tests before the UI, so this file was assembled from the **actual
statement descriptors embedded in the seed rules** (`PENNYMAC CASH`,
`ACHIEVE(CFTPAY)`, `PECHANGA`, `NON-WF ATM`, and so on). The descriptor strings
are real; the dates and the amounts on flex rows are not.

That distinction matters for what these tests can prove. They pin down the
engine's arithmetic and rule ordering. They do **not** prove the patterns match
this account's real descriptor formatting — only real data can do that.

## Replacing it with the real export

After the first successful sync:

```sh
npm run export:fixtures
```

That writes `transactions.real.json` (gitignored — it is real account data) and
prints a coverage report of which rules matched. Then:

```sh
RUNWAY_FIXTURES=real npm test
```

The test suite reads `transactions.real.json` when `RUNWAY_FIXTURES=real` and
falls back to the sample otherwise, so the same assertions run against both.
Any seed pattern that matches zero real transactions is a pattern that needs
fixing, and the export script flags them.
