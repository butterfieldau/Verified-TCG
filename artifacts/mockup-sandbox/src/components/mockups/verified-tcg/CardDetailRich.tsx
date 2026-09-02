import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  Eye,
  Heart,
  Minus,
  Plus,
  ScanLine,
  Share2,
  ShoppingBag,
  Sparkles,
  Tag,
  X,
  Zap,
} from "lucide-react";
import "./CardDetailRich.css";

type Mode = "Raw" | "Graded" | "POP";
type Grader = "PSA" | "BGS" | "CGC";

const gradeOptions: Record<Grader, string[]> = {
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

const population: Record<string, number> = {
  "PSA 8": 1842,
  "PSA 9": 2916,
  "PSA 10": 536,
  "BGS 9": 412,
  "BGS 9.5": 188,
  "BGS 10": 74,
  "CGC 8": 1036,
  "CGC 9": 1724,
  "CGC 10": 309,
};

const chartColors = ["#f04455", "#f3a35c", "#72b7a4"];
const chartPath = "M0 98 L20 85 L42 92 L63 69 L85 72 L108 41 L131 50 L154 28 L176 34 L198 20 L220 39 L242 33 L264 54 L286 46 L308 60 L330 47 L360 52";
const collectionHoldings = [
  { label: "PSA 10", grader: "PSA", pop: 536, value: "$3,648.74", initial: 1 },
  { label: "PSA 9", grader: "PSA", pop: 2916, value: "$1,480.00", initial: 0 },
  { label: "BGS 9.5", grader: "BGS", pop: 188, value: "$2,090.00", initial: 0 },
];
const soldListings = [
  ["PSA 10 · cert verified", "$3,599", "eBay · Australia · 2h ago"],
  ["Raw · clean holofoil", "$219", "eBay · Australia · 5h ago"],
  ["BGS 9.5 · subgrades", "$2,090", "Goldin · US · yesterday"],
];

function DetailChart({ graded, selectedGrades }: { graded: boolean; selectedGrades: string[] }) {
  return (
    <svg className="chart" viewBox="0 0 360 112" preserveAspectRatio="none" aria-label={`${selectedGrades.length} series price history`}>
      <defs>
        <linearGradient id="card-detail-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f04455" stopOpacity=".25" />
          <stop offset="1" stopColor="#f04455" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${chartPath} L360 112 L0 112Z`} fill="url(#card-detail-area)" />
      {selectedGrades.map((label, index) => (
        <path
          key={label}
          d={chartPath}
          fill="none"
          stroke={graded ? chartColors[index % chartColors.length] : "#f04455"}
          strokeWidth={index === 0 ? "2.5" : "2"}
          strokeLinecap="round"
          opacity={index === 0 ? 1 : .82}
          transform={`translate(0 ${index * 5})`}
        />
      ))}
    </svg>
  );
}

export function CardDetailRich() {
  const [mode, setMode] = useState<Mode>("Raw");
  const [grader, setGrader] = useState<Grader>("PSA");
  const [grade, setGrade] = useState("10");
  const [rawQty, setRawQty] = useState(0);
  const [gradedQty, setGradedQty] = useState<Record<string, number>>(
    Object.fromEntries(collectionHoldings.map((holding) => [holding.label, holding.initial])),
  );
  const [range, setRange] = useState("3M");
  const [selectedGrades, setSelectedGrades] = useState<string[]>(["PSA 10"]);
  const [favorite, setFavorite] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [showSales, setShowSales] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeNav, setActiveNav] = useState("Market");

  const selectedGrade = mode === "Raw" ? "Raw" : `${grader} ${grade}`;
  const currentPrice = prices[selectedGrade] ?? "Price unavailable";
  const totalSlabs = useMemo(
    () => collectionHoldings.reduce((sum, holding) => sum + (gradedQty[holding.label] ?? 0), 0),
    [gradedQty],
  );

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? "" : current), 2200);
  };

  const changeGrader = () => {
    const next: Grader = grader === "PSA" ? "BGS" : grader === "BGS" ? "CGC" : "PSA";
    setGrader(next);
    setGrade(gradeOptions[next][gradeOptions[next].length - 1]);
    setSelectedGrades([`${next} ${gradeOptions[next][gradeOptions[next].length - 1]}`]);
  };

  const toggleGrade = (option: string) => {
    const label = `${grader} ${option}`;
    setGrade(option);
    setSelectedGrades((current) =>
      current.includes(label) ? (current.length === 1 ? current : current.filter((item) => item !== label)) : [...current, label],
    );
  };

  const handleShare = async () => {
    const message = "Pikachu & Zekrom GX · SM168 · Verified TCG";
    if (navigator.share) {
      await navigator.share({ title: "Pikachu & Zekrom GX", text: message }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(message).catch(() => undefined);
      announce("Card details copied");
    }
  };

  return (
    <main className="card-detail-rich">
      <header className="card-detail-rich__header">
        <button className="icon-button" aria-label="Go back to collection" onClick={() => announce("Back to collection")}>
          <ArrowLeft size={17} />
        </button>
        <div className="header-context"><span className="header-kicker">CARD PASSPORT</span><span className="header-dot" /> VERIFIED</div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Share card" onClick={() => void handleShare()}><Share2 size={16} /></button>
          <button className="icon-button" aria-label="More card actions" onClick={() => setShowMenu((current) => !current)}><Ellipsis size={17} /></button>
        </div>
        {showMenu && (
          <div className="action-menu">
            <button onClick={() => { setShowMenu(false); announce("Card report opened"); }}><CircleHelp size={14} /> Report a data issue</button>
            <button onClick={() => { setShowMenu(false); announce("Card link copied"); }}><ArrowUpRight size={14} /> Copy card link</button>
          </div>
        )}
      </header>

      <section className="card-detail-rich__hero" aria-label="Card preview">
        <button className="hero-card" aria-label="Inspect Pikachu and Zekrom GX" onClick={() => setShowImage(true)}>
          <span className="hero-card__label">SM168 · TAG TEAM · HP 240</span>
          <span className="hero-card__name">PIKACHU &amp; ZEKROM GX</span>
          <span className="hero-card__power">FULL BLITZ 150</span>
          <span className="hero-card__shine" />
        </button>
        <span className="hero-card__caption"><ScanLine size={12} /> Tap to inspect</span>
        <div className="hero-stamp"><Check size={12} /> IDENTITY MATCHED</div>
      </section>

      <section className="identity-card">
        <div className="identity-top">
          <div>
            <div className="eyebrow">POKÉMON · SUN &amp; MOON PROMO</div>
            <h1>Pikachu &amp; Zekrom GX</h1>
            <div className="identity-meta">Promo <span>•</span> SM168 <span>•</span> Holfoil</div>
          </div>
          <button className={`favorite ${favorite ? "is-favorite" : ""}`} aria-label={favorite ? "Remove from favourites" : "Add to favourites"} onClick={() => { setFavorite((current) => !current); announce(favorite ? "Removed from favourites" : "Added to favourites"); }}>
            <Heart size={20} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="price-row">
          <div><div className="price-label">{selectedGrade} verified market value</div><div className="price-value">{currentPrice}</div></div>
          <div><div className="price-change"><Zap size={13} /> 10.47%</div><div className="price-source">PriceCharting · AUD</div></div>
        </div>
        <div className="confidence-row"><span><span className="confidence-dot" /> High confidence</span><span>Refreshed 18m ago</span></div>
        <button className="primary-cta" onClick={() => setShowSales((current) => !current)}><Tag size={15} /> {showSales ? "Hide sold listings" : "View sold listings"}<ArrowUpRight size={14} /></button>
      </section>

      <div className="mode-tabs" role="tablist" aria-label="Card market views">
        {(["Raw", "Graded", "POP"] as Mode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)} role="tab" aria-selected={mode === item}>{item}<small>{item === "Raw" ? "market" : item === "Graded" ? "slabs" : "population"}</small></button>
        ))}
      </div>

      {mode === "POP" ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">SCARCITY INDEX</span><h2>Population report</h2></div><small>Updated 2d ago</small></div>
          <div className="pop-highlight"><BarChart3 size={18} /><strong>536</strong><span>PSA 10s recorded</span><b>Top 11%</b></div>
          <table className="pop-table">
            <thead><tr><th>Grade</th><th>Population</th><th>Value</th></tr></thead>
            <tbody>{[["Raw", "—", "$225"], ["PSA 8", "1,842", "$842"], ["PSA 9", "2,916", "$1,480"], ["PSA 10", "536", "$3,649"], ["BGS 10", "74", "$4,180"]].map(([label, pop, value]) => <tr key={label}><td>{label}</td><td>{pop}</td><td>{value}</td></tr>)}</tbody>
          </table>
          <p className="pop-note">POP numbers show cards recorded by each grading company. Raw cards do not receive a population count.</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">MARKET SIGNAL</span><h2>{mode === "Raw" ? "Raw market" : "Graded market"}</h2></div><small>Verified history</small></div>
            {mode === "Graded" && <div className="select-row">
              <div><label className="field-label">Grading company</label><button className="select-control selected" onClick={changeGrader}>{grader}<ChevronDown size={14} /></button></div>
              <div><label className="field-label">Primary grade</label><button className="select-control selected" onClick={() => toggleGrade(grade === "10" ? gradeOptions[grader][0] : "10")}>{grader} {grade}<ChevronDown size={14} /></button></div>
            </div>}
            {mode === "Graded" && <div className="option-list">{gradeOptions[grader].map((option) => <button key={option} className={selectedGrades.includes(`${grader} ${option}`) ? "active" : ""} onClick={() => toggleGrade(option)}><span className="grade-option__grade">{grader} {option}</span><span className="grade-option__pop">POP {population[`${grader} ${option}`]?.toLocaleString() ?? "—"}</span></button>)}</div>}
            <div className="availability"><span>●</span> {mode === "Raw" ? <><strong>Raw / ungraded</strong> · broad market estimate</> : <><strong>{selectedGrades.length} grades compared</strong> · tap to toggle</>}</div>
            <DetailChart graded={mode === "Graded"} selectedGrades={mode === "Raw" ? ["Raw"] : selectedGrades} />
            {mode === "Graded" && <div className="chart-legend">{selectedGrades.map((label, index) => <span key={label}><i style={{ background: chartColors[index % chartColors.length] }} />{label}</span>)}</div>}
            <div className="chart-labels"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div>
            <div className="range-row">{["1M", "3M", "6M", "12M", "MAX"].map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => { setRange(item); announce(`${item} history selected`); }}>{item}</button>)}</div>
          </section>

          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">YOUR HOLDINGS</span><h2>Your collection</h2></div><small>{totalSlabs} slab{totalSlabs === 1 ? "" : "s"} · tracked</small></div>
            <div className="collection-line"><span className="grade-mark raw">RAW</span><div className="collection-copy"><strong>Ungraded</strong><small>Holfoil</small></div><div className="quantity"><button onClick={() => setRawQty(Math.max(0, rawQty - 1))} aria-label="Remove raw card"><Minus size={13} /></button><b>{rawQty}</b><button onClick={() => setRawQty(rawQty + 1)} aria-label="Add raw card"><Plus size={13} /></button></div><div className="line-value">{rawQty ? "$225" : "—"}</div></div>
            <div className="graded-collection-card"><div className="graded-collection-card__top"><div><span className="section-kicker">GRADED COPIES</span><strong className="graded-collection-card__title">Your slabs</strong></div><span className="graded-collection-card__total">{totalSlabs} owned</span></div><div className="graded-collection-card__labels"><span>Grade · population</span><span>Owned</span><span>Value</span></div>{collectionHoldings.map((holding) => <div className="graded-holding-row" key={holding.label}><span className="grade-mark">{holding.grader}</span><div className="graded-holding-copy"><strong>{holding.label}</strong><small>Pop. {holding.pop.toLocaleString()} · exact match</small></div><div className="quantity"><button onClick={() => setGradedQty((current) => ({ ...current, [holding.label]: Math.max(0, (current[holding.label] ?? 0) - 1) }))} aria-label={`Remove ${holding.label}`}><Minus size={12} /></button><b>{gradedQty[holding.label] ?? 0}</b><button onClick={() => setGradedQty((current) => ({ ...current, [holding.label]: (current[holding.label] ?? 0) + 1 }))} aria-label={`Add ${holding.label}`}><Plus size={12} /></button></div><span className="graded-holding-value">{holding.value}</span></div>)}<div className="graded-collection-card__footer"><span>Combined holding value</span><strong>$7,218.74</strong></div></div>
            <button className="add-graded" onClick={() => { setMode("Graded"); announce("Choose a grade to compare"); }}><Plus size={13} /> Choose another grade <span>→</span></button>
          </section>
        </>
      )}

      {showSales && <section className="panel sales-panel"><div className="panel-heading"><div><span className="section-kicker">PRICE DISCOVERY</span><h2>Recent sold listings</h2></div><small>Last 30 days</small></div>{soldListings.map(([label, value, source]) => <button className="listing-card" key={label} onClick={() => announce(`${label} selected`)}><div className="listing-thumb"><ShoppingBag size={16} /></div><div className="listing-copy"><strong>{label}</strong><small>{source}</small></div><div className="listing-price">{value}<small>Inspect <ArrowUpRight size={10} /></small></div></button>)}</section>}

      <section className="panel related-panel"><div className="panel-heading"><div><span className="section-kicker">COLLECTOR RADAR</span><h2>Related cards</h2></div><small>Same set</small></div><div className="related-grid">{["Reshiram & Charizard GX", "Mewtwo & Mew GX", "Eevee & Snorlax GX"].map((name, index) => <button key={name} onClick={() => announce(`${name} selected`)}><div className={`related-thumb related-thumb--${index}`}><Sparkles size={15} /></div><strong>{name}</strong><span>{["$1,240", "$1,885", "$476"][index]}</span></button>)}</div></section>

      <nav className="bottom-nav" aria-label="Primary navigation">{[["Home", "⌂"], ["Search", "⌕"], ["Market", "▣"], ["Community", "♧"], ["Collection", "◉"]].map(([label, icon]) => <button key={label} className={activeNav === label ? "active" : ""} onClick={() => { setActiveNav(label); announce(`${label} selected`); }}><span>{icon}</span>{label}</button>)}</nav>

      {saved && <div className="saved-ribbon"><Bookmark size={12} fill="currentColor" /> SAVED TO WATCHLIST</div>}
      <button className={`floating-save ${saved ? "active" : ""}`} onClick={() => { setSaved((current) => !current); announce(saved ? "Removed from watchlist" : "Saved to watchlist"); }} aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}><Bookmark size={16} fill={saved ? "currentColor" : "none"} /></button>
      {notice && <div className="toast" role="status"><Check size={14} /> {notice}</div>}

      {showImage && <div className="image-modal" role="dialog" aria-modal="true" aria-label="Card inspection" onClick={() => setShowImage(false)}><button className="image-modal__close" onClick={() => setShowImage(false)} aria-label="Close card inspection"><X size={19} /></button><div className="hero-card hero-card--large" onClick={(event) => event.stopPropagation()}><span className="hero-card__label">SM168 · TAG TEAM · HP 240</span><span className="hero-card__name">PIKACHU &amp; ZEKROM GX</span><span className="hero-card__power">FULL BLITZ 150</span><span className="hero-card__shine" /></div><p>Tap outside to close · verified identity match</p></div>}
    </main>
  );
}