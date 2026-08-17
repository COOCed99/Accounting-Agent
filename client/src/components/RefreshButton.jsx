import { useState } from 'react';

export function RefreshButton({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      const result = await response.json();
      if (result.error) setError(result.error);
      await onDone?.();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: 'right' }}>
      <button className="primary" onClick={refresh} disabled={busy}>
        {busy ? 'Syncing…' : 'Refresh'}
      </button>
      {error && (
        <div style={{ color: 'var(--breach)', fontSize: 12, marginTop: 6, maxWidth: 260 }}>{error}</div>
      )}
    </div>
  );
}
