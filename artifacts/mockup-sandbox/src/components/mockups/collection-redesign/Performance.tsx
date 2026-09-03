import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight, BarChart3, Bell, ChevronDown, ChevronRight,
  CircleDollarSign, Filter, Grid2X2, Heart, Home, Layers3, List, MoreHorizontal,
  Plus, Search, Sparkles, TrendingUp, UserRound, Users, Wallet, X
} from "lucide-react";
import "./_group.css";
import "./Performance.css";

type Card = {
  id: number; name: string; set: string; number: string; value: number;
  cost: number; gain: number; grade?: string; art: string; status?: string;
};

const cards: Card[] = [
  { id: 1, name: "Charizard ex", set: "Pokémon 151", number: "006/165", value: 482.5, cost: 220, gain: 119.3, grade: "PSA 10", art: "from-orange-400 via-red-700 to-[#15131a]", status: "For sale" },
  { id: 2, name: "Pikachu VMAX", set: "Vivid Voltage", number: "188/185", value: 310, cost: 165, gain: 87.9, grade: "PSA 9", art: "from-yellow-300 via-amber-500 to-indigo-950", status: "Trade" },
  { id: 3, name: "Gengar VMAX", set: "Fusion Strike", number: "271/264", value: 196.25, cost: 96, gain: 104.4, art: "from-violet-600 via-fuchsia-900 to-[#16121c]" },
  { id: 4, name: "Blastoise ex", set: "Pokémon 151", number: "009/165", value: 88, cost: 75, gain: 17.3, grade: "CGC 9.5", art: "from-cyan-400 via-blue-700 to-slate-950" },
  { id: 5, name: "Umbreon VMAX", set: "Evolving Skies", number: "215/203", value: 742, cost: 410, gain: 81, grade: "PSA 10", art: "from-slate-400 via-indigo-950 to-black", status: "For sale" },
  { id: 6, name: "Mew ex", set: "Paldean Fates", number: "232/091", value: 126, cost: 142, gain: -11.3, art: "from-pink-300 via-rose-600 to-purple-950" },
];

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return <button aria-label={label} onClick={onClick} className="grid h-9 w-9 place-items-center rounded-full border border-[#29282b] bg-[#18181b] text-[#f4f1e8] transition-transform active:scale-95">{children}</button>;
}

function MiniArt({ card }: { card: Card }) {
  return <div className={`relative aspect-[.72] overflow-hidden rounded-[11px] border border-white/20 bg-gradient-to-br ${card.art}`}>
    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(circle at 28% 20%,rgba(255,255,255,.8),transparent 17%), linear-gradient(135deg,transparent 43%,rgba(255,255,255,.42) 50%,transparent 57%)" }} />
    <span className="absolute left-2 top-9 text-xl font-black italic tracking-tight text-white/75">{card.name.split(" ")[0]}</span>
    {card.grade && <span className="absolute right-1.5 top-1.5 rounded-sm border-2 border-[#ef5c68] bg-[#fffdf8] px-1 text-[7px] font-black leading-3 text-[#e24b58]">{card.grade}</span>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-7"><p className="truncate text-[11px] font-bold">{card.name}</p><p className="truncate text-[9px] text-white/65">{card.set}</p></div>
  </div>;
}

export function Performance() {
  const [summaryMode, setSummaryMode] = useState<"worth" | "performance">("worth");
  const [range, setRange] = useState("30D");
  const [grid, setGrid] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<number[]>([2, 5]);
  const [showAll, setShowAll] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState("Value");

  const visible = useMemo(() => cards
    .filter(c => `${c.name} ${c.set}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "Gain" ? b.gain - a.gain : sort === "Name" ? a.name.localeCompare(b.name) : b.value - a.value)
    .slice(0, showAll ? cards.length : 4), [query, showAll, sort]);
  const totals = useMemo(() => {
    const value = cards.reduce((sum, card) => sum + card.value, 0);
    const cost = cards.reduce((sum, card) => sum + card.cost, 0);
    const gain = value - cost;
    return { value, cost, gain, gainPercent: cost > 0 ? (gain / cost) * 100 : 0 };
  }, []);
  const signalColor = summaryMode === "performance"
    ? totals.gain >= 0 ? "#42c982" : "#ff5967"
    : "#ff1e2d";
  const formatMoney = (value: number) => `AUD ${value.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

  return <main className="vtcg-collection min-h-[100dvh] pb-24 text-[#f4f1e8]">
    <div className="mx-auto max-w-[430px] overflow-hidden">
      <header className="flex items-center justify-between px-5 pb-5 pt-8">
        <div><p className="text-[9px] font-bold tracking-[1.5px] text-[#7d7a7d]">SATURDAY · 18 MAY 2024</p><h1 className="tcg-display mt-1 text-[34px] font-bold leading-none tracking-[-.8px] text-[#f4f1e8]">YOUR PORTFOLIO</h1></div>
        <div className="flex gap-2"><IconButton label="Search" onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <X size={16}/> : <Search size={16}/>}</IconButton><IconButton label="Notifications"><Bell size={16}/></IconButton></div>
      </header>
      {searchOpen && <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-[#3b2a2d] bg-[#18181b] px-3 py-2"><Search size={14} className="text-[#7d7a7d]"/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your cards" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#656166]"/>{query && <button onClick={() => setQuery("")}><X size={14}/></button>}</div>}

       <section className="mx-5 rounded-[18px] border border-[#3b2a2d] bg-[#18181b] p-5 shadow-[0_16px_45px_rgba(0,0,0,.28)]">
         <div className="summary-switch" role="tablist" aria-label="Portfolio summary">
           <button className={summaryMode === "worth" ? "summary-tab active" : "summary-tab"} onClick={() => setSummaryMode("worth")} role="tab" aria-selected={summaryMode === "worth"}>Portfolio worth</button>
           <button className={summaryMode === "performance" ? "summary-tab active" : "summary-tab"} onClick={() => setSummaryMode("performance")} role="tab" aria-selected={summaryMode === "performance"}>Performance</button>
         </div>
         <div className="mt-5 flex items-start justify-between"><div><p className="text-[11px] font-medium text-[#b2a4a5]">{summaryMode === "worth" ? "Collection value" : "Gain against purchase cost"}</p><p className="mt-1 text-[32px] font-extrabold tracking-[-1.5px]" style={{ color: summaryMode === "performance" ? signalColor : "#f4f1e8" }}>{summaryMode === "worth" ? formatMoney(totals.value) : `${totals.gain >= 0 ? "+" : "-"}${formatMoney(Math.abs(totals.gain))}`}</p><p className="mt-1 text-[11px] text-[#b2a4a5]">{summaryMode === "worth" ? "Current market value across 6 holdings" : `${totals.gain >= 0 ? "+" : ""}${totals.gainPercent.toFixed(1)}% return on AUD ${totals.cost.toLocaleString("en-AU", { minimumFractionDigits: 2 })} paid`}</p></div><div className="rounded-full p-2.5" style={{ backgroundColor: `${signalColor}26`, color: signalColor }}>{summaryMode === "worth" ? <Wallet size={18}/> : totals.gain >= 0 ? <TrendingUp size={18}/> : <ArrowUpRight className="rotate-90" size={18}/>}</div></div>
        <div className="mt-5 h-[92px]">
           <svg viewBox="0 0 380 92" className="h-full w-full" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={signalColor} stopOpacity=".25"/><stop offset="1" stopColor={signalColor} stopOpacity="0"/></linearGradient></defs><path d="M0 77 C25 71 24 63 48 68 S75 51 97 58 S123 44 145 49 S168 30 191 39 S214 24 238 31 S265 15 287 25 S316 10 340 18 S363 4 380 8 V92 H0Z" fill="url(#area)"/><path d="M0 77 C25 71 24 63 48 68 S75 51 97 58 S123 44 145 49 S168 30 191 39 S214 24 238 31 S265 15 287 25 S316 10 340 18 S363 4 380 8" fill="none" stroke={signalColor} strokeWidth="2.5"/></svg>
        </div>
         <div className="mt-3 flex items-center justify-between border-t border-[#3b2a2d] pt-3"><span className="flex items-center gap-1 text-xs font-bold" style={{ color: signalColor }}>{totals.gain >= 0 ? <ArrowUpRight size={14}/> : <ArrowUpRight className="rotate-90" size={14}/>} {summaryMode === "worth" ? `${totals.gain >= 0 ? "+" : "-"}${formatMoney(Math.abs(totals.gain))}` : `${totals.gain >= 0 ? "+" : "-"}${formatMoney(Math.abs(totals.gain))}`} <em className="font-normal not-italic text-[#b2a4a5]">({totals.gain >= 0 ? "+" : ""}{totals.gainPercent.toFixed(1)}% all time)</em></span><span className="text-[10px] text-[#7d7a7d]">Last synced 2h ago</span></div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 px-5">
         <div className="rounded-2xl border border-[#29282b] bg-[#18181b] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-[#7d7a7d]">{summaryMode === "worth" ? "Net performance" : "Paid vs. worth"}</span>{summaryMode === "worth" ? <TrendingUp size={16} style={{ color: signalColor }}/> : <CircleDollarSign size={16} className="text-[#d8ae68]"/>}</div><p className="text-xl font-extrabold" style={{ color: signalColor }}>{summaryMode === "worth" ? `${totals.gain >= 0 ? "+" : "-"}${formatMoney(Math.abs(totals.gain))}` : formatMoney(totals.value)}</p><p className="mt-1 text-[10px] text-[#7d7a7d]">{summaryMode === "worth" ? `${totals.gain >= 0 ? "+" : ""}${totals.gainPercent.toFixed(1)}% since purchase` : `Paid ${formatMoney(totals.cost)}`}</p></div>
         <div className="rounded-2xl border border-[#29282b] bg-[#18181b] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-[#7d7a7d]">Cards owned</span><CircleDollarSign size={16} className="text-[#f59e0b]"/></div><p className="text-xl font-extrabold text-[#f4f1e8]">06 <span className="text-sm font-normal text-[#7d7a7d]">cards</span></p><p className="mt-1 text-[10px] text-[#7d7a7d]">{summaryMode === "worth" ? `${formatMoney(totals.value / cards.length)} avg. value` : `${formatMoney(totals.cost / cards.length)} avg. paid`}</p></div>
      </div>

       <section className="mx-5 mt-7"><div className="mb-3 flex items-end justify-between"><div><p className="text-[10px] font-bold tracking-[1.3px] text-[#7d7a7d]">PERFORMANCE</p><h2 className="tcg-display mt-1 text-[22px] font-bold tracking-tight">A HEALTHY CLIMB</h2></div><button className="flex items-center gap-1 rounded-full border border-[#3b2a2d] bg-[#18181b] px-2.5 py-1.5 text-[10px] font-bold text-[#ff9ca4]"><Sparkles size={12}/> Insights</button></div>
         <div className="flex rounded-lg bg-[#18181b] p-1">{["7D","30D","90D","1Y","ALL"].map(x => <button key={x} onClick={() => setRange(x)} className={`flex-1 rounded-md py-1.5 text-[10px] font-bold ${range === x ? "bg-[#ff1e2d] text-[#fff8f2]" : "text-[#7d7a7d]"}`}>{x}</button>)}</div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-[#29282b] bg-[#18181b] px-3 py-3"><div><p className="text-[10px] text-[#7d7a7d]">{summaryMode === "worth" ? `Best performer this ${range}` : "Largest gain against cost"}</p><p className="mt-0.5 text-sm font-bold">Gengar VMAX</p></div><span className="flex items-center gap-1 text-sm font-extrabold text-[#42c982]"><ArrowUpRight size={15}/> +AUD 100.25</span></div>
      </section>

       <section className="mt-8 px-5"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[1.3px] text-[#7d7a7d]">THE VAULT</p><h2 className="tcg-display mt-1 text-[22px] font-bold">YOUR CARDS <span className="font-sans text-sm font-normal text-[#7d7a7d]">· {cards.length}</span></h2></div><button className="flex items-center gap-1 text-[11px] font-bold text-[#ff9ca4]">View all <ChevronRight size={14}/></button></div>
         <div className="mb-4 flex items-center justify-between"><div className="flex gap-2"><button onClick={() => setSortOpen(!sortOpen)} className="flex items-center gap-1 rounded-full border border-[#3b2a2d] bg-[#18181b] px-3 py-1.5 text-[10px] font-bold"><Filter size={12} className="text-[#ff9ca4]"/> {sort}<ChevronDown size={11}/></button>{sortOpen && <div className="absolute z-10 mt-8 rounded-xl border border-[#3b2a2d] bg-[#1a1a1a] p-1 shadow-xl">{["Value","Gain","Name"].map(x => <button key={x} onClick={() => {setSort(x); setSortOpen(false)}} className="block w-full rounded-lg px-4 py-2 text-left text-xs hover:bg-[#2a2022]">{x}</button>)}</div>}</div><div className="flex rounded-md border border-[#29282b] bg-[#18181b] p-0.5"><button onClick={() => setGrid(true)} className={`grid h-6 w-6 place-items-center rounded ${grid ? "bg-[#383438] text-[#ff9ca4]" : "text-[#7d7a7d]"}`}><Grid2X2 size={13}/></button><button onClick={() => setGrid(false)} className={`grid h-6 w-6 place-items-center rounded ${!grid ? "bg-[#383438] text-[#ff9ca4]" : "text-[#7d7a7d]"}`}><List size={13}/></button></div></div>
          {grid ? <div className="grid grid-cols-2 gap-3">{visible.map(card => { const gain = card.value - card.cost; const positive = gain >= 0; return <article key={card.id}><div className="relative"><MiniArt card={card}/><button aria-label={`Save ${card.name}`} onClick={() => setSaved(s => s.includes(card.id) ? s.filter(x => x !== card.id) : [...s, card.id])} className={`absolute right-2 top-2 rounded-full p-1.5 ${saved.includes(card.id) ? "bg-[#ff1e2d] text-[#fff8f2]" : "bg-black/50 text-white"}`}><Heart size={12} fill={saved.includes(card.id) ? "currentColor" : "none"}/></button></div><div className="mt-2 flex items-center justify-between"><span className="text-xs font-bold">AUD {card.value.toLocaleString("en-AU", { minimumFractionDigits: 2 })}</span><span className={`text-[10px] font-bold ${positive ? "gain-positive" : "gain-negative"}`}>{positive ? "+" : "-"}AUD {Math.abs(gain).toLocaleString("en-AU", { minimumFractionDigits: 2 })}</span></div>{card.status && <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[#b2a4a5]">{card.status}</p>}</article>})}</div> : <div className="space-y-2">{visible.map(card => { const gain = card.value - card.cost; const positive = gain >= 0; return <article key={card.id} className="flex items-center gap-3 rounded-xl border border-[#29282b] bg-[#18181b] p-2"><div className="w-12 shrink-0"><MiniArt card={card}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{card.name}</p><p className="text-[10px] text-[#7d7a7d]">{card.set} · {card.grade || "Near mint"}</p></div><div className="text-right"><p className="text-xs font-bold">AUD {card.value.toLocaleString("en-AU", { minimumFractionDigits: 2 })}</p><p className={`text-[10px] font-bold ${positive ? "gain-positive" : "gain-negative"}`}>{positive ? "+" : "-"}AUD {Math.abs(gain).toLocaleString("en-AU", { minimumFractionDigits: 2 })}</p></div><MoreHorizontal size={15} className="text-[#7d7a7d]"/></article>})}</div>}
         {!showAll && <button onClick={() => setShowAll(true)} className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-[#7d2f39] py-3 text-xs font-bold text-[#ff9ca4]"><Plus size={14}/> Show all cards</button>}
      </section>
       <div className="mx-5 mt-7 flex items-center gap-3 rounded-xl border border-[#29282b] bg-[#18181b] p-3"><BarChart3 size={20} className="text-[#ff9ca4]"/><p className="flex-1 text-[11px] leading-4 text-[#b2a4a5]">Prices are sourced from recent market sales. <span className="font-bold text-[#f4f1e8]">View methodology</span></p><ChevronRight size={15} className="text-[#7d7a7d]"/></div>
       <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-[72px] max-w-[430px] items-center justify-around border-t border-[#29282b] bg-[#0d0d0f]/95 px-3 backdrop-blur" aria-label="Primary navigation">
         {[[Home, "Home"], [TrendingUp, "Market"], [Layers3, "Collection"], [Users, "Community"], [UserRound, "Profile"]].map(([Icon, label]) => (
           <button key={label as string} className={`flex min-w-[54px] flex-col items-center gap-1 py-2 text-[9px] font-bold ${label === "Collection" ? "text-[#ff1e2d]" : "text-[#7d7a7d]"}`} aria-current={label === "Collection" ? "page" : undefined}>
             <Icon size={18} />
             <span>{label as string}</span>
           </button>
         ))}
       </nav>
    </div>
  </main>;
}