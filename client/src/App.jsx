import { useCallback, useEffect, useState } from 'react';

import { BalanceCurve } from './components/BalanceCurve.jsx';
import { RefreshButton } from './components/RefreshButton.jsx';
import { RuleEditor } from './components/RuleEditor.jsx';
import { VarianceGrid } from './components/VarianceGrid.jsx';
import { hoursSince, money, relativeTime } from './format.js';

const STALE_AFTER_HOURS = 24;

async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `${url} failed`);
  return body;
}

/** Region 1. */
function Header({ accounts, projection, onRefreshed }) {
  const primary = accounts.accounts.find((a) => a.is_primary) ?? accounts.accounts[0];
  const stale = hoursSince(accounts.last_sync) > STALE_AFTER_HOURS;

  return (
    <header className="header">
      <div>
        <div className="balance-label">Available balance</div>
        <div className="balance">{money(projection?.startBalance ?? primary?.available_balance)}</div>
        {primary && (
          <div className="account">
            {primary.name}
            {primary.mask ? ` ····${primary.mask}` : ''}
          </div>
        )}
      </div>

      <div className="spacer" />

      <div>
        <div className="sync-label">Last sync</div>
        <div className={`sync-time ${stale ? 'stale' : ''}`}>{relativeTime(accounts.last_sync)}</div>
      </div>

      <RefreshButton onDone={onRefreshed} />
    </header>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const accounts = await getJSON('/api/accounts');

      // With no linked account there is nothing to project. Say so rather than
      // rendering an empty chart.
      if (accounts.accounts.length === 0) {
        setData({ accounts, projection: null, variance: null, rules: null });
        setError(null);
        return;
      }

      const [projection, variance, rules] = await Promise.all([
        getJSON('/api/projection?days=30'),
        getJSON('/api/variance'),
        getJSON('/api/rules')
      ]);
      setData({ accounts, projection, variance, rules });
      setError(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="app"><div className="notice">Loading…</div></div>;
  if (error) return <div className="app"><div className="notice error">{error}</div></div>;

  const { accounts, projection, variance, rules } = data;

  if (accounts.accounts.length === 0) {
    return (
      <div className="app">
        <div className="notice">
          <strong>No linked account.</strong>
          <p>
            {accounts.plaid_configured
              ? 'Run the Plaid Link flow to connect a bank, then refresh.'
              : 'Set PLAID_CLIENT_ID and PLAID_SECRET in .env, restart the server, then link a bank.'}
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 0 }}>
            To see the dashboard against sample data first: <code>npm run seed:demo</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header accounts={accounts} projection={projection} onRefreshed={load} />
      <BalanceCurve projection={projection} />
      <VarianceGrid variance={variance} />
      <RuleEditor unknown={rules?.unknown} onSaved={load} />
    </div>
  );
}
