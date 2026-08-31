import { useState } from "react";
import { ArrowLeft, ChevronDown, Ellipsis, Heart, Minus, Plus, Share2, Tag } from "lucide-react";
import "./CardDetailRich.css";

type Mode = "Raw" | "Graded" | "POP";

const gradeOptions: Record<string, string[]> = {
  PSA: ["8", "9", "10"],
  BGS: ["9", "9.5", "10"],
  CGC: ["8", "9", "10"],
};

const prices: Record<string, string> = {
  Raw: "$225.01",
  "PSA 8": "$842.00",
  "PSA 9": "$1,480.00",
  "PSA 10": "$3,648.74",
  "BGS 9": "$1,120.00",
  "BGS 9.5": "$2,090.00",
  "BGS 10": "$4,180.00",
  "CGC 8": "$760.00",
  "CGC 9": "$1,290.00",
  "CGC 10": "$3,020.00",
};

function DetailChart({ graded }: { graded: boolean }) {
  return (
    <svg className="chart" viewBox="0 0 360 112" preserveAspectRatio="none" aria-label="Three month verified price history">
      <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#58d7bb" stopOpacity=".35" /><stop offset="1" stopColor="#58d7bb" stopOpacity="0" /></linearGradient></defs>
      <path d="M0 98 L20 85 L42 92 L63 69 L85 72 L108 41 L131 50 L154 28 L176 34 L198 20 L220 39 L242 33 L264 54 L286 46 L308 60 L330 47 L360 52 L360 112 L0 112Z" fill="url(#area)" />
      <path d="M0 98 L20 85 L42 92 L63 69 L85 72 L108 41 L131 50 L154 28 L176 34 L198 20 L220 39 L242 33 L264 54 L286 46 L308 60 L330 47 L360 52" fill="none" stroke={graded ? "#e6ba55" : "#58d7bb"} strokeWidth="2.5" />
    </svg>
  );
}

export function CardDetailRich() {
  const [mode, setMode] = useState<Mode>("Raw");
  const [grader, setGrader] = useState("PSA");
  const [grade, setGrade] = useState("10");
  const [rawQty, setRawQty] = useState(0);
  const [gradedQty, setGradedQty] = useState(1);
  const [range, setRange] = useState("3M");
  const selectedGrade = mode === "Raw" ? "Raw" : `${grader} ${grade}`;
  const currentPrice = prices[selectedGrade] ?? "Price unavailable";

  return (
    <main className="card-detail-rich">
      <header className="card-detail-rich__header">
        <button className="icon-button" aria-label="Go back"><ArrowLeft size={17} /></button>
        <div className="header-actions">
          <button className="icon-button" aria-label="Share card"><Share2 size={16} /></button>
          <button className="icon-button" aria-label="More card actions"><Ellipsis size={17} /></button>
        </div>
      </header>

      <section className="card-detail-rich__hero" aria-label="Card preview">
        <div className="hero-card" aria-label="Pikachu and Zekrom GX card preview">
          <span className="hero-card__label">SM168 · TAG TEAM · HP 240</span>
          <span className="hero-card__name">PIKACHU &amp; ZEKROM GX</span>
          <span className="hero-card__power">FULL BLITZ 150</span>
          <span className="hero-card__shine" />
        </div>
        <span className="hero-card__caption">Tap image to inspect</span>
      </section>

      <section className="identity-card">
        <div className="identity-top">
          <div>
            <div className="eyebrow">POKÉMON · SUN &amp; MOON PROMO</div>
            <h1>Pikachu &amp; Zekrom GX</h1>
            <div className="identity-meta">Promo <span>•</span> SM168 <span>•</span> Holfoil</div>
          </div>
          <button className="favorite" aria-label="Add to favourites"><Heart size={20} fill="currentColor" /></button>
        </div>
        <div className="price-row">
          <div><div className="price-label">{selectedGrade} verified market value</div><div className="price-value">{currentPrice}</div></div>
          <div><div className="price-change">▲ 10.47%</div><div className="price-source">PriceCharting · AUD</div></div>
        </div>
        <button className="primary-cta"><Tag size={15} /> View sold listings</button>
      </section>

      <div className="mode-tabs" role="tablist" aria-label="Card market views">
        {(["Raw", "Graded", "POP"] as Mode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)} role="tab" aria-selected={mode === item}>{item}</button>
        ))}
      </div>

      {mode === "POP" ? (
        <section className="panel">
          <div className="panel-heading"><h2>Population report</h2><small>All grades · updated 2d ago</small></div>
          <table className="pop-table">
            <thead><tr><th>Grade</th><th>Population</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Raw</td><td>—</td><td>$225</td></tr>
              <tr><td>PSA 8</td><td>1,842</td><td>$842</td></tr>
              <tr><td>PSA 9</td><td>2,916</td><td>$1,480</td></tr>
              <tr><td>PSA 10</td><td>536</td><td>$3,649</td></tr>
              <tr><td>BGS 10</td><td>74</td><td>$4,180</td></tr>
            </tbody>
          </table>
          <p className="pop-note">POP numbers show the number of cards recorded by each grading company. Raw cards do not receive a population count.</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading"><h2>{mode === "Raw" ? "Raw market" : "Graded market"}</h2><small>Verified history</small></div>
            {mode === "Graded" && (
              <div className="select-row">
                <div><label className="field-label">Grading company</label><button className="select-control selected" onClick={() => setGrader(grader === "PSA" ? "BGS" : "PSA")}>{grader}<ChevronDown size={14} /></button></div>
                <div><label className="field-label">Grade</label><button className="select-control selected" onClick={() => setGrade(grade === "10" ? gradeOptions[grader][0] : "10")}>{grader} {grade}<ChevronDown size={14} /></button></div>
              </div>
            )}
            {mode === "Graded" && <div className="option-list">{gradeOptions[grader].map((option) => <button key={option} className={grade === option ? "active" : ""} onClick={() => setGrade(option)}>{grader} {option}</button>)}</div>}
            <div className="availability"><span>●</span> {mode === "Raw" ? <><strong>Raw / ungraded</strong> · broad market estimate</> : <><strong>{selectedGrade}</strong> · exact grade match available</>}</div>
            <DetailChart graded={mode === "Graded"} />
            <div className="chart-labels"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div>
            <div className="range-row">{["1M", "3M", "6M", "12M", "MAX"].map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
          </section>

          <section className="panel">
            <div className="panel-heading"><h2>Add to collection</h2><small>Total value · $3,873.75</small></div>
            <div className="collection-line">
              <span className="grade-mark raw">RAW</span><div className="collection-copy"><strong>Ungraded</strong><small>Holfoil</small></div>
              <div className="quantity"><button onClick={() => setRawQty(Math.max(0, rawQty - 1))} aria-label="Remove raw card"><Minus size={13} /></button><b>{rawQty}</b><button onClick={() => setRawQty(rawQty + 1)} aria-label="Add raw card"><Plus size={13} /></button></div>
              <div className="line-value">{rawQty ? "$225" : "—"}</div>
            </div>
            <div className="collection-line">
              <span className="grade-mark">PSA</span><div className="collection-copy"><strong>PSA 10</strong><small>Pop. 536 · Holfoil</small></div>
              <div className="quantity"><button onClick={() => setGradedQty(Math.max(0, gradedQty - 1))} aria-label="Remove graded card"><Minus size={13} /></button><b>{gradedQty}</b><button onClick={() => setGradedQty(gradedQty + 1)} aria-label="Add graded card"><Plus size={13} /></button></div>
              <div className="line-value">$3,649</div>
            </div>
            <button className="add-graded">+ Add a graded card</button>
          </section>
        </>
      )}

      <section className="panel">
        <div className="panel-heading"><h2>Related listings</h2><small>Live from marketplaces</small></div>
        {[["PSA 10 · cert verified", "$3,599"], ["Raw · clean holofoil", "$219"], ["BGS 9.5 · subgrades", "$2,090"]].map(([label, value]) => (
          <div className="listing-card" key={label}><div className="listing-thumb" /><div className="listing-copy"><strong>{label}</strong><small>eBay · Australia · 2h ago</small></div><div className="listing-price">{value}<small>View</small></div></div>
        ))}
      </section>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {["⌂|Home", "⌕|Search", "▣|Market", "♧|Community", "◉|Collection"].map((item) => { const [icon, label] = item.split("|"); return <button key={label} className={label === "Collection" ? "active" : ""}><span>{icon}</span>{label}</button>; })}
      </nav>
    </main>
  );
}