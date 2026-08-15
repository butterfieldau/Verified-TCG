import { useState, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg: '#090909',
  card: '#111111',
  cardBorder: '#1e1e1e',
  primary: '#FF1E2D',
  positive: '#22C55E',
  negative: '#FF1E2D',
  text: '#FFFFFF',
  muted: '#666666',
  surface: '#161616',
};

// ── Mock data ──────────────────────────────────────────────────────────────────
const RANGES = ['1D', '7D', '1M', '3M', '6M', 'ALL'] as const;
type Range = typeof RANGES[number];

function generateChart(range: Range) {
  const counts: Record<Range, number> = { '1D': 24, '7D': 28, '1M': 30, '3M': 90, '6M': 180, ALL: 365 };
  const n = counts[range];
  const base = 24800;
  let val = base;
  return Array.from({ length: n }, (_, i) => {
    val += (Math.random() - 0.44) * 420;
    val = Math.max(18000, Math.min(32000, val));
    const d = new Date(2026, 6, 1);
    d.setDate(d.getDate() - (n - i));
    const label = range === '1D'
      ? `${i % 2 === 0 ? `${8 + Math.floor(i / 2)}:00` : ''}`
      : range === '7D'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7]
      : `${d.getDate()}/${d.getMonth() + 1}`;
    return { label, value: Math.round(val), i };
  });
}

const CHART_DATA: Record<Range, ReturnType<typeof generateChart>> = {
  '1D': generateChart('1D'),
  '7D': generateChart('7D'),
  '1M': generateChart('1M'),
  '3M': generateChart('3M'),
  '6M': generateChart('6M'),
  'ALL': generateChart('ALL'),
};

const GAINERS = [
  { name: 'Charizard ex', set: 'Surging Sparks', price: '$1,840', change: '+24.3%', img: '🔥' },
  { name: 'Pikachu ex SIR', set: 'ME: Ascended', price: '$4,580', change: '+18.7%', img: '⚡' },
  { name: 'Umbreon VMAX', set: 'Evolving Skies', price: '$920', change: '+11.2%', img: '🌙' },
  { name: 'Lugia V', set: 'Silver Tempest', price: '$380', change: '+8.9%', img: '🌫️' },
];

const LOSERS = [
  { name: 'Rayquaza VMAX', set: 'Evolving Skies', price: '$210', change: '-12.4%', img: '🌀' },
  { name: 'Mew VMAX', set: 'Fusion Strike', price: '$145', change: '-9.1%', img: '🌸' },
  { name: 'Giratina V Alt', set: 'Lost Origin', price: '$340', change: '-6.8%', img: '👁️' },
  { name: 'Mewtwo ex', set: 'MEW 151', price: '$88', change: '-4.2%', img: '🧬' },
];

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, coordinate }: any) {
  if (!active || !payload?.length) return null;
  const val: number = payload[0].value;
  const date: string = payload[0].payload.label;
  return (
    <div
      style={{
        position: 'absolute',
        top: -56,
        left: Math.min(Math.max((coordinate?.x ?? 0) - 60, 0), 270),
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: 10,
        padding: '7px 12px',
        pointerEvents: 'none',
        minWidth: 120,
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'SF Pro Display, -apple-system, sans-serif', letterSpacing: -0.3 }}>
        ${val.toLocaleString('en-AU')}
      </div>
      {date && (
        <div style={{ color: '#666', fontSize: 11, fontFamily: 'SF Pro Text, -apple-system, sans-serif', marginTop: 1 }}>
          {date}
        </div>
      )}
    </div>
  );
}

// ── Custom active dot ──────────────────────────────────────────────────────────
function ActiveDot({ cx, cy, fill }: any) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} fill={fill} opacity={0.15} />
      <circle cx={cx} cy={cy} r={5} fill={fill} />
      <circle cx={cx} cy={cy} r={2.5} fill="#fff" />
    </g>
  );
}

// ── Card chip ──────────────────────────────────────────────────────────────────
function MarketRow({ name, set, price, change, img, positive }: {
  name: string; set: string; price: string; change: string; img: string; positive: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      borderBottom: `1px solid ${C.cardBorder}`,
    }}>
      <div style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        background: positive ? 'rgba(34,197,94,0.1)' : 'rgba(255,30,45,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        flexShrink: 0,
      }}>{img}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.text, fontSize: 12.5, fontWeight: 600, fontFamily: 'SF Pro Text, -apple-system, sans-serif', letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </div>
        <div style={{ color: C.muted, fontSize: 10.5, fontFamily: 'SF Pro Text, -apple-system, sans-serif', marginTop: 1 }}>
          {set}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ color: C.text, fontSize: 12.5, fontWeight: 700, fontFamily: 'SF Pro Display, -apple-system, sans-serif', letterSpacing: -0.2 }}>
          {price}
        </div>
        <div style={{ color: positive ? C.positive : C.negative, fontSize: 11, fontWeight: 600, fontFamily: 'SF Pro Text, -apple-system, sans-serif', marginTop: 1 }}>
          {change}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function HomeScreen() {
  const [range, setRange] = useState<Range>('1M');
  const [activePoint, setActivePoint] = useState<{ value: number; label: string } | null>(null);

  const data = CHART_DATA[range];
  const first = data[0].value;
  const last = activePoint?.value ?? data[data.length - 1].value;
  const gain = last - first;
  const gainPct = ((gain / first) * 100);
  const isPositive = gain >= 0;
  const chartColor = isPositive ? C.positive : C.negative;

  const gradientId = isPositive ? 'greenGrad' : 'redGrad';

  const handleMouseMove = useCallback((e: any) => {
    if (e?.activePayload?.[0]) {
      setActivePoint({ value: e.activePayload[0].value, label: e.activePayload[0].payload.label });
    }
  }, []);
  const handleMouseLeave = useCallback(() => setActivePoint(null), []);

  return (
    <div style={{
      width: 390,
      minHeight: 844,
      background: C.bg,
      fontFamily: 'SF Pro Text, -apple-system, BlinkMacSystemFont, sans-serif',
      position: 'relative',
      overflowX: 'hidden',
    }}>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', paddingTop: 8 }}>
        <span style={{ color: C.text, fontWeight: 700, fontSize: 15 }}>9:41</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none"><rect x="0" y="3" width="3" height="9" rx="1" fill="#fff" opacity="0.4"/><rect x="4.5" y="2" width="3" height="10" rx="1" fill="#fff" opacity="0.6"/><rect x="9" y="0.5" width="3" height="11.5" rx="1" fill="#fff" opacity="0.8"/><rect x="13.5" y="0" width="3" height="12" rx="1" fill="#fff"/></svg>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M8 2.4C10.3 2.4 12.4 3.4 13.8 5L15.5 3.3C13.6 1.3 11 0 8 0C5 0 2.4 1.3.5 3.3L2.2 5C3.6 3.4 5.7 2.4 8 2.4Z" fill="#fff"/><path d="M8 5.4C9.5 5.4 10.9 6 11.9 7L13.6 5.3C12.1 3.9 10.2 3 8 3C5.8 3 3.9 3.9 2.4 5.3L4.1 7C5.1 6 6.5 5.4 8 5.4Z" fill="#fff" opacity="0.7"/><circle cx="8" cy="10" r="2" fill="#fff"/></svg>
          <div style={{ background: '#22C55E', borderRadius: 3, padding: '1px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#000', fontWeight: 800, fontSize: 12 }}>97</span>
            <span style={{ color: '#000', fontSize: 10 }}>%</span>
          </div>
        </div>
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 8px' }}>
        {/* Logo wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 13L8 3L13 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 9.5H11" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: C.text, fontWeight: 800, fontSize: 18, letterSpacing: -0.5, fontFamily: 'SF Pro Display, -apple-system, sans-serif' }}>Verified</span>
          <span style={{ color: C.primary, fontWeight: 800, fontSize: 18, letterSpacing: -0.5, fontFamily: 'SF Pro Display, -apple-system, sans-serif' }}>TCG</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Bell */}
          <div style={{ position: 'relative' }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: C.card, border: `1px solid ${C.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <div style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: C.primary, border: '1.5px solid #090909' }} />
          </div>
          {/* Avatar */}
          <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, #FF1E2D, #FF6B35)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>JD</span>
          </div>
        </div>
      </div>

      {/* ── Portfolio hero ───────────────────────────────────────────────── */}
      <div style={{ padding: '8px 20px 0' }}>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 }}>Portfolio Value</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            color: C.text,
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: -1.5,
            fontFamily: 'SF Pro Display, -apple-system, sans-serif',
            lineHeight: 1,
          }}>
            ${last.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
          </span>
          <span style={{ color: C.muted, fontSize: 14, fontWeight: 500 }}>AUD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: isPositive ? 'rgba(34,197,94,0.12)' : 'rgba(255,30,45,0.12)',
            padding: '3px 8px',
            borderRadius: 6,
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              {isPositive
                ? <path d="M5 1L9 7H1L5 1Z" fill={C.positive}/>
                : <path d="M5 9L1 3H9L5 9Z" fill={C.negative}/>}
            </svg>
            <span style={{ color: chartColor, fontSize: 13, fontWeight: 700 }}>
              {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
            </span>
          </div>
          <span style={{ color: C.muted, fontSize: 12 }}>
            {isPositive ? '+' : ''}${Math.abs(gain).toLocaleString('en-AU', { minimumFractionDigits: 2 })} this period
          </span>
        </div>
      </div>

      {/* ── Interactive chart ────────────────────────────────────────────── */}
      <div
        style={{ width: '100%', marginTop: 20, position: 'relative' }}
        onMouseLeave={handleMouseLeave}
      >
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart
            data={data}
            margin={{ top: 20, right: 0, left: 0, bottom: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF1E2D" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#FF1E2D" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis domain={['auto', 'auto']} hide />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: isPositive ? C.positive : C.negative, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.6 }}
              position={{ y: 0 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={<ActiveDot fill={chartColor} />}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Range pills */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '12px 20px 0',
        }}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                background: range === r ? C.primary : 'transparent',
                color: range === r ? '#fff' : C.muted,
                border: 'none',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 13,
                fontWeight: range === r ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'SF Pro Text, -apple-system, sans-serif',
                letterSpacing: -0.2,
                transition: 'all 0.15s',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div style={{ margin: '20px 20px 0', height: 1, background: C.cardBorder }} />

      {/* ── Gainers & Losers ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, padding: '16px 20px 0' }}>

        {/* Gainers */}
        <div style={{
          flex: 1,
          background: C.card,
          borderRadius: 16,
          border: `1px solid ${C.cardBorder}`,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '12px 14px 8px',
            borderBottom: `1px solid ${C.cardBorder}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.positive }} />
            <span style={{ color: C.positive, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Gainers</span>
          </div>
          {/* Rows */}
          <div style={{ padding: '0 14px' }}>
            {GAINERS.map((g, i) => (
              <div key={g.name} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 0',
                borderBottom: i < GAINERS.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{g.img}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: -0.2 }}>{g.name}</div>
                  <div style={{ color: C.positive, fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>{g.change}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Losers */}
        <div style={{
          flex: 1,
          background: C.card,
          borderRadius: 16,
          border: `1px solid ${C.cardBorder}`,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '12px 14px 8px',
            borderBottom: `1px solid ${C.cardBorder}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.negative }} />
            <span style={{ color: C.negative, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Losers</span>
          </div>
          {/* Rows */}
          <div style={{ padding: '0 14px' }}>
            {LOSERS.map((g, i) => (
              <div key={g.name} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 0',
                borderBottom: i < LOSERS.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,30,45,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{g.img}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: -0.2 }}>{g.name}</div>
                  <div style={{ color: C.negative, fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>{g.change}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Market Movers ────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: C.text, fontSize: 16, fontWeight: 700, letterSpacing: -0.4, fontFamily: 'SF Pro Display, -apple-system, sans-serif' }}>Market Movers</span>
          <span style={{ color: C.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>See all</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[...GAINERS.slice(0, 2), ...LOSERS.slice(0, 2)].map((m, i) => (
            <MarketRow
              key={m.name}
              {...m}
              positive={i < 2}
            />
          ))}
        </div>
      </div>

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, padding: '20px 20px 32px' }}>
        {[
          { icon: '📷', label: 'Scan', color: C.primary },
          { icon: '➕', label: 'Add Card', color: '#8B5CF6' },
          { icon: '💰', label: 'Prices', color: '#F59E0B' },
          { icon: '🛡️', label: 'Verify', color: C.positive },
        ].map(a => (
          <button key={a.label} style={{
            flex: 1,
            background: C.card,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 14,
            padding: '12px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            cursor: 'pointer',
          }}>
            <span style={{ fontSize: 20 }}>{a.icon}</span>
            <span style={{ color: '#aaa', fontSize: 10.5, fontWeight: 600, fontFamily: 'SF Pro Text, -apple-system, sans-serif', letterSpacing: 0.2 }}>{a.label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
