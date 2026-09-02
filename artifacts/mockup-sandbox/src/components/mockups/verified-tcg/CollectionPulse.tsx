import React, { useMemo, useState } from "react";
import { ArrowDownUp, ArrowUpRight, Check, ChevronDown, Grid2X2, List, MoreHorizontal, Search, SlidersHorizontal, Sparkles, TrendingUp, X } from "lucide-react";
import { AppShell } from "./_shared/AppShell";
import { MOCK_CARDS, MOCK_USER } from "./_shared/data";
import { CardThumbnail } from "./_shared/CardThumbnail";
import "./CollectionPulse.css";

type Filter = "All" | "Pokémon" | "Graded" | "Raw" | "For Sale";
type Sort = "value" | "name" | "recent";

export function CollectionPulse() {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<Sort>("value");
  const [saved, setSaved] = useState<number[]>([6]);
  const filters: Filter[] = ["All", "Pokémon", "Graded", "Raw", "For Sale"];
  const cards = useMemo(() => MOCK_CARDS
    .filter((card) => {
      const normalizedQuery = query.trim().toLowerCase();
      const matchesQuery = card.name.toLowerCase().includes(normalizedQuery) || card.set.toLowerCase().includes(normalizedQuery);
      const matchesFilter = filter === "All" || (filter === "Graded" && !!card.grade) || (filter === "Raw" && !card.grade) || filter === "Pokémon" || (filter === "For Sale" && [1, 5].includes(card.id));
      return matchesQuery && matchesFilter;
    })
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "recent" ? b.id - a.id : b.value - a.value), [filter, query, sort]);
  const toggleSave = (id: number) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <AppShell active="Collection">
      <main className="collection-pulse pb-28 text-[#f3f0e9]">
        <header className="collection-header">
          <div className="collection-header__top">
            <div className="collection-identity">
              <div className="collection-avatar">AM</div>
              <div>
                <p className="collection-kicker">ALEX MERCER / VAULT 06</p>
                <h1 className="tcg-title collection-title">Collection</h1>
              </div>
            </div>
            <div className="collection-actions">
              <button aria-label={searchOpen ? "Close search" : "Search collection"} onClick={() => { setSearchOpen((open) => !open); if (searchOpen) setQuery(""); }} className="pulse-tap collection-icon-button">{searchOpen ? <X size={17} /> : <Search size={17} />}</button>
              <button aria-label="Collection menu" onClick={() => setSort(sort === "value" ? "recent" : "value")} className="pulse-tap collection-icon-button"><MoreHorizontal size={18} /></button>
            </div>
          </div>
          {searchOpen && <div className="pulse-enter collection-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search card or set" /><span>{cards.length}</span></div>}
        </header>

        <section className="collection-portfolio pulse-enter">
          <div className="portfolio-orbit portfolio-orbit--one" />
          <div className="portfolio-orbit portfolio-orbit--two" />
          <div className="portfolio-heading"><span>Portfolio value</span><span className="portfolio-live"><i /> Live</span></div>
          <p className="portfolio-value">${MOCK_USER.portfolioValue.toLocaleString()}</p>
          <div className="portfolio-change"><ArrowUpRight size={15} /> $3,840 <span>· 12.4% this month</span></div>
          <div className="portfolio-chart" aria-label="Portfolio value trending upward">
            {[28, 38, 31, 48, 43, 58, 53, 72, 64, 82, 76, 94].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
          </div>
          <div className="portfolio-footer"><span><b>{MOCK_USER.totalCards}</b> cards tracked</span><span><b>{MOCK_USER.gradedCards}</b> graded</span><span className="portfolio-sync">Synced 09:42</span></div>
        </section>

        <section className="pulse-feature pulse-enter">
          <div className="pulse-feature__label"><Sparkles size={13} /> Vault pulse <span>01 / 06</span></div>
          <div className="pulse-feature__body">
            <div><h2>Rayquaza is carrying the vault.</h2><p>Dragon Frontiers is up <strong>$640</strong> this week.</p></div>
            <div className="pulse-feature__trend"><TrendingUp size={17} /><span>+18.6%</span></div>
          </div>
          <button className="pulse-feature__link pulse-tap" onClick={() => { setQuery("Rayquaza"); setSearchOpen(true); }}>View card <ArrowUpRight size={14} /></button>
        </section>

        <div className="collection-toolbar">
          <div className="collection-section-title"><span>Library</span><small>{cards.length} of 247 showing</small></div>
          <div className="collection-toolbar__actions">
            <button aria-label="Change sort order" onClick={() => setSort(sort === "value" ? "name" : sort === "name" ? "recent" : "value")} className="pulse-tap sort-button"><ArrowDownUp size={13} /> {sort === "value" ? "Value" : sort === "name" ? "Name" : "Recent"} <ChevronDown size={13} /></button>
            <div className="view-toggle"><button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={`pulse-tap ${view === "grid" ? "is-active" : ""}`}><Grid2X2 size={14} /></button><button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={`pulse-tap ${view === "list" ? "is-active" : ""}`}><List size={15} /></button></div>
          </div>
        </div>
        <div className="scrollbar-hide collection-filters">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={`pulse-tap collection-filter ${filter === item ? "is-active" : ""}`}>{filter === item && <Check size={12} />}{item}</button>)}</div>

        <div className={view === "grid" ? "collection-grid" : "collection-list"}>{cards.map((card, index) => <div key={card.id} className={`card-wrap pulse-enter relative ${view === "list" ? "collection-list-card" : "collection-grid-card"}`} style={{ animationDelay: `${index * 70}ms` }}><div className={view === "list" ? "collection-list-thumb" : "collection-grid-thumb"}><CardThumbnail card={card} /></div><button aria-label={`${saved.includes(card.id) ? "Remove" : "Save"} ${card.name} ${saved.includes(card.id) ? "from saved cards" : "to saved cards"}`} onClick={() => toggleSave(card.id)} className={`pulse-tap card-save ${saved.includes(card.id) ? "is-saved" : ""}`}>{saved.includes(card.id) ? "SAVED" : "SAVE"}</button>{view === "list" && <div className="collection-list-copy"><p>{card.name}</p><span>{card.set} · {card.number}</span><strong>${card.value.toLocaleString()}</strong><em>{card.grade}</em></div>}</div>)}</div>
        {cards.length === 0 && <div className="collection-empty"><SlidersHorizontal size={19} /><p>No cards match this slice.</p><span>Try another filter or clear your search.</span><button className="pulse-tap" onClick={() => { setFilter("All"); setQuery(""); }}>Reset view</button></div>}
      </main>
    </AppShell>
  );
}