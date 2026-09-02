import { useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Check, ChevronRight, Eye, Heart, Info, MoreHorizontal, Package, Share2, Sparkles, TrendingUp } from "lucide-react";

type Lens = "overview" | "market" | "vault";
type Copy = { id: string; label: string; note: string; price: string; color: string; owned: boolean };

const copies: Copy[] = [
  { id: "raw", label: "Raw", note: "Near mint · ungraded", price: "$225.01", color: "#d8a64c", owned: false },
  { id: "psa9", label: "PSA 9", note: "Pop. 2,916 · exact match", price: "$1,480", color: "#8e9ab4", owned: false },
  { id: "psa10", label: "PSA 10", note: "Pop. 536 · exact match", price: "$3,648.74", color: "#cba24f", owned: true },
  { id: "bgs95", label: "BGS 9.5", note: "Pop. 188 · subgrades", price: "$2,090", color: "#5f80a7", owned: false },
];

function MiniSparkline() {
  return (
    <svg viewBox="0 0 160 42" className="orbit-spark" aria-label="Price rose 12.4 percent over three months">
      <path d="M2 34 C18 32 20 24 34 28 S52 18 65 22 S80 27 92 15 S108 18 120 10 S139 13 158 3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M2 34 C18 32 20 24 34 28 S52 18 65 22 S80 27 92 15 S108 18 120 10 S139 13 158 3 V42 H2Z" fill="currentColor" opacity=".1" />
    </svg>
  );
}

export function CardDetailOrbit() {
  const [lens, setLens] = useState<Lens>("overview");
  const [selected, setSelected] = useState("psa10");
  const [saved, setSaved] = useState(false);
  const [watching, setWatching] = useState(false);
  const [toast, setToast] = useState("");
  const [qty, setQty] = useState(1);
  const current = useMemo(() => copies.find((copy) => copy.id === selected) ?? copies[2], [selected]);
  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };

  return (
    <main className="orbit-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
        .orbit-shell{--ink:#16202c;--muted:#6d7784;--paper:#f5f1e9;--panel:#fffdf8;--line:#e6dfd2;--coral:#d84b43;--blue:#244d68;min-height:100dvh;background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',sans-serif;padding:18px 18px 92px;letter-spacing:-.02em}
        .orbit-shell *{box-sizing:border-box}.orbit-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.orbit-icon{border:1px solid var(--line);background:var(--panel);width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--ink);cursor:pointer}.orbit-actions{display:flex;gap:8px}
        .orbit-eyebrow{font:500 10px 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--coral)}.orbit-title{font-size:28px;line-height:1.08;margin:5px 0 4px;font-weight:800}.orbit-subtitle{margin:0;color:var(--muted);font-size:12px}
        .orbit-passport{background:#192b3a;border-radius:22px;min-height:218px;position:relative;overflow:hidden;padding:22px;color:#f8f0de;margin:20px 0 16px;box-shadow:0 14px 30px #1a2b3a20}.orbit-passport:before{content:"";position:absolute;width:210px;height:210px;border:1px solid #e7b85b55;border-radius:50%;right:-72px;top:-65px}.orbit-passport:after{content:"";position:absolute;width:148px;height:148px;border:1px solid #e7b85b35;border-radius:50%;right:-30px;top:-34px}.orbit-cardname{position:relative;z-index:1;font-size:37px;font-weight:800;line-height:.94;max-width:210px;margin-top:28px}.orbit-cardname span{display:block;color:#edbd5b}.orbit-meta{position:absolute;bottom:19px;left:22px;display:flex;gap:18px;color:#bfcbd0;font:10px 'DM Mono',monospace}.orbit-stamp{position:absolute;right:21px;bottom:18px;color:#e7b85b;font:500 10px 'DM Mono',monospace;border:1px solid #e7b85b88;padding:7px 8px;border-radius:5px;transform:rotate(-7deg)}
        .orbit-lenses{display:flex;gap:4px;background:#e9e2d7;padding:4px;border-radius:11px;margin-bottom:16px}.orbit-lenses button{flex:1;border:0;background:transparent;padding:10px 4px;border-radius:8px;color:var(--muted);font-size:11px;font-weight:700;cursor:pointer}.orbit-lenses button.active{background:var(--panel);color:var(--ink);box-shadow:0 2px 5px #3e332015}
        .orbit-panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:17px;margin-bottom:12px}.orbit-panel-head{display:flex;justify-content:space-between;align-items:start;margin-bottom:15px}.orbit-panel h2{font-size:14px;margin:0;font-weight:800}.orbit-panel small{color:var(--muted);font-size:10px}.orbit-price{font-size:29px;font-weight:800;margin-top:4px}.orbit-delta{color:#438263;font:500 11px 'DM Mono',monospace}.orbit-chart-wrap{display:flex;align-items:end;gap:8px}.orbit-spark{width:100%;height:58px;color:var(--coral)}.orbit-chart-note{font-size:10px;color:var(--muted);white-space:nowrap}.orbit-chart-note strong{display:block;color:var(--ink);font-size:14px;margin-bottom:3px}
        .orbit-copy-list{display:grid;gap:7px}.orbit-copy{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--line);background:#fffdf8;padding:11px;border-radius:11px;cursor:pointer}.orbit-copy.selected{border-color:var(--coral);background:#fff8f1;box-shadow:inset 3px 0 var(--coral)}.orbit-grade{width:31px;height:31px;border-radius:7px;display:grid;place-items:center;font:500 9px 'DM Mono',monospace;color:#fff;background:var(--blue)}.orbit-copy:nth-child(1) .orbit-grade{color:#322817}.orbit-copy-copy{flex:1}.orbit-copy-copy strong{font-size:12px;display:block}.orbit-copy-copy small{font-size:9px;display:block;margin-top:2px}.orbit-copy-price{text-align:right;font:500 12px 'DM Mono',monospace}.orbit-owned{display:block;color:#438263;font-size:9px;margin-top:4px}
        .orbit-insight{background:#f0e9dc;border-radius:14px;padding:14px;display:flex;gap:11px;align-items:start}.orbit-insight svg{color:var(--coral);flex:none}.orbit-insight strong{font-size:11px;display:block;margin-bottom:3px}.orbit-insight p{font-size:11px;line-height:1.45;color:#5e655f;margin:0}.orbit-button{width:100%;border:0;background:var(--coral);color:#fff8ef;font-weight:800;border-radius:11px;padding:13px;cursor:pointer;margin-top:12px}.orbit-button.secondary{background:transparent;color:var(--blue);border:1px solid var(--blue)}.orbit-footer{position:fixed;bottom:0;left:0;right:0;background:#fffdf8eF;border-top:1px solid var(--line);backdrop-filter:blur(10px);padding:11px 18px;display:flex;gap:9px;z-index:3}.orbit-footer button{margin:0}.orbit-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff8ef;padding:10px 15px;border-radius:20px;font-size:11px;z-index:5;box-shadow:0 8px 20px #0002}.orbit-vault-row{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:12px 0;font-size:12px}.orbit-vault-row:last-child{border:0}.orbit-vault-row span{color:var(--muted);font-size:10px}.orbit-qty{display:flex;align-items:center;gap:10px;font-family:'DM Mono',monospace}.orbit-qty button{border:1px solid var(--line);background:transparent;border-radius:50%;width:25px;height:25px;cursor:pointer}.orbit-footer .orbit-button{flex:1}.orbit-footer .orbit-icon{width:44px;border-radius:11px}
      `}</style>
      {toast && <div className="orbit-toast" role="status">{toast}</div>}
      <header className="orbit-top">
        <button className="orbit-icon" onClick={() => announce("Back to collection")} aria-label="Go back"><ArrowLeft size={17} /></button>
        <div className="orbit-actions">
          <button className="orbit-icon" onClick={() => { setSaved(!saved); announce(saved ? "Removed from saved cards" : "Saved to watchlist"); }} aria-label="Save card"><Bookmark size={16} fill={saved ? "currentColor" : "none"} /></button>
          <button className="orbit-icon" onClick={() => announce("Share sheet ready")} aria-label="Share card"><Share2 size={16} /></button>
          <button className="orbit-icon" onClick={() => announce("More options")} aria-label="More options"><MoreHorizontal size={17} /></button>
        </div>
      </header>
      <section>
        <div className="orbit-eyebrow">Card passport · verified</div>
        <h1 className="orbit-title">Pikachu &amp; Zekrom GX</h1>
        <p className="orbit-subtitle">SM168 · Sun &amp; Moon promo · TAG TEAM</p>
      </section>
      <section className="orbit-passport" aria-label="Pikachu and Zekrom GX card preview">
        <div className="orbit-eyebrow" style={{ color: "#e7b85b" }}>Full art / ultra rare</div>
        <div className="orbit-cardname">PIKACHU <span>+ ZEKROM</span></div>
        <div className="orbit-meta"><span>HP 240</span><span>LIGHTNING</span><span>2019</span></div>
        <div className="orbit-stamp">AUTHENTIC</div>
      </section>
      <nav className="orbit-lenses" aria-label="Card detail views">
        {(["overview", "market", "vault"] as Lens[]).map((item) => <button className={lens === item ? "active" : ""} key={item} onClick={() => setLens(item)}>{item === "overview" ? "Snapshot" : item === "market" ? "Market pulse" : "Your vault"}</button>)}
      </nav>
      {lens === "overview" && <>
        <section className="orbit-panel">
          <div className="orbit-panel-head"><div><h2>Current value</h2><div className="orbit-price">{current.price}</div></div><div style={{ textAlign: "right" }}><div className="orbit-delta">+12.4%</div><small>since last refresh</small></div></div>
          <div className="orbit-chart-wrap"><div className="orbit-chart-note"><strong>3 month trend</strong>steady climb</div><MiniSparkline /></div>
        </section>
        <section className="orbit-panel">
          <div className="orbit-panel-head"><div><h2>Choose a copy</h2><small>Compare the versions you could own</small></div><Eye size={16} color="#6d7784" /></div>
          <div className="orbit-copy-list">{copies.map((copy) => <button className={`orbit-copy ${selected === copy.id ? "selected" : ""}`} key={copy.id} onClick={() => { setSelected(copy.id); announce(`${copy.label} selected`); }}><span className="orbit-grade" style={{ background: copy.color }}>{copy.label === "Raw" ? "RAW" : copy.label.split(" ")[0]}</span><span className="orbit-copy-copy"><strong>{copy.label}</strong><small>{copy.note}</small></span><span className="orbit-copy-price">{copy.price}{copy.owned && <span className="orbit-owned">in your vault</span>}</span></button>)}</div>
        </section>
        <div className="orbit-insight"><Sparkles size={17} /><div><strong>Smart trade insight</strong><p>Your PSA 10 is up $402 since you added it. Similar copies are moving fastest in the $3.4k–$3.8k band.</p></div></div>
      </>}
      {lens === "market" && <section className="orbit-panel"><div className="orbit-panel-head"><div><h2>Market pulse</h2><small>Verified sales · refreshed 8 min ago</small></div><TrendingUp size={17} color="#438263" /></div><div className="orbit-vault-row"><div><strong>Median sale</strong><br /><span>Last 30 days · 42 sales</span></div><b>$3,540</b></div><div className="orbit-vault-row"><div><strong>Fastest movement</strong><br /><span>PSA 10 · +18.2% volume</span></div><b style={{ color: "#438263" }}>+12.4%</b></div><div className="orbit-vault-row"><div><strong>Liquidity</strong><br /><span>Average time to sell</span></div><b>6.4 days</b></div><button className="orbit-button secondary" onClick={() => announce("Opening all verified sales")}>View verified sales <ChevronRight size={14} style={{ verticalAlign: "middle" }} /></button></section>}
      {lens === "vault" && <section className="orbit-panel"><div className="orbit-panel-head"><div><h2>In your vault</h2><small>Track copies and personal cost basis</small></div><Package size={17} color="#244d68" /></div><div className="orbit-vault-row"><div><strong>PSA 10</strong><br /><span>Added 14 Aug 2024 · cost basis $3,246</span></div><div className="orbit-qty"><button onClick={() => setQty(Math.max(0, qty - 1))}>−</button>{qty}<button onClick={() => setQty(qty + 1)}>+</button></div></div><div className="orbit-vault-row"><span>Current value</span><b>{qty ? "$3,648.74" : "—"}</b></div><button className="orbit-button secondary" onClick={() => announce("Copy details saved")}>{qty ? <><Check size={14} style={{ verticalAlign: "middle" }} /> Vault updated</> : "Add this copy to vault"}</button></section>}
      <footer className="orbit-footer"><button className="orbit-icon" onClick={() => { setWatching(!watching); announce(watching ? "Price alerts off" : "Price alerts on"); }} aria-label="Toggle price alerts"><Heart size={17} fill={watching ? "currentColor" : "none"} /></button><button className="orbit-button" onClick={() => announce(`Trade matches for ${current.label} opened`)}>Find trade matches <ChevronRight size={15} style={{ verticalAlign: "middle" }} /></button></footer>
    </main>
  );
}