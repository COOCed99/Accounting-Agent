import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { money, moneyShort, shortDate } from '../format.js';

const BUDGETED = '#5b8def';
const DEMONSTRATED = '#d9a441';
const ZERO = '#d9534f';

/** Merge the two projections into one row per day. */
function merge(projection) {
  const demonstrated = new Map(projection.demonstrated.days.map((d) => [d.date, d.closing]));
  return projection.budgeted.days.map((day) => ({
    date: day.date,
    budgeted: day.closing,
    demonstrated: demonstrated.get(day.date) ?? null,
    events: day.events
  }));
}

/**
 * Contiguous date spans where either curve is under water.
 *
 * Each span opens on the day BEFORE the first underwater day, because the
 * curve crosses zero somewhere in that segment and a span anchored to the
 * first negative day would start late. It also keeps a lone underwater day
 * from collapsing: on a categorical axis a ReferenceArea with x1 === x2 has
 * zero width and never appears — which is exactly the single-day dip after a
 * payday that most deserves the shading.
 */
function underwaterSpans(data) {
  const spans = [];
  let open = null;

  data.forEach((row, i) => {
    const under = row.budgeted < 0 || row.demonstrated < 0;
    if (under && !open) open = { x1: data[Math.max(0, i - 1)].date, x2: row.date };
    else if (under) open.x2 = row.date;
    else if (open) {
      spans.push(open);
      open = null;
    }
  });
  if (open) spans.push(open);

  // A span still degenerate at this point can only be a dip on day 0.
  return spans.filter((span) => span.x1 !== span.x2);
}

function CurveTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="tooltip">
      <div className="date">{shortDate(label)}</div>
      <div className="row">
        <span style={{ color: BUDGETED }}>At budget</span>
        <span>{money(row.budgeted)}</span>
      </div>
      <div className="row">
        <span style={{ color: DEMONSTRATED }}>At demonstrated</span>
        <span>{money(row.demonstrated)}</span>
      </div>
      {row.events.length > 0 && (
        <div className="events">
          {row.events.map((event, i) => (
            <div className="row" key={i}>
              <span>{event.label}</span>
              <span>{money(-event.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Called as a function, not rendered as <LowPointDot />. Recharts identifies
 * its chart children by component type, so a custom wrapper component is
 * silently discarded and the dot never appears.
 */
function lowPointDot(point, color, key) {
  return (
    <ReferenceDot
      key={key}
      x={point.date}
      y={point.balance}
      r={4}
      fill={color}
      stroke="#14161a"
      strokeWidth={2}
      isFront
      ifOverflow="extendDomain"
      label={{
        value: `${shortDate(point.date)} · ${moneyShort(point.balance)}`,
        position: 'top',
        fill: color,
        fontSize: 11,
        fontWeight: 600,
        offset: 8
      }}
    />
  );
}

export function BalanceCurve({ projection }) {
  if (!projection) return null;

  const data = merge(projection);
  const spans = underwaterSpans(data);
  const { budgeted, demonstrated, flexPerDay } = projection;

  return (
    <section className="panel">
      <h2>Balance</h2>
      <p className="sub">
        Next {data.length - 1} days from {projection.account.name}. The gap between the two lines is
        the difference between the budget and the spending.
      </p>

      <div className="curve-legend">
        <span>
          <span className="swatch" style={{ borderColor: BUDGETED }} />
          At budget flex · {money(flexPerDay.budgeted)}/day
        </span>
        <span>
          <span className="swatch" style={{ borderColor: DEMONSTRATED, borderTopStyle: 'dashed' }} />
          At demonstrated flex · {money(flexPerDay.demonstrated)}/day
        </span>
        <span>
          <span className="swatch" style={{ borderColor: ZERO }} />
          Zero
        </span>
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#2e333f" vertical={false} />

          {/* Shade every stretch where either curve is below zero. */}
          {spans.map((span, i) => (
            <ReferenceArea
              key={i}
              x1={span.x1}
              x2={span.x2}
              fill={ZERO}
              fillOpacity={0.13}
              stroke="none"
            />
          ))}

          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            stroke="#9199a8"
            fontSize={11}
            interval={Math.max(1, Math.floor(data.length / 8))}
            tickLine={false}
          />
          <YAxis
            tickFormatter={moneyShort}
            stroke="#9199a8"
            fontSize={11}
            width={72}
            tickLine={false}
          />

          <Tooltip content={<CurveTooltip />} />

          <ReferenceLine y={0} stroke={ZERO} strokeWidth={1.5} />

          <Line
            type="monotone"
            dataKey="budgeted"
            stroke={BUDGETED}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="demonstrated"
            stroke={DEMONSTRATED}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />

          {/* Both, always. They routinely land on the same date at very
              different balances, and that distance is the point. */}
          {lowPointDot(budgeted.lowPoint, BUDGETED, 'low-budgeted')}
          {lowPointDot(demonstrated.lowPoint, DEMONSTRATED, 'low-demonstrated')}
        </LineChart>
      </ResponsiveContainer>

      <div className="curve-summary">
        <div>
          <div className="label">Low point at budget</div>
          <div className={`value ${budgeted.lowPoint.balance < 0 ? 'negative' : ''}`}>
            {money(budgeted.lowPoint.balance)}
          </div>
          <div className="sub" style={{ margin: 0 }}>{shortDate(budgeted.lowPoint.date)}</div>
        </div>
        <div>
          <div className="label">Low point at demonstrated</div>
          <div className={`value ${demonstrated.lowPoint.balance < 0 ? 'negative' : ''}`}>
            {money(demonstrated.lowPoint.balance)}
          </div>
          <div className="sub" style={{ margin: 0 }}>{shortDate(demonstrated.lowPoint.date)}</div>
        </div>
        <div>
          <div className="label">Days below zero</div>
          <div className={`value ${demonstrated.breaches.length ? 'negative' : ''}`}>
            {demonstrated.breaches.length}
          </div>
          <div className="sub" style={{ margin: 0 }}>
            {budgeted.breaches.length} at budget
          </div>
        </div>
        <div>
          <div className="label">Ending balance</div>
          <div className={`value ${demonstrated.endBalance < 0 ? 'negative' : ''}`}>
            {money(demonstrated.endBalance)}
          </div>
          <div className="sub" style={{ margin: 0 }}>{money(budgeted.endBalance)} at budget</div>
        </div>
      </div>

      {demonstrated.warnings.length > 0 && (
        <div className="warnings">
          {demonstrated.warnings.map((warning, i) => (
            <div key={i}>{warning.message}</div>
          ))}
        </div>
      )}
    </section>
  );
}
