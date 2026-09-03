import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
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
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import "./_group.css";

type Filter = "All" | "Pokémon" | "Graded" | "Raw" | "For Sale" | "For Trade";
type Panel = "filters" | "lists" | "sort" | null;
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
const filters: Filter[] = ["All", "Pokémon", "Graded", "Raw", "For Sale", "For Trade"];
const money = (n: number) => `AUD ${n.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

function RoundButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return <button aria-label={label} onClick={onClick} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#303035] bg-[#151517] text-[#f4f1e8] transition hover:border-[#a24953] hover:bg-[#242126] active:scale-95">{children}</button>;
}

function CardArt({ card }: { card: Card }) {
  return <div className="relative aspect-[.72] overflow-hidden rounded-[11px] border border-white/20 shadow-[0_14px_24px_rgba(0,0,0,.3)]" style={{ background: card.art }}>
    <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 25% 18%,rgba(255,255,255,.9),transparent 16%),linear-gradient(135deg,transparent 42%,rgba(255,255,255,.38) 49%,transparent 56%),radial-gradient(ellipse at 70% 65%,rgba(255,255,255,.2),transparent 35%)" }} />
    <div className="absolute left-2.5 top-[28%] -rotate-6 text-[clamp(16px,5vw,25px)] font-black italic tracking-[-1px] text-white/75">{card.name.split(" ")[0]}</div>
    {card.grade && <span className={`absolute right-2 top-2 rounded-[3px] border-2 bg-[#fffdf8] px-1 py-0.5 text-center text-[8px] font-black leading-[9px] ${card.grader === "CGC" ? "border-[#4a90d9] text-[#4a90d9]" : "border-[#ff1e2d] text-[#e24b58]"}`}><b className="block text-[6px]">{card.grader}</b><i className="text-[11px] not-italic text-zinc-900">{card.grade}</i></span>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-2 pb-2 pt-10"><p className="truncate text-[11px] font-bold">{card.name}</p><p className="truncate text-[9px] text-white/65">{card.set} · {card.number}</p></div>
  </div>;
}

export function CollectorVault() {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [summary, setSummary] = useState<"worth" | "performance">("worth");
  const [range, setRange] = useState("1M");
  const [sort, setSort] = useState("Value");
  const [ascending, setAscending] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [panel, setPanel] = useState<Panel>(null);
  const [saved, setSaved] = useState<number[]>([2, 5]);
  const [selected, setSelected] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [visible, setVisible] = useState(4);
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState<Card | null>(null);
  const [activeList, setActiveList] = useState("Main");
  const [lists, setLists] = useState(["Main", "High Value", "Trade Binder"]);

  const totals = useMemo(() => {
    const value = cards.reduce((sum, card) => sum + card.value, 0);
    const cost = cards.reduce((sum, card) => sum + card.cost, 0);
    return { value, cost, gain: value - cost };
  }, []);
  const results = useMemo(() => cards.filter(card => {
    const term = query.trim().toLowerCase();
    const matchesQuery = !term || `${card.name} ${card.set} ${card.number}`.toLowerCase().includes(term);
    const matchesFilter = filter === "All" || filter === "Pokémon" || (filter === "Graded" && !!card.grade) || (filter === "Raw" && !card.grade) || (filter === "For Sale" && !!card.sale) || (filter === "For Trade" && !!card.trade);
    return matchesQuery && matchesFilter;
  }).sort((a, b) => {
    const direction = ascending ? 1 : -1;
    if (sort === "Name") return a.name.localeCompare(b.name) * direction;
    if (sort === "Gain") return ((a.value - a.cost) - (b.value - b.cost)) * direction;
    return (a.value - b.value) * direction;
  }), [filter, query, sort, ascending]);
  const gainPercent = (totals.gain / totals.cost) * 100;
  const shown = results.slice(0, visible);
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2200); };
  const toggleSaved = (id: number) => setSaved(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const toggleSelected = (id: number) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  return <main className="vtcg-collection min-h-[100dvh] overflow-hidden pb-24">
    <div className="mx-auto max-w-[430px]">
      <header className="px-4 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-[#353338] bg-[#151517] px-4 py-2.5">
            <Search size={17} className="shrink-0 text-[#f4f1e8]" />
            <input aria-label="Search your collection" value={query} onChange={event => { setQuery(event.target.value); setVisible(4); }} onFocus={() => setSearchOpen(true)} placeholder="Search your collection" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8d888b]" />
            {(searchOpen || query) && <button aria-label="Clear search" onClick={() => { setQuery(""); setSearchOpen(false); }}><X size={18} className="text-[#f4f1e8]" /></button>}
          </div>
          <RoundButton label="Open saved cards" onClick={() => flash("Saved cards opened")}><Heart size={17} /></RoundButton>
          <RoundButton label="Open collection filters" onClick={() => setPanel("filters")}><SlidersHorizontal size={17} /></RoundButton>
        </div>
      </header>

      <section className="px-5 pb-4 text-center">
        <p className="text-[15px] font-semibold text-[#f4f1e8]">Portfolio: <span className="text-[#ff5967]">Main</span> <button aria-label="Change portfolio" onClick={() => setPanel("lists")}><ChevronDown size={14} className="inline text-[#8d888b]" /></button></p>
        <div className="mt-1 flex items-center justify-center gap-2"><p className="tcg-display text-[37px] font-bold leading-none tracking-[-1px]">{summary === "worth" ? money(totals.value) : `${totals.gain >= 0 ? "+" : "-"}${money(Math.abs(totals.gain))}`}</p><span className="text-[13px] font-semibold text-[#8d888b]">AUD</span><button aria-label="Toggle value visibility" onClick={() => flash("Values are visible")} className="grid h-7 w-7 place-items-center rounded-full bg-[#2a2a2c] text-[#8d888b]"><Eye size={14} /></button></div>
        <div className="mx-auto mt-2 flex w-fit items-center gap-2 rounded-full border border-[#383238] bg-[#19191c] p-1">
          <button onClick={() => setSummary("worth")} className={`rounded-full px-3 py-1 text-[10px] font-bold ${summary === "worth" ? "bg-[#3d2429] text-[#fff8f2]" : "text-[#8d888b]"}`}>Worth</button>
          <button onClick={() => setSummary("performance")} className={`rounded-full px-3 py-1 text-[10px] font-bold ${summary === "performance" ? "bg-[#193326] text-[#6ee7a2]" : "text-[#8d888b]"}`}>Performance</button>
        </div>
      </section>

      {summary === "performance" && <section className="mx-5 mb-5 rounded-2xl border border-[#2b4637] bg-[#14231b] p-4">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[1.4px] text-[#86a892]">Performance · {range}</p><p className="mt-1 text-[19px] font-bold text-[#64df96]">+{money(totals.gain)} <span className="text-[11px] font-semibold">(+{gainPercent.toFixed(1)}%)</span></p></div><TrendingUp size={20} className="text-[#42c982]" /></div>
        <div className="mt-3 flex gap-1 rounded-lg bg-[#0e1712] p-1">{["7D", "1M", "3M", "1Y", "ALL"].map(item => <button key={item} onClick={() => setRange(item)} className={`flex-1 rounded-md py-1.5 text-[9px] font-bold ${range === item ? "bg-[#42c982] text-[#0d1710]" : "text-[#86a892]"}`}>{item}</button>)}</div>
        <div className="mt-3 flex items-center justify-between border-t border-[#2b4637] pt-3 text-[10px] text-[#86a892]"><span>6 holdings · coverage partial</span><span>Last synced 2h ago</span></div>
      </section>}

      <section className="px-4">
        <div className="mb-3 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[1.6px] text-[#8d888b]">THE VAULT</p><h2 className="tcg-display text-[25px] font-bold">YOUR CARDS <span className="font-sans text-sm font-normal text-[#8d888b]">· {results.length}</span></h2></div><RoundButton label="Add card" onClick={() => flash("Card intake ready")}><Plus size={18} /></RoundButton></div>
        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">{filters.map(item => <button key={item} onClick={() => { setFilter(item); setVisible(4); }} className={`shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold ${filter === item ? "border-[#ff1e2d]/60 bg-[#ff1e2d]/14 text-[#ff9ca4]" : "border-[#303035] bg-[#151517] text-[#bcb4b4]"}`}>{filter === item && <Check size={10} className="mr-1 inline" />}{item}</button>)}</div>
        <div className="mb-3 flex items-center gap-2"><button onClick={() => setPanel("filters")} className="flex items-center gap-1 rounded-full border border-[#303035] bg-[#151517] px-3 py-2 text-[10px] font-semibold"><Filter size={12} className="text-[#ff5967]" /> Filters</button><button onClick={() => setPanel("lists")} className="flex items-center gap-1 rounded-full border border-[#303035] bg-[#151517] px-3 py-2 text-[10px] font-semibold"><Folder size={12} className="text-[#ff5967]" />{activeList}<ChevronDown size={11} /></button><button onClick={() => setPanel("sort")} className="ml-auto flex items-center gap-1 rounded-full border border-[#303035] bg-[#151517] px-3 py-2 text-[10px] font-semibold"><ArrowDown size={11} className="text-[#d6a85e]" />{sort}</button><div className="flex rounded-md border border-[#303035] bg-[#151517] p-0.5"><button aria-label="Grid view" onClick={() => setView("grid")} className={`grid h-7 w-7 place-items-center rounded ${view === "grid" ? "bg-[#373039] text-white" : "text-[#777278]"}`}><Grid2X2 size={14} /></button><button aria-label="List view" onClick={() => setView("list")} className={`grid h-7 w-7 place-items-center rounded ${view === "list" ? "bg-[#373039] text-white" : "text-[#777278]"}`}><List size={14} /></button></div></div>
        <p className="mb-3 text-[10px] text-[#8d888b]">{results.length} results · {ascending ? "Ascending" : "Descending"} · values are partial where noted</p>
        {results.length === 0 ? <div className="rounded-2xl border border-dashed border-[#403a3d] py-14 text-center"><Layers3 className="mx-auto mb-3 text-[#777278]" /><p className="font-bold">No cards match this slice</p><p className="mt-1 text-xs text-[#8d888b]">Try clearing your search or filters.</p><button onClick={() => { setFilter("All"); setQuery(""); }} className="mt-4 rounded-lg bg-[#ff1e2d] px-4 py-2 text-xs font-bold">Reset view</button></div> : view === "grid" ? <div className="grid grid-cols-2 gap-x-3 gap-y-5">{shown.map(card => { const cardGain = card.value - card.cost; return <article key={card.id} className={`relative ${selected.includes(card.id) ? "rounded-[15px] outline outline-2 outline-[#ff1e2d]" : ""}`}><button className="block w-full text-left" onClick={() => selecting ? toggleSelected(card.id) : setDetail(card)}><CardArt card={card} /></button><button aria-label={`${saved.includes(card.id) ? "Remove" : "Save"} ${card.name}`} onClick={() => { toggleSaved(card.id); flash(saved.includes(card.id) ? "Removed from wishlist" : "Saved to wishlist"); }} className={`absolute right-2 top-2 rounded-full p-2 ${saved.includes(card.id) ? "bg-[#ff1e2d] text-white" : "bg-black/55 text-white"}`}><Heart size={13} fill={saved.includes(card.id) ? "currentColor" : "none"} /></button><div className="mt-2 flex items-start justify-between gap-1"><div><p className="text-xs font-bold">{money(card.value)}</p><p className={`mt-0.5 text-[10px] font-bold ${cardGain >= 0 ? "text-[#42c982]" : "text-[#ff5967]"}`}>{cardGain >= 0 ? "+" : "-"}{money(Math.abs(cardGain))}</p></div>{card.sale && <span className="rounded bg-[#ff1e2d]/12 px-1.5 py-1 text-[8px] font-bold text-[#ff9ca4]">FOR SALE</span>}</div><button onClick={() => setDetail(card)} className="mt-1 flex items-center gap-1 text-[10px] text-[#8d888b]">View passport <ExternalLink size={10} /></button></article>; })}</div> : <div className="space-y-2">{shown.map(card => <article key={card.id} className="flex gap-3 rounded-xl border border-[#2b2b30] bg-[#19191c] p-2"><button className="w-[58px] shrink-0" onClick={() => setDetail(card)}><CardArt card={card} /></button><div className="min-w-0 flex-1 py-1"><p className="truncate text-sm font-bold">{card.name}</p><p className="truncate text-[10px] text-[#8d888b]">{card.set} · {card.grade ? `${card.grader} ${card.grade}` : "Near mint"}</p><p className={`mt-2 text-[10px] font-bold ${card.change >= 0 ? "text-[#42c982]" : "text-[#ff5967]"}`}>{card.change >= 0 ? "+" : ""}{card.change.toFixed(1)}% since sync</p></div><div className="flex flex-col items-end py-1"><b className="text-xs">{money(card.value)}</b><div className="mt-auto flex gap-1"><button onClick={() => flash(`${card.name} queued for sale`)} className="rounded border border-[#71323a] px-2 py-1 text-[9px] font-bold text-[#ff9ca4]">Sell</button><button aria-label={`Edit ${card.name}`} onClick={() => flash(`Editing ${card.name}`)} className="rounded border border-[#303035] p-1.5 text-[#bcb4b4]"><Edit3 size={11} /></button></div></div></article>)}</div>}
        {visible < results.length ? <button onClick={() => setVisible(value => value + 2)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#71323a] py-3 text-xs font-bold text-[#ff9ca4]"><Plus size={14} /> Load more cards</button> : <p className="py-6 text-center text-[10px] text-[#777278]">All {results.length} cards loaded from this view</p>}
      </section>

      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-[#2b2b30] bg-[#19191c] p-3"><Wallet size={18} className="text-[#d6a85e]" /><p className="flex-1 text-[10px] leading-4 text-[#bcb4b4]"><b className="text-[#f4f1e8]">Vault note.</b> Market values reflect recent verified sales. Incomplete coverage stays marked.</p><ChevronRight size={15} className="text-[#777278]" /></div>
    </div>
    {selecting && <div className="fixed bottom-[76px] left-1/2 z-30 flex w-[calc(100%-32px)] max-w-[398px] -translate-x-1/2 items-center gap-1 rounded-2xl border border-[#4c393d] bg-[#211b1e]/[.98] p-2 shadow-2xl"><button onClick={() => { setSelecting(false); setSelected([]); }} className="px-2 text-xs text-[#9a9295]">Done</button><span className="mr-auto text-xs font-bold">{selected.length} selected</span><button onClick={() => flash("Marked selected cards for sale")} className="rounded-lg bg-[#ff1e2d] px-2.5 py-2 text-[10px] font-bold">Sale</button><button onClick={() => flash("Trade list updated")} className="rounded-lg bg-[#d6a85e]/15 px-2.5 py-2 text-[10px] font-bold text-[#e8c986]">Trade</button><button aria-label="Delete selected cards" onClick={() => { flash("Removal requires confirmation in the full app"); setSelected([]); }} className="rounded-lg bg-[#ff5967]/10 p-2 text-[#ff5967]"><Trash2 size={14} /></button></div>}
    {panel && <div className="fixed inset-0 z-40 bg-black/70" onClick={() => setPanel(null)}><div onClick={event => event.stopPropagation()} className="absolute bottom-0 left-1/2 w-full max-w-[430px] -translate-x-1/2 rounded-t-[24px] border-t border-[#4a363b] bg-[#19191c] p-5"><div className="mb-5 flex items-center justify-between"><h2 className="tcg-display text-2xl font-bold">{panel === "filters" ? "ADVANCED FILTERS" : panel === "lists" ? "PORTFOLIO LISTS" : "SORT LIBRARY"}</h2><button aria-label="Close panel" onClick={() => setPanel(null)}><X size={18} /></button></div>{panel === "filters" && <><p className="mb-3 text-xs text-[#8d888b]">Narrow the vault without losing your place.</p><div className="grid grid-cols-2 gap-2">{["Price range", "Set / series", "Condition", "Grading company", "Acquisition date", "Market coverage"].map(item => <button key={item} onClick={() => flash(`${item} filter selected`)} className="flex items-center justify-between rounded-xl border border-[#303035] p-3 text-left text-xs">{item}<ChevronDown size={14} className="text-[#777278]" /></button>)}</div><button onClick={() => setPanel(null)} className="mt-5 w-full rounded-xl bg-[#ff1e2d] py-3 text-xs font-bold">Apply filters</button></>}{panel === "lists" && <><div className="space-y-2">{lists.map((list, index) => <button key={list} onClick={() => { setActiveList(list); setPanel(null); }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${activeList === list ? "border-[#71323a] bg-[#311d22]" : "border-[#303035]"}`}><Folder size={17} className="text-[#ff5967]" /><span className="flex-1"><b className="block text-xs">{list}</b><small className="text-[10px] text-[#8d888b]">{index === 0 ? "6 cards · AUD 1,944.75" : index === 1 ? "3 cards · AUD 1,534.50" : "2 cards · AUD 506.25"}</small></span>{activeList === list && <Check size={15} className="text-[#ff5967]" />}<MoreHorizontal size={16} className="text-[#777278]" /></button>)}</div><button onClick={() => { setLists(current => [...current, `New List ${current.length}`]); flash("New portfolio list created"); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#71323a] py-3 text-xs font-bold text-[#ff9ca4]"><Plus size={15} /> Create portfolio list</button></>}{panel === "sort" && <div className="space-y-1">{["Value", "Name", "Recent", "Quantity", "Gain"].map(item => <button key={item} onClick={() => { setSort(item); setPanel(null); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm ${sort === item ? "bg-[#311d22] text-[#ff9ca4]" : ""}`}>{item}{sort === item && <Check size={15} />}</button>)}<button onClick={() => setAscending(current => !current)} className="mt-2 flex w-full items-center gap-2 border-t border-[#303035] pt-4 text-xs text-[#bcb4b4]">{ascending ? <ArrowUp size={14} /> : <ArrowDown size={14} />} {ascending ? "Ascending" : "Descending"}</button></div>}</div></div>}
    {detail && <div className="fixed inset-0 z-40 bg-black/75" onClick={() => setDetail(null)}><div onClick={event => event.stopPropagation()} className="absolute bottom-0 left-1/2 w-full max-w-[430px] rounded-t-[24px] border-t border-[#4a363b] bg-[#19191c] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[9px] font-bold tracking-[1.5px] text-[#8d888b]">CARD PASSPORT</p><h2 className="tcg-display text-2xl font-bold">{detail.name}</h2></div><button aria-label="Close passport" onClick={() => setDetail(null)}><X size={18} /></button></div><div className="flex gap-4"><div className="w-[104px] shrink-0"><CardArt card={detail} /></div><div className="flex-1"><p className="text-xs text-[#bcb4b4]">{detail.set} · {detail.number}</p><p className="mt-4 text-[10px] uppercase tracking-wider text-[#8d888b]">Market value</p><p className="text-2xl font-extrabold">{money(detail.value)}</p><p className={`mt-1 text-xs font-bold ${detail.change >= 0 ? "text-[#42c982]" : "text-[#ff5967]"}`}>{detail.change >= 0 ? "+" : ""}{detail.change.toFixed(1)}% since last sync</p><div className="mt-4 flex gap-2"><button onClick={() => { flash(`${detail.name} queued for sale`); setDetail(null); }} className="rounded-lg bg-[#ff1e2d] px-3 py-2 text-[10px] font-bold">Sell card</button><button onClick={() => flash("Edit details opened")} className="rounded-lg border border-[#303035] px-3 py-2 text-[10px] font-bold">Edit</button></div></div></div></div></div>}
    {toast && <div role="status" className="fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-full border border-[#4c393d] bg-[#211b1e] px-4 py-2 text-[11px] font-bold text-[#f4f1e8] shadow-xl">{toast}</div>}
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-[72px] max-w-[430px] items-center justify-around border-t border-[#29282b] bg-[#0d0d0f]/95 px-3 backdrop-blur" aria-label="Primary navigation">{[[Home, "Home"], [TrendingUp, "Market"], [Layers3, "Collection"], [Users, "Community"], [Wallet, "Profile"]].map(([Icon, label]) => <button key={label as string} onClick={() => flash(`${label} opened`)} className={`flex min-w-[54px] flex-col items-center gap-1 py-2 text-[9px] font-bold ${label === "Collection" ? "text-[#ff1e2d]" : "text-[#777278]"}`}><Icon size={18} /><span>{label as string}</span></button>)}</nav>
  </main>;
}