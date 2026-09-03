import { useMemo, useState } from "react";
import {
  Archive, ArrowDown, ArrowUp, Check, ChevronDown, CloudOff, Edit2, Folder,
  Grid2X2, List, LoaderCircle, MoreHorizontal, Plus, Search, SlidersHorizontal,
  Trash2, WifiOff, X, DollarSign, Repeat2, Heart, ExternalLink, Layers
} from "lucide-react";
import "./_group.css";

type Filter = "All" | "Pokémon" | "Graded" | "Raw" | "For Sale" | "For Trade";
type Card = { id: number; name: string; set: string; no: string; value: number; cost: number; grade?: string; grader?: string; sale?: boolean; trade?: boolean; art: string; };

const cards: Card[] = [
  { id: 1, name: "Charizard ex", set: "Pokémon 151", no: "006/165", value: 482.5, cost: 220, grade: "10", grader: "PSA", sale: true, art: "from-orange-500 via-red-700 to-slate-950" },
  { id: 2, name: "Pikachu VMAX", set: "Vivid Voltage", no: "188/185", value: 310, cost: 165, grade: "9", grader: "PSA", trade: true, art: "from-yellow-300 via-amber-500 to-purple-950" },
  { id: 3, name: "Gengar VMAX", set: "Fusion Strike", no: "271/264", value: 196.25, cost: 96, art: "from-violet-600 via-fuchsia-900 to-zinc-950" },
  { id: 4, name: "Blastoise ex", set: "151", no: "009/165", value: 88, cost: 75, grade: "9.5", grader: "CGC", art: "from-cyan-400 via-blue-700 to-slate-950" },
  { id: 5, name: "Umbreon VMAX", set: "Evolving Skies", no: "215/203", value: 742, cost: 410, grade: "10", grader: "PSA", sale: true, art: "from-slate-400 via-indigo-950 to-black" },
  { id: 6, name: "Mew ex", set: "Paldean Fates", no: "232/091", value: 126, cost: 62, art: "from-pink-300 via-rose-600 to-purple-950" },
];
const filters: Filter[] = ["All", "Pokémon", "Graded", "Raw", "For Sale", "For Trade"];

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return <button onClick={onClick} aria-label={label} className="grid h-9 w-9 place-items-center rounded-full border border-[#29282b] bg-[#18181b] text-[#f4f1e8]">{children}</button>;
}
function Grade({ card }: { card: Card }) {
  return card.grade ? <span className={`rounded-[3px] border-2 bg-white px-1 py-0.5 text-center text-[8px] font-extrabold leading-[10px] ${card.grader === "CGC" ? "border-[#4a90d9] text-[#4a90d9]" : "border-[#ff1e2d] text-[#ff1e2d]"}`}><b className="block text-[6px]">{card.grader}</b><i className="not-italic text-[11px] leading-none text-zinc-900">{card.grade}</i></span> : null;
}
function CardArt({ card }: { card: Card }) {
  return <div className={`relative aspect-[.715] overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br ${card.art} shadow-xl`}>
    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(circle at 30% 20%,rgba(255,255,255,.75),transparent 18%), linear-gradient(135deg,transparent 43%,rgba(255,255,255,.4) 50%,transparent 57%)" }} />
    <div className="absolute left-3 top-12 max-w-[75%] text-2xl font-black italic leading-none text-white/80">{card.name.split(" ")[0]}</div>
    <div className="absolute right-2 top-2"><Grade card={card} /></div>
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pb-2 pt-8">
      <p className="truncate text-xs font-bold">{card.name}</p><p className="text-[10px] text-zinc-300">{card.set} · {card.no}</p>
    </div>
  </div>;
}

export function Current() {
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [ascending, setAscending] = useState(false);
  const [sort, setSort] = useState("Value");
  const [advanced, setAdvanced] = useState(false);
  const [lists, setLists] = useState(false);
  const [selection, setSelection] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([2]);
  const [visible, setVisible] = useState(4);
  const [offline, setOffline] = useState(true);
  const [notice, setNotice] = useState("Unable to refresh prices. Showing your last saved collection.");

  const results = useMemo(() => cards.filter(c => {
    const term = query.toLowerCase();
    const matches = !term || `${c.name} ${c.set} ${c.no}`.toLowerCase().includes(term);
    return matches && (filter === "All" || filter === "Pokémon" || filter === "Graded" && !!c.grade || filter === "Raw" && !c.grade || filter === "For Sale" && !!c.sale || filter === "For Trade" && !!c.trade);
  }).sort((a,b) => ascending ? a.value - b.value : b.value - a.value), [filter, query, ascending]);
  const shown = results.slice(0, visible);
  const choose = (id: number) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const closePanels = () => { setAdvanced(false); setLists(false); setSortOpen(false); };

  return <main className="vtcg-collection mx-auto max-w-[430px] overflow-hidden pb-24">
    <section className="px-5 pt-8">
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#ff1e2d]/25 bg-[#ff1e2d]/10 px-3 py-2 text-[11px] text-[#ff9ca4]">
        <CloudOff size={13} className="shrink-0 text-[#f59e0b]" /> Offline — showing cached collection
        <button onClick={() => setOffline(!offline)} className="ml-auto text-[10px] font-bold text-white/65">{offline ? "SIMULATE ONLINE" : "OFFLINE"}</button>
      </div>
      {notice && <div className="mb-4 flex gap-2 rounded-lg border border-[#ff1e2d]/30 bg-[#ff1e2d]/10 p-3 text-xs text-[#f4f1e8]"><WifiOff size={17} className="shrink-0 text-[#ff1e2d]" /><span className="flex-1">{notice}<button onClick={() => setNotice("")} className="ml-2 font-bold text-[#ff1e2d]">Retry</button></span><button onClick={() => setNotice("")}><X size={15}/></button></div>}
      <header className="mb-5 flex items-center justify-between">
        <div><p className="text-[9px] font-bold tracking-[1.35px] text-[#7d7a7d]">YOUR VAULT</p><h1 className="tcg-display mt-0.5 text-[34px] font-bold leading-none tracking-[-.8px]">COLLECTION</h1></div>
        <div className="flex gap-2"><IconButton label="Search collection" onClick={() => setSearch(!search)}>{search ? <X size={17}/> : <Search size={17}/>}</IconButton><IconButton label="Collection archive"><Archive size={17}/></IconButton><IconButton label="Add a card"><Plus size={18}/></IconButton></div>
      </header>
      {search && <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2"><Search size={15} className="text-[#7d7a7d]"/><input autoFocus value={query} onChange={e => { setQuery(e.target.value); setVisible(4); }} placeholder="Search card, set or number" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#656166]"/><span className="text-xs text-[#7d7a7d]">{results.length}</span></div>}
      <div className="mb-5 border-l-2 border-[#ff1e2d] pl-3"><p className="text-[11px] text-[#9a9a9a]">Profile worth</p><p className="tcg-display text-[31px] font-bold leading-none">AUD 1,944.75</p></div>
      <div className="mb-2 flex items-center justify-between"><div><p className="tcg-display text-lg font-bold tracking-wide">LIBRARY</p><p className="text-[9px] font-bold tracking-wider text-[#7d7a7d]">{results.length} OF {cards.length} SHOWING</p></div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setSelection(!selection); setSelected([]); }} className="rounded-md border border-[#2a2a2a] px-2 py-1.5 text-[10px] font-semibold text-[#f4f1e8]">Select</button>
          <button onClick={() => {closePanels(); setLists(true)}} className="flex items-center gap-1 rounded-md border border-[#2a2a2a] px-2 py-1.5 text-[10px] text-[#f4f1e8]"><Folder size={12} className="text-[#ff1e2d]"/>All</button>
          <button onClick={() => {closePanels(); setSortOpen(true)}} className="flex items-center gap-1 rounded-md border border-[#2a2a2a] px-2 py-1.5 text-[10px] text-[#f4f1e8]"><span className="text-[#dd6974]">↯</span>{sort}<ChevronDown size={11}/></button>
          <div className="flex rounded-md border border-[#2a2a2a] bg-[#18181b] p-0.5"><button onClick={()=>setGrid(true)} className={`grid h-6 w-6 place-items-center rounded ${grid ? "bg-[#2a2a2a] text-white":"text-[#656166]"}`}><Grid2X2 size={13}/></button><button onClick={()=>setGrid(false)} className={`grid h-6 w-6 place-items-center rounded ${!grid ? "bg-[#2a2a2a] text-white":"text-[#656166]"}`}><List size={13}/></button></div>
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between"><button onClick={() => {closePanels();setAdvanced(true)}} className="flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#18181b] px-2.5 py-1.5 text-[10px] font-medium"><SlidersHorizontal size={12} className="text-[#ff1e2d]"/>Advanced filters</button><span className="text-[10px] text-[#7d7a7d]">{results.length} results · {ascending ? "Ascending" : "Descending"}</span></div>
    </section>
    <div className="scrollbar-hide flex gap-2 overflow-x-auto px-5 pb-4">{filters.map(f => <button key={f} onClick={() => {setFilter(f);setVisible(4)}} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${filter===f ? "border-[#ff1e2d]/50 bg-[#ff1e2d]/15 text-[#ff9ca4]" : "border-[#2a2a2a] bg-[#18181b] text-[#b4b0b3]"}`}>{filter===f && <Check className="mr-1 inline" size={11}/>} {f}</button>)}</div>
    <section className="px-5">
      {results.length === 0 ? <div className="py-16 text-center"><Layers className="mx-auto mb-3 text-[#7d7a7d]"/><h2 className="font-bold">No cards match this slice</h2><p className="mt-1 text-xs text-[#9a9a9a]">Try another filter or clear your search.</p><button onClick={()=>{setFilter("All");setQuery("")}} className="mt-4 rounded bg-[#ff1e2d] px-4 py-2 text-xs font-bold">Reset View</button></div> :
      grid ? <div className="grid grid-cols-2 gap-x-3 gap-y-5">{shown.map(card => <article key={card.id} className={`relative ${selected.includes(card.id) ? "rounded-xl outline outline-2 outline-[#ff1e2d]" : ""}`}><button onClick={()=>selection ? choose(card.id) : undefined} className="block w-full text-left"><CardArt card={card}/></button><button onClick={()=>setSaved(s=>s.includes(card.id)?s.filter(x=>x!==card.id):[...s,card.id])} className={`absolute right-2 top-2 rounded px-2 py-1 text-[9px] font-extrabold ${saved.includes(card.id) ? "bg-white text-black":"bg-black/55 text-white"}`}>{saved.includes(card.id) ? "SAVED" : "SAVE"}</button><div className="mt-1 flex items-center justify-between"><span className="text-xs font-bold">AUD {card.value.toLocaleString()}</span>{card.sale && <span className="text-[9px] text-[#ff9ca4]">FOR SALE</span>}</div><button onClick={()=>alert(`Card Passport: ${card.name}`)} className="mt-1 flex items-center gap-1 text-[10px] text-[#9a9a9a]">View card <ExternalLink size={10}/></button></article>)}</div> :
      <div className="space-y-2">{shown.map(card => <article key={card.id} onClick={()=>selection && choose(card.id)} className={`flex gap-3 rounded-xl bg-[#1a1a1a] p-2 ${selected.includes(card.id) ? "ring-1 ring-[#ff1e2d]" : ""}`}><div className="w-16 shrink-0"><CardArt card={card}/></div><div className="min-w-0 flex-1 py-1"><p className="truncate text-sm font-bold">{card.name}</p><p className="truncate text-[10px] text-[#9a9a9a]">{card.set}</p><p className="text-[10px] text-[#7d7a7d]">{card.no} · {card.grade ? `${card.grader} ${card.grade}` : "Near Mint"}</p><div className="mt-2 flex gap-1">{card.sale && <span className="rounded bg-[#ff1e2d]/15 px-1.5 py-0.5 text-[9px] text-[#ff9ca4]">For Sale</span>}{card.trade && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-400">Trade</span>}</div></div><div className="flex flex-col items-end py-1"><b className="text-xs">AUD {card.value}</b><span className="mt-1 text-[9px] text-[#7d7a7d]">Cost {card.cost}</span><div className="mt-auto flex gap-1"><button className="rounded border border-[#ff1e2d]/30 px-1.5 py-1 text-[9px] text-[#ff9ca4]">Sell</button><button className="rounded border border-[#2a2a2a] p-1 text-[#9a9a9a]"><Edit2 size={10}/></button></div></div></article>)}</div>}
      {visible < results.length ? <button onClick={()=>setVisible(v=>v+2)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-[#2a2a2a] py-3 text-xs font-bold text-[#f4f1e8]"><LoaderCircle size={14}/>Load more cards</button> : <p className="py-6 text-center text-[11px] text-[#7d7a7d]">All {results.length} cards loaded</p>}
    </section>
    {selection && <div className="fixed bottom-3 left-1/2 z-20 flex w-[calc(100%-32px)] max-w-[398px] -translate-x-1/2 items-center gap-1 rounded-xl border border-[#353338] bg-[#1a1a1a] p-2 shadow-2xl"><button onClick={()=>setSelection(false)} className="px-2 text-xs text-[#9a9a9a]">Cancel</button><span className="mr-auto text-xs font-bold">{selected.length} selected</span><button className="rounded bg-[#ff1e2d] px-2 py-2 text-[10px] font-bold"><DollarSign className="inline" size={12}/> Sale</button><button className="rounded bg-amber-500/20 px-2 py-2 text-[10px] font-bold text-amber-300"><Repeat2 className="inline" size={12}/> Trade</button><button className="rounded bg-[#29282b] p-2 text-[#ff9ca4]"><Trash2 size={13}/></button></div>}
    {(advanced || lists || sortOpen) && <div onClick={closePanels} className="fixed inset-0 z-30 bg-black/65"><div onClick={e=>e.stopPropagation()} className="absolute bottom-0 left-1/2 w-full max-w-[430px] -translate-x-1/2 rounded-t-2xl border-t border-[#353338] bg-[#18181b] p-5"><div className="mb-4 flex items-center justify-between"><h2 className="tcg-display text-xl font-bold">{advanced ? "ADVANCED FILTERS" : lists ? "COLLECTION LISTS" : "SORT LIBRARY"}</h2><button onClick={closePanels}><X size={18}/></button></div>
      {advanced && <><p className="mb-3 text-xs text-[#9a9a9a]">Narrow your vault by card attributes.</p><div className="grid grid-cols-2 gap-2">{["Price range","Set / series","Condition","Grading company","For sale","For trade"].map(x=><button key={x} className="flex justify-between rounded-lg border border-[#2a2a2a] p-3 text-left text-xs">{x}<ChevronDown size={14} className="text-[#7d7a7d]"/></button>)}</div><button onClick={closePanels} className="mt-4 w-full rounded-lg bg-[#ff1e2d] py-3 text-xs font-bold">Apply filters</button></>}
      {lists && <><div className="space-y-2">{[["All Collection","6 cards · AUD 1,944.75"],["High Value","3 cards · AUD 1,534.50"],["Trade Binder","2 cards · AUD 506.25"]].map(([n,s])=><button key={n} className="flex w-full items-center gap-3 rounded-lg border border-[#2a2a2a] p-3 text-left"><Folder size={16} className="text-[#ff1e2d]"/><span className="flex-1"><b className="block text-xs">{n}</b><small className="text-[10px] text-[#9a9a9a]">{s}</small></span><MoreHorizontal size={16} className="text-[#7d7a7d]"/></button>)}</div><button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#ff1e2d]/60 py-3 text-xs font-bold text-[#ff9ca4]"><Plus size={15}/>Create collection list</button></>}
      {sortOpen && <div className="space-y-1">{["Value","Name","Recent","Quantity","Gain"].map(x=><button key={x} onClick={()=>{setSort(x);setSortOpen(false)}} className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm ${sort===x?"bg-[#ff1e2d]/10 text-[#ff9ca4]":""}`}>{x}{sort===x && <Check size={15}/>}</button>)}<button onClick={()=>setAscending(!ascending)} className="mt-2 flex w-full items-center gap-2 border-t border-[#2a2a2a] pt-3 text-xs text-[#9a9a9a]">{ascending ? <ArrowUp size={14}/>:<ArrowDown size={14}/>}{ascending ? "Ascending" : "Descending"}</button></div>}
    </div></div>}
  </main>;
}