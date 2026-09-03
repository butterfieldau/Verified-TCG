import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  Filter,
  Folder,
  Grid2X2,
  Heart,
  Home,
  Layers3,
  List,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";

type Card = {
  id: number;
  name: string;
  set: string;
  number: string;
  value: number;
  cost: number;
  grade?: string;
  grader?: string;
  sale?: boolean;
  trade?: boolean;
  change: number;
  art: string;
};

const cards: Card[] = [
  { id: 1, name: "Charizard ex", set: "Pokémon 151", number: "006/165", value: 482.5, cost: 220, grade: "10", grader: "PSA", sale: true, change: 18.4, art: "linear-gradient(145deg,#ee7b35,#a3132d 46%,#11131c)" },
  { id: 2, name: "Pikachu VMAX", set: "Vivid Voltage", number: "188/185", value: 310, cost: 165, grade: "9", grader: "PSA", trade: true, change: 7.2, art: "linear-gradient(145deg,#f7d65a,#b16b1d 42%,#272051)" },
  { id: 3, name: "Gengar VMAX", set: "Fusion Strike", number: "271/264", value: 196.25, cost: 96, change: 11.8, art: "linear-gradient(145deg,#8d54c6,#54146e 48%,#12121e)" },
  { id: 4, name: "Blastoise ex", set: "Pokémon 151", number: "009/165", value: 88, cost: 75, grade: "9.5", grader: "CGC", change: -2.1, art: "linear-gradient(145deg,#5be2dc,#165da9 50%,#111a2b)" },
  { id: 5, name: "Umbreon VMAX", set: "Evolving Skies", number: "215/203", value: 742, cost: 410, grade: "10", grader: "PSA", sale: true, change: 23.5, art: "linear-gradient(145deg,#a8a5aa,#29305c 42%,#08090f)" },
  { id: 6, name: "Mew ex", set: "Paldean Fates", number: "232/091", value: 126, cost: 142, change: -4.8, art: "linear-gradient(145deg,#f6abc2,#c33770 45%,#312055)" },
];

const money = (n: number) => `AUD ${n.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

function Art({ card, small = false }: { card: Card; small?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-[10px] border border-white/20 shadow-[0_12px_22px_rgba(0,0,0,.26)] ${small ? "h-[62px] w-[46px]" : "aspect-[.72] w-full"}`} style={{ background: card.art }}>
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 25% 18%,rgba(255,255,255,.9),transparent 16%),linear-gradient(135deg,transparent 42%,rgba(255,255,255,.38) 49%,transparent 56%)" }} />
      {!small && <><span className="absolute left-2 top-[27%] -rotate-6 text-[21px] font-black italic tracking-[-1px] text-white/75">{card.name.split(" ")[0]}</span><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent px-2 pb-2 pt-8"><p className="truncate text-[11px] font-bold">{card.name}</p><p className="truncate text-[9px] text-white/65">{card.set} · {card.number}</p></div></>}
      {card.grade && <span className={`absolute right-1.5 top-1.5 rounded-[3px] border-2 bg-[#fffaf0] px-1 py-0.5 text-center text-[7px] font-black leading-[8px] ${card.grader === "CGC" ? "border-[#4089c8] text-[#4089c8]" : "border-[#ef3340] text-[#df3948]"}`}><b className="block text-[5px]">{card.grader}</b><i className="text-[10px] not-italic text-zinc-900">{card.grade}</i></span>}
    </div>
  );
}

export function CompactVault() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("Value");
  const [ascending, setAscending] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [summary, setSummary] = useState<"worth" | "performance">("worth");
  const [range, setRange] = useState("1M");
  const [saved, setSaved] = useState<number[]>([2, 5]);
  const [list, setList] = useState("Main");
  const [sheet, setSheet] = useState<"filter" | "sort" | "list" | null>(null);
  const [detail, setDetail] = useState<Card | null>(null);
  const [toast, setToast] = useState("");
  const [showValue, setShowValue] = useState(true);
  const [more, setMore] = useState(false);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 1900); };
  const totals = useMemo(() => cards.reduce((a, c) => ({ value: a.value + c.value, cost: a.cost + c.cost }), { value: 0, cost: 0 }), []);
  const results = useMemo(() => cards.filter(c => {
    const text = `${c.name} ${c.set} ${c.number}`.toLowerCase();
    const match = !query || text.includes(query.toLowerCase());
    const type = filter === "All" || filter === "Pokémon" || (filter === "Graded" && c.grade) || (filter === "Raw" && !c.grade) || (filter === "For Sale" && c.sale) || (filter === "For Trade" && c.trade);
    return match && type;
  }).sort((a, b) => {
    const direction = ascending ? 1 : -1;
    if (sort === "Name") return a.name.localeCompare(b.name) * direction;
    if (sort === "Gain") return (a.value - a.cost - (b.value - b.cost)) * direction;
    return (a.value - b.value) * direction;
  }), [filter, query, sort, ascending]);

  const chips = ["All", "Pokémon", "Graded", "Raw", "For Sale", "For Trade"];
  const filters = ["Price range", "Set / series", "Condition", "Grading company", "Acquisition date", "Market coverage"];

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#121315] pb-24 text-[#f5efe3]" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto max-w-[430px]">
        <header className="sticky top-0 z-20 border-b border-[#2b2d31] bg-[#121315]/95 px-4 pb-3 pt-5 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[#36383e] bg-[#1b1d20] px-3.5 py-2.5">
              <Search size={16} className="text-[#b2aaa0]" />
              <input aria-label="Search your collection" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cards, sets, numbers" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#77777a]" />
              {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={15} className="text-[#d9d0c4]" /></button>}
            </div>
            <button aria-label="Open filters" onClick={() => setSheet("filter")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#5b3940] bg-[#2a1b20] text-[#fa7180]"><SlidersHorizontal size={17} /></button>
          </div>
        </header>

        <section className="px-4 pb-5 pt-5">
          <div className="flex items-start justify-between">
            <div><p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[#8f8b87]">THE VAULT · {list}</p><h1 className="mt-1 text-[28px] font-black tracking-[-1.3px]">YOUR COLLECTION</h1></div>
            <button onClick={() => notify("Card intake opened")} className="grid h-10 w-10 place-items-center rounded-full bg-[#ed4b5c] text-[#201417]"><Plus size={19} /></button>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <div><p className="text-[10px] uppercase tracking-[1.4px]">{summary === "worth" ? "Market value" : `Performance · ${range}`}</p><p className={`mt-1 text-[31px] font-black tracking-[-1.5px] ${summary === "performance" ? "text-[#62d994]" : ""}`}>{showValue ? summary === "worth" ? money(totals.value) : `+${money(totals.value - totals.cost)}` : "AUD ••••••"}</p></div>
            <button aria-label="Toggle value visibility" onClick={() => setShowValue(v => !v)} className="mb-1 grid h-7 w-7 place-items-center rounded-full bg-[#292b2f] text-[#a5a0a0]"><Eye size={14} /></button>
            <span className={`mb-2 ml-auto flex items-center gap-1 text-[11px] font-bold ${summary === "performance" ? "text-[#62d994]" : "text-[#58d28c]"}`}><TrendingUp size={13} /> +{((totals.value - totals.cost) / totals.cost * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-3 flex items-center rounded-lg border border-[#34363b] bg-[#1a1c1f] p-0.5" role="tablist" aria-label="Portfolio summary mode">
            <button onClick={() => setSummary("worth")} role="tab" aria-selected={summary === "worth"} className={`flex-1 rounded-md py-1.5 text-[10px] font-bold ${summary === "worth" ? "bg-[#393438] text-[#f5efe3]" : "text-[#8d8a88]"}`}>Collection worth</button>
            <button onClick={() => setSummary("performance")} role="tab" aria-selected={summary === "performance"} className={`flex-1 rounded-md py-1.5 text-[10px] font-bold ${summary === "performance" ? "bg-[#234632] text-[#81e3a5]" : "text-[#8d8a88]"}`}>Performance</button>
          </div>
          {summary === "performance" && <div className="mt-2 rounded-xl border border-[#35463e] bg-[#18261f] px-3 pb-2 pt-2">
            <svg viewBox="0 0 380 48" className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label="Portfolio performance rising over time">
              <defs><linearGradient id="compactVaultPerformanceArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#58d28c" stopOpacity=".28" /><stop offset="1" stopColor="#58d28c" stopOpacity="0" /></linearGradient></defs>
              <path d="M0 41 C25 43 34 31 59 35 S87 23 108 30 S139 17 161 25 S193 15 215 20 S245 8 269 16 S304 5 327 10 S352 2 380 6 V48 H0Z" fill="url(#compactVaultPerformanceArea)" />
              <path d="M0 41 C25 43 34 31 59 35 S87 23 108 30 S139 17 161 25 S193 15 215 20 S245 8 269 16 S304 5 327 10 S352 2 380 6" fill="none" stroke="#58d28c" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="mt-1 flex gap-1">{["7D", "1M", "3M", "1Y", "ALL"].map(item => <button key={item} onClick={() => setRange(item)} className={`flex-1 rounded py-1 text-[9px] font-bold ${range === item ? "bg-[#58d28c] text-[#15231c]" : "text-[#8bb79a]"}`}>{item}</button>)}</div>
          </div>}
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#35463e] bg-[#18261f] px-3 py-2.5"><Sparkles size={14} className="text-[#67d999]" /><p className="text-[10px] text-[#b7c8bc]"><b className="text-[#e0f1e4]">Portfolio pulse.</b> {money(totals.value - totals.cost)} unrealized gain this month.</p></div>
        </section>

        <section className="px-4">
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{chips.map(chip => <button key={chip} onClick={() => setFilter(chip)} className={`shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold ${filter === chip ? "border-[#f05a68] bg-[#ed4b5c] text-[#211417]" : "border-[#35373b] bg-[#1b1d20] text-[#bcb6b0]"}`}>{filter === chip && <Check size={10} className="mr-1 inline" />}{chip}</button>)}</div>
          <div className="mb-4 flex items-center gap-2">
            <button onClick={() => setSheet("list")} className="flex items-center gap-1.5 rounded-lg border border-[#35373b] bg-[#1b1d20] px-2.5 py-2 text-[10px] font-bold"><Folder size={13} className="text-[#e5b65d]" />{list}<ChevronDown size={11} /></button>
            <button onClick={() => setSheet("sort")} className="flex items-center gap-1.5 rounded-lg border border-[#35373b] bg-[#1b1d20] px-2.5 py-2 text-[10px] font-bold"><ArrowDown size={12} className="text-[#e5b65d]" />{sort}</button>
            <span className="ml-auto text-[10px] text-[#85858a]">{results.length} cards</span>
            <div className="flex rounded-lg border border-[#35373b] bg-[#1b1d20] p-0.5"><button aria-label="Grid view" onClick={() => setView("grid")} className={`grid h-7 w-7 place-items-center rounded ${view === "grid" ? "bg-[#393438] text-white" : "text-[#77777a]"}`}><Grid2X2 size={14} /></button><button aria-label="List view" onClick={() => setView("list")} className={`grid h-7 w-7 place-items-center rounded ${view === "list" ? "bg-[#393438] text-white" : "text-[#77777a]"}`}><List size={14} /></button></div>
          </div>

          {results.length === 0 ? <div className="rounded-2xl border border-dashed border-[#4a3b3e] px-5 py-14 text-center"><Layers3 className="mx-auto mb-3 text-[#827b7c]" /><p className="font-bold">Nothing in this slice</p><p className="mt-1 text-xs text-[#8e898a]">Try a different filter or search term.</p><button onClick={() => { setFilter("All"); setQuery(""); }} className="mt-4 rounded-lg bg-[#ed4b5c] px-4 py-2 text-xs font-bold text-[#211417]">Reset view</button></div> : view === "grid" ? <div className="grid grid-cols-2 gap-x-3 gap-y-5">{results.map(card => <article key={card.id} className="relative"><button className="block w-full text-left" onClick={() => setDetail(card)}><Art card={card} /></button><button aria-label={`${saved.includes(card.id) ? "Remove from" : "Save to"} wishlist`} onClick={() => { setSaved(s => s.includes(card.id) ? s.filter(id => id !== card.id) : [...s, card.id]); notify(saved.includes(card.id) ? "Removed from wishlist" : "Saved to wishlist"); }} className={`absolute right-2 top-2 rounded-full p-2 ${saved.includes(card.id) ? "bg-[#ed4b5c] text-[#271519]" : "bg-black/55 text-white"}`}><Heart size={13} fill={saved.includes(card.id) ? "currentColor" : "none"} /></button><div className="mt-2 flex items-start justify-between"><div><p className="text-xs font-bold">{money(card.value)}</p><p className={`mt-0.5 text-[10px] font-bold ${card.value >= card.cost ? "text-[#58d28c]" : "text-[#fa7180]"}`}>{card.value >= card.cost ? "+" : "-"}{money(Math.abs(card.value - card.cost))}</p></div>{card.sale && <span className="rounded bg-[#ed4b5c]/15 px-1.5 py-1 text-[8px] font-bold text-[#fa8a96]">FOR SALE</span>}</div></article>)}</div> : <div className="space-y-2">{results.map(card => <article key={card.id} className="flex items-center gap-3 rounded-xl border border-[#303237] bg-[#1a1c1f] p-2"><button onClick={() => setDetail(card)}><Art card={card} small /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{card.name}</p><p className="truncate text-[10px] text-[#87878b]">{card.set} · {card.grade ? `${card.grader} ${card.grade}` : "Raw"}</p><p className={`mt-1 text-[10px] font-bold ${card.change >= 0 ? "text-[#58d28c]" : "text-[#fa7180]"}`}>{card.change >= 0 ? "+" : ""}{card.change.toFixed(1)}% since sync</p></div><div className="text-right"><b className="text-xs">{money(card.value)}</b><button aria-label={`Save ${card.name}`} onClick={() => notify("Wishlist updated")} className="mt-2 block ml-auto text-[#fa7180]"><Heart size={14} fill={saved.includes(card.id) ? "currentColor" : "none"} /></button></div></article>)}</div>}
          <button onClick={() => setMore(v => !v)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#624046] py-3 text-xs font-bold text-[#fa8a96]">{more ? "Showing all cards" : "Load more cards"}<Plus size={14} /></button>
          <div className="my-5 flex items-center gap-3 rounded-xl border border-[#303237] bg-[#1a1c1f] p-3"><Wallet size={17} className="text-[#e5b65d]" /><p className="flex-1 text-[10px] leading-4 text-[#aaa5a1]"><b className="text-[#e8e0d4]">Values are partial.</b> Market coverage is marked per card.</p><MoreHorizontal size={16} className="text-[#78787c]" /></div>
        </section>
      </div>

      {(sheet || detail) && <div className="fixed inset-0 z-40 bg-black/70" onClick={() => { setSheet(null); setDetail(null); }}><div onClick={e => e.stopPropagation()} className="absolute bottom-0 left-1/2 w-full max-w-[430px] rounded-t-[25px] border-t border-[#4a3b3f] bg-[#1a1c1f] p-5">
        {detail ? <><div className="mb-4 flex items-center justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[1.5px] text-[#8c8885]">CARD PASSPORT</p><h2 className="text-2xl font-black">{detail.name}</h2></div><button aria-label="Close card passport" onClick={() => setDetail(null)}><X size={18} /></button></div><div className="flex gap-4"><div className="w-[105px] shrink-0"><Art card={detail} /></div><div className="flex-1"><p className="text-xs text-[#b5aeaa]">{detail.set} · {detail.number}</p><p className="mt-4 text-[10px] uppercase tracking-wider text-[#898487]">Market value</p><p className="text-2xl font-black">{money(detail.value)}</p><p className={`mt-1 text-xs font-bold ${detail.change >= 0 ? "text-[#58d28c]" : "text-[#fa7180]"}`}>{detail.change >= 0 ? "+" : ""}{detail.change.toFixed(1)}% since sync</p><button onClick={() => { notify(`${detail.name} queued for sale`); setDetail(null); }} className="mt-4 rounded-lg bg-[#ed4b5c] px-3 py-2 text-[10px] font-bold text-[#211417]">Sell card</button></div></div></> :
        <><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-black">{sheet === "filter" ? "FILTER VAULT" : sheet === "sort" ? "SORT BY" : "CHOOSE LIST"}</h2><button aria-label="Close controls" onClick={() => setSheet(null)}><X size={18} /></button></div>
          {sheet === "filter" && <><p className="mb-3 text-xs text-[#8f8987]">Stack filters without leaving the list.</p><div className="grid grid-cols-2 gap-2">{filters.map(item => <button key={item} onClick={() => notify(`${item} ready`)} className="flex items-center justify-between rounded-xl border border-[#36383d] p-3 text-left text-xs">{item}<ChevronDown size={14} className="text-[#85858a]" /></button>)}</div><button onClick={() => setSheet(null)} className="mt-5 w-full rounded-xl bg-[#ed4b5c] py-3 text-xs font-bold text-[#211417]">Apply filters</button></>}
          {sheet === "sort" && <div className="space-y-1">{["Value", "Name", "Recent", "Gain"].map(item => <button key={item} onClick={() => { setSort(item); setSheet(null); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm ${sort === item ? "bg-[#322328] text-[#fa8a96]" : ""}`}>{item}{sort === item && <Check size={15} />}</button>)}<button onClick={() => setAscending(v => !v)} className="mt-2 flex w-full items-center gap-2 border-t border-[#36383d] pt-4 text-xs text-[#b8b1ad]">{ascending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{ascending ? "Ascending" : "Descending"}</button></div>}
          {sheet === "list" && <div className="space-y-2">{["Main", "High Value", "Trade Binder"].map((item, i) => <button key={item} onClick={() => { setList(item); setSheet(null); }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${list === item ? "border-[#704049] bg-[#322328]" : "border-[#36383d]"}`}><Folder size={16} className="text-[#e5b65d]" /><span className="flex-1"><b className="block text-xs">{item}</b><small className="text-[10px] text-[#8e8988]">{i === 0 ? "6 cards · AUD 1,944.75" : i === 1 ? "3 cards · AUD 1,534.50" : "2 cards · AUD 506.25"}</small></span>{list === item && <Check size={15} className="text-[#fa7180]" />}</button>)}<button onClick={() => notify("New portfolio list created")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#704049] py-3 text-xs font-bold text-[#fa8a96]"><Plus size={14} />Create portfolio list</button></div>}
        </>}
      </div></div>}
      {toast && <div role="status" className="fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-full border border-[#574047] bg-[#282024] px-4 py-2 text-[11px] font-bold shadow-xl">{toast}</div>}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[70px] max-w-[430px] items-center justify-around border-t border-[#2b2d31] bg-[#131416]/95 px-3 backdrop-blur-xl" aria-label="Primary navigation">{[[Home, "Home"], [TrendingUp, "Market"], [Layers3, "Collection"], [Users, "Community"], [Wallet, "Profile"]].map(([Icon, label]) => <button key={label as string} onClick={() => notify(`${label} opened`)} className={`flex min-w-[54px] flex-col items-center gap-1 py-2 text-[9px] font-bold ${label === "Collection" ? "text-[#fa7180]" : "text-[#77777a]"}`}><Icon size={18} /><span>{label as string}</span></button>)}</nav>
    </main>
  );
}