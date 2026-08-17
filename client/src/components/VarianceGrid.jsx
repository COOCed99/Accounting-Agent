import { categoryLabel, money, signed } from '../format.js';

/**
 * Sorted by absolute variance, descending — the server does the sorting and
 * this renders it in order. No column headers are clickable on purpose: the
 * top row is supposed to tell you what to stop doing, and letting it be
 * re-sorted alphabetically would defeat the grid.
 */
export function VarianceGrid({ variance }) {
  if (!variance) return null;
  const { rows, totals, asOf } = variance;

  return (
    <section className="panel">
      <h2>Variance</h2>
      <p className="sub">
        Month to date through {asOf}, projected to full month at the current pace.
      </p>

      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Spent MTD</th>
            <th>Monthly cap</th>
            <th>Projected</th>
            <th>Over / under</th>
            <th style={{ textAlign: 'right' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className={row.status}>
              <td>{categoryLabel(row.category)}</td>
              <td>{money(row.actualMTD)}</td>
              <td>{money(row.monthlyCap)}</td>
              <td>{money(row.projectedFullMonth)}</td>
              <td className={row.variance > 0 ? 'over' : 'under'}>{signed(row.variance)}</td>
              <td>
                <span className={`pill ${row.status}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total flex</td>
            <td>{money(totals.actualMTD)}</td>
            <td>{money(totals.monthlyCap)}</td>
            <td>{money(totals.projectedFullMonth)}</td>
            <td className={totals.variance > 0 ? 'over' : 'under'}>{signed(totals.variance)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
