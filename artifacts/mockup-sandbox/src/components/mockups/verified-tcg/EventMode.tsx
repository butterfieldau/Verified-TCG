import { useState } from "react";
import "./EventMode.css";

// ── Brand tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0A0A",
  card: "#141414",
  cardRaised: "#1C1C1C",
  border: "#242424",
  primary: "#FF1E2D",
  fg: "#FFFFFF",
  muted: "#888888",
  positive: "#22C55E",
  warning: "#F59E0B",
  blue: "#3B82F6",
};

// ── Mock data ─────────────────────────────────────────────────────────────────
const EVENT = {
  name: "Sydney TCG Open 2025",
  venue: "International Convention Centre",
  city: "Sydney, NSW",
  dates: "Aug 14–16",
  collectors: 847,
};

const STATS = [
  { emoji: "🤝", value: 12, label: "Trade Matches", color: C.positive,   tab: "matches"    },
  { emoji: "🔥", value: 17, label: "Have Your Wants", color: "#F97316", tab: "wishlist"   },
  { emoji: "💰", value: 9,  label: "Wishlist For Sale", color: C.warning, tab: "for_sale"   },
  { emoji: "👀", value: 23, label: "Want Your Cards", color: C.blue,     tab: "want_yours" },
];

const QUICK_ACTIONS = [
  { icon: "🔍", label: "I'm Looking For",  color: "#FF1E2D", bg: "#FF1E2D18" },
  { icon: "📦", label: "I Have This",       color: "#22C55E", bg: "#22C55E18" },
  { icon: "📋", label: "Wanted Board",      color: "#3B82F6", bg: "#3B82F618" },
  { icon: "✅", label: "Complete My Set",   color: "#F59E0B", bg: "#F59E0B18" },
];

const TABS = ["Matches", "Wishlist", "Want Yours", "For Sale", "Trending"];

const MATCHES = [
  {
    id: 1, pct: 94,
    youWant:  { name: "Charizard ex SIR", set: "SV: 151", grade: "PSA 10", value: 780, bg: "linear-gradient(135deg,#E05225,#FF7A3D)" },
    theyWant: { name: "Umbreon ex SIR", set: "Prismatic Ev.", grade: "Raw", value: 420, bg: "linear-gradient(135deg,#2D1B69,#7C3AED)" },
    collector: { initials: "JK", name: "@jakekenny_tcg", location: "Pyrmont, NSW", verified: true, color: "#7C3AED" },
  },
  {
    id: 2, pct: 86,
    youWant:  { name: "Pikachu ex SIR", set: "SV: 151", grade: "BGS 9.5", value: 340, bg: "linear-gradient(135deg,#C8930A,#F5D13A)" },
    theyWant: { name: "Mew ex SIR", set: "SV: 151", grade: "PSA 9", value: 290, bg: "linear-gradient(135deg,#1A3A5C,#3B82F6)" },
    collector: { initials: "SC", name: "@sydcard_hunter", location: "Bondi, NSW", verified: false, color: "#22C55E" },
  },
  {
    id: 3, pct: 71,
    youWant:  { name: "Lugia V Alt Art", set: "Silver Tempest", grade: "Raw", value: 220, bg: "linear-gradient(135deg,#134E5E,#71B5D2)" },
    theyWant: { name: "Rayquaza VMAX", set: "Evolving Skies", grade: "PSA 10", value: 510, bg: "linear-gradient(135deg,#14532D,#16A34A)" },
    collector: { initials: "MR", name: "@mrbreezy_cards", location: "Chatswood, NSW", verified: true, color: "#F97316" },
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CardThumb({ bg }: { bg: string }) {
  return (
    <div className="card-thumb" style={{ background: bg }}>
      <div className="card-thumb-shine" />
    </div>
  );
}

function StatTile({ stat, active, onClick }: { stat: typeof STATS[0]; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="stat-tile"
      style={{
        borderColor: active ? stat.color : "transparent",
        boxShadow: active ? `0 0 12px ${stat.color}33` : "none",
      }}
    >
      <span className="stat-emoji">{stat.emoji}</span>
      <span className="stat-value" style={{ color: active ? stat.color : C.fg }}>
        {stat.value}
      </span>
      <span className="stat-label">{stat.label}</span>
    </button>
  );
}

function MatchCard({ match }: { match: typeof MATCHES[0] }) {
  return (
    <div className="match-card">
      {/* Header row */}
      <div className="match-card-header">
        <span className="match-pct-badge" style={{ color: C.positive, background: `${C.positive}18` }}>
          ● {match.pct}% Match
        </span>
        <span className="at-event-tag">AT THIS EVENT</span>
      </div>

      {/* Trade sides */}
      <div className="trade-row">
        <div className="trade-side">
          <CardThumb bg={match.youWant.bg} />
          <div className="trade-info">
            <span className="trade-dir">YOU WANT</span>
            <span className="trade-name">{match.youWant.name}</span>
            <span className="trade-meta">{match.youWant.grade}</span>
            <span className="trade-value">${match.youWant.value.toLocaleString()}</span>
          </div>
        </div>

        <div className="swap-icon">⇄</div>

        <div className="trade-side trade-side-right">
          <div className="trade-info trade-info-right">
            <span className="trade-dir" style={{ textAlign: "right" }}>THEY WANT</span>
            <span className="trade-name" style={{ textAlign: "right" }}>{match.theyWant.name}</span>
            <span className="trade-meta" style={{ textAlign: "right" }}>{match.theyWant.grade}</span>
            <span className="trade-value" style={{ textAlign: "right" }}>${match.theyWant.value.toLocaleString()}</span>
          </div>
          <CardThumb bg={match.theyWant.bg} />
        </div>
      </div>

      {/* Collector footer */}
      <div className="match-footer">
        <div className="match-avatar" style={{ background: match.collector.color }}>
          {match.collector.initials}
        </div>
        <span className="match-name">{match.collector.name}</span>
        {match.collector.verified && <span className="verified-dot">✓</span>}
        <span className="match-spacer" />
        <span className="match-location">{match.collector.location}</span>
        <span className="match-chevron">›</span>
      </div>
    </div>
  );
}

// ── Entry Screen ──────────────────────────────────────────────────────────────
function EntryScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="screen-root entry-screen">
      {/* Nav */}
      <div className="nav-bar">
        <button className="nav-back">‹</button>
        <span className="nav-title">Event Mode</span>
        <div style={{ width: 40 }} />
      </div>

      <div className="entry-scroll">
        {/* Hero card */}
        <div className="entry-hero">
          <div className="live-detected-badge">
            <span className="live-pulse-dot" style={{ background: C.primary }} />
            <span style={{ color: C.primary, fontSize: 10, fontWeight: 700, letterSpacing: "1.2px" }}>LIVE EVENT DETECTED</span>
          </div>
          <div className="entry-hero-glow" />
          <h1 className="entry-event-name">{EVENT.name}</h1>
          <p className="entry-venue">{EVENT.venue}</p>
          <p className="entry-meta">{EVENT.city} · {EVENT.dates}</p>
          <div className="entry-divider" />
          <p className="entry-collectors">👥 {EVENT.collectors.toLocaleString()} collectors registered</p>
        </div>

        {/* Stats grid preview */}
        <p className="section-label">What's waiting for you</p>
        <div className="entry-stats-grid">
          {STATS.map(s => (
            <div key={s.emoji} className="entry-stat-card" style={{ borderColor: `${s.color}33` }}>
              <div className="entry-stat-icon" style={{ background: `${s.color}18`, color: s.color }}>
                {s.emoji}
              </div>
              <span className="entry-stat-value">{s.value}</span>
              <span className="entry-stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Feature list */}
        <div className="feature-card">
          <p className="feature-heading">Event Mode unlocks</p>
          {[
            { i: "📍", t: "See who's nearby with cards you want" },
            { i: "🤝", t: "Real-time trade matches on the floor" },
            { i: "🛍️", t: "Browse vendor inventory and listings" },
            { i: "📋", t: "Post to the Wanted Board" },
            { i: "✅", t: "Track set completion on-site" },
          ].map(f => (
            <div key={f.i} className="feature-row">
              <span className="feature-icon-wrap" style={{ background: `${C.primary}18` }}>{f.i}</span>
              <span className="feature-text">{f.t}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button className="enter-cta" onClick={onEnter}>
          ⚡ Enter Event Mode
        </button>
        <p className="disclaimer">No GPS used · matches based on your wishlist & collection</p>
      </div>
    </div>
  );
}

// ── Active Dashboard ──────────────────────────────────────────────────────────
function Dashboard({ onLeave }: { onLeave: () => void }) {
  const [activeTab, setActiveTab] = useState(0);
  const [activeStat, setActiveStat] = useState(0);

  return (
    <div className="screen-root dashboard-root">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-glow" />
        <div className="dash-header-left">
          <div className="live-row">
            <span className="live-dot live-dot-anim" />
            <span className="live-label">LIVE</span>
            <span className="event-time">· 14:32</span>
          </div>
          <h2 className="dash-event-name">Event Mode+</h2>
          <p className="dash-event-sub">{EVENT.venue} · {EVENT.dates}</p>
        </div>
        <button className="leave-btn" onClick={onLeave}>
          ↩ Leave
        </button>
      </div>

      {/* Stat tiles — 4-column */}
      <div className="stat-tiles-row">
        {STATS.map((s, i) => (
          <StatTile key={s.emoji} stat={s} active={activeStat === i} onClick={() => { setActiveStat(i); setActiveTab(["matches","wishlist","want_yours","for_sale"].indexOf(s.tab)); }} />
        ))}
      </div>

      {/* Quick Actions */}
      <div className="qa-grid">
        {QUICK_ACTIONS.map(a => (
          <button key={a.label} className="qa-btn" style={{ background: C.card, borderColor: C.border }}>
            <div className="qa-icon-wrap" style={{ background: a.bg, color: a.color }}>{a.icon}</div>
            <span className="qa-label">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs-row">
        {TABS.map((t, i) => (
          <button
            key={t}
            className="tab-item"
            style={{
              color: activeTab === i ? C.fg : C.muted,
              borderBottom: activeTab === i ? `2px solid ${C.primary}` : "2px solid transparent",
            }}
            onClick={() => setActiveTab(i)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 0 && (
          <div className="match-list">
            {MATCHES.map(m => <MatchCard key={m.id} match={m} />)}

            {/* Pro teaser */}
            <div className="pro-teaser">
              <div className="pro-teaser-badge">⚡ Event Mode+</div>
              <div className="pro-teaser-rows">
                {[
                  { e: "🔥", h: "17 collectors", t: " here have cards you want" },
                  { e: "🤝", h: "+14 more matches", t: " unlocked with Pro" },
                  { e: "👀", h: "23 collectors", t: " want your cards right now" },
                ].map(r => (
                  <div key={r.h} className="pro-teaser-row">
                    <span style={{ fontSize: 18 }}>{r.e}</span>
                    <span className="pro-teaser-text">
                      <strong style={{ color: C.fg }}>{r.h}</strong>{r.t}
                    </span>
                  </div>
                ))}
              </div>
              <button className="pro-teaser-cta">Unlock All Matches → Event Mode+</button>
            </div>
          </div>
        )}

        {activeTab !== 0 && (
          <div className="empty-tab">
            <div className="empty-tab-icon">🔒</div>
            <p className="empty-tab-title">Pro Feature</p>
            <p className="empty-tab-sub">Upgrade to see {TABS[activeTab]} at this event</p>
            <button className="empty-tab-cta">Unlock with Pro</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────
export function EventMode() {
  const [inEvent, setInEvent] = useState(false);

  return (
    <div className="mockup-frame">
      {inEvent
        ? <Dashboard onLeave={() => setInEvent(false)} />
        : <EntryScreen onEnter={() => setInEvent(true)} />
      }
    </div>
  );
}
