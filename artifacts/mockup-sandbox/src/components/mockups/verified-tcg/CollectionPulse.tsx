import React, { useMemo, useState } from "react";
import { Search, SlidersHorizontal, ArrowUpRight, Sparkles, Grid2X2, List, Check } from "lucide-react";
import { AppShell } from "./_shared/AppShell";
import { MOCK_CARDS } from "./_shared/data";
import { CardThumbnail } from "./_shared/CardThumbnail";
import "./CollectionPulse.css";

type Filter = "All" | "Pokémon" | "Graded" | "Raw" | "For Sale";

export function CollectionPulse() {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [saved, setSaved] = useState<number[]>([]);
  const filters: Filter[] = ["All", "Pokémon", "Graded", "Raw", "For Sale"];
  const cards = useMemo(() => MOCK_CARDS.filter((card) => {
    const matchesQuery = card.name.toLowerCase().includes(query.toLowerCase()) || card.set.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All" || (filter === "Graded" && !!card.grade) || (filter === "Raw" && !card.grade) || filter === "Pokémon" || filter === "For Sale";
    return matchesQuery && matchesFilter;
  }), [filter, query]);
  const toggleSave = (id: number) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return (
    <AppShell active="Collection">
      <main className="collection-pulse pb-28 text-[#f3f0e9]">
        <header className="px-5 pt-10">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[.24em] text-[#f04444]">Vault / 06</p>
              <h1 className="tcg-title text-[2.35rem] font-bold leading-none tracking-tight">MY COLLECTION</h1>
            </div>
            <div className="flex gap-2">
              <button aria-label="Search collection" onClick={() => setSearchOpen((open) => !open)} className="pulse-tap rounded-full bg-[#18181b] p-2.5"><Search size={18} /></button>
              <button aria-label="Filter collection" onClick={() => setFilter("Graded")} className="pulse-tap rounded-full bg-[#18181b] p-2.5"><SlidersHorizontal size={18} /></button>
            </div>
          </div>
          {searchOpen && <div className="pulse-enter mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#18181b] px-3 py-2"><Search size={15} className="text-zinc-500" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search card or set" className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-600" /></div>}
          <div className="flex items-end justify-between">
            <div><p className="text-xs text-zinc-500">247 cards · $34,890 total</p><p className="mt-2 flex items-center gap-1 text-xs font-bold text-emerald-400"><ArrowUpRight size={13} /> 12.4% this month</p></div>
            <div className="text-right"><p className="text-[10px] uppercase tracking-widest text-zinc-600">Last synced</p><p className="mt-1 text-xs text-zinc-400">Today, 09:42</p></div>
          </div>
        </header>
        <section className="mx-5 mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#201f20] p-4">
          <div className="flex items-start justify-between">
            <div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-zinc-500"><Sparkles size={13} className="text-[#f04444]" /> Vault pulse</div><p className="max-w-[210px] text-sm font-semibold leading-snug">Your Dragon Frontiers cards moved up <span className="text-emerald-400">$640</span> this week.</p></div>
            <div className="animate-[float-mark_4s_ease-in-out_infinite] text-3xl font-black text-[#f04444]">01</div>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[72%] rounded-full bg-[#f04444]" /></div>
          <p className="mt-2 text-[10px] text-zinc-500">Top performer · Rayquaza Gold Star</p>
        </section>
        <div className="scrollbar-hide mt-6 flex gap-2 overflow-x-auto px-5">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={`pulse-tap whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold ${filter === item ? "bg-[#f04444] text-white" : "bg-[#18181b] text-zinc-400"}`}>{filter === item && <Check size={12} className="mr-1 inline" />}{item}</button>)}</div>
        <div className="mt-6 flex items-center justify-between px-5"><p className="text-xs text-zinc-500">{cards.length} cards showing</p><div className="flex rounded-lg bg-[#18181b] p-1"><button aria-label="Grid view" onClick={() => setView("grid")} className={`pulse-tap rounded p-1.5 ${view === "grid" ? "bg-[#3a393b] text-white" : "text-zinc-600"}`}><Grid2X2 size={14} /></button><button aria-label="List view" onClick={() => setView("list")} className={`pulse-tap rounded p-1.5 ${view === "list" ? "bg-[#3a393b] text-white" : "text-zinc-600"}`}><List size={14} /></button></div></div>
         <div className={view === "grid" ? "collection-grid" : "collection-list"}>{cards.map((card) => <div key={card.id} className={`card-wrap pulse-enter relative ${view === "list" ? "collection-list-card" : "collection-grid-card"}`}><div className={view === "list" ? "collection-list-thumb" : "collection-grid-thumb"}><CardThumbnail card={card} /></div><button aria-label={`Save ${card.name}`} onClick={() => toggleSave(card.id)} className="pulse-tap absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-sm">{saved.includes(card.id) ? "SAVED" : "SAVE"}</button>{view === "list" && <div className="min-w-0"><p className="truncate text-sm font-bold">{card.name}</p><p className="mt-1 text-xs text-zinc-500">{card.set}</p><span className="grade-shimmer mt-2 inline-block rounded bg-[#2e2d2f] px-2 py-1 text-[10px] font-bold text-[#f3f0e9]">{card.grade}</span></div>}</div>)}</div>
        {cards.length === 0 && <div className="mx-5 mt-8 rounded-2xl border border-dashed border-white/15 p-8 text-center"><p className="text-sm font-bold">Nothing in this slice.</p><p className="mt-2 text-xs text-zinc-500">Try another filter or search term.</p></div>}
      </main>
    </AppShell>
  );
}