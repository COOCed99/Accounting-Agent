import { useState } from 'react';
import { categoryLabel, money } from '../format.js';

const CADENCE_LABEL = {
  monthly: 'monthly',
  semimonthly: 'twice a month',
  biweekly: 'every 2 weeks',
  weekly: 'weekly'
};

function UnknownRow({ rule, onSaved }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('enter an amount');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_amount: amount })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'could not save');
      setSaved(true);
      await onSaved?.();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="unknown-row">
      <span className="label">{rule.label}</span>
      <span className="meta">
        {categoryLabel(rule.category)} · {CADENCE_LABEL[rule.cadence] ?? rule.cadence}
        {rule.anchor_day != null && rule.cadence !== 'weekly' && ` from the ${rule.anchor_day}`}
      </span>
      {saved ? (
        <span className="saved">saved · {money(Number(value))}</span>
      ) : (
        <>
          {error && <span style={{ color: 'var(--breach)', fontSize: 12 }}>{error}</span>}
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
            disabled={busy}
          />
          <button onClick={save} disabled={busy || !value}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Region 4: obligations the projection knows the schedule for but not the
 * amount. Hidden only when the list is empty — a projection that quietly omits
 * real monthly obligation is worse than no projection, so this stays loud
 * until every agreement is entered.
 */
export function RuleEditor({ unknown, onSaved }) {
  if (!unknown || unknown.length === 0) return null;

  return (
    <section className="panel">
      <h2>Unknown obligations</h2>
      <p className="sub">
        {unknown.length} active {unknown.length === 1 ? 'rule has' : 'rules have'} a schedule but no
        amount, so {unknown.length === 1 ? 'it is' : 'they are'} missing from the projection above.
        Enter the amount from each agreement.
      </p>
      <div className="unknown-list">
        {unknown.map((rule) => (
          <UnknownRow key={rule.id} rule={rule} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}
