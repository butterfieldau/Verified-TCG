import { useMemo, useState } from 'react';
import { CreditCard, ChevronRight, Heart, MessageCircle, Pencil, Search, Users, X } from 'lucide-react';
import './_group.css';

const collectors = [
  { initials: 'JM', name: 'Jordan Miles', username: 'jordanmiles', bio: 'Modern Pokémon collector and trade night regular.', color: 'violet', pro: true },
  { initials: 'SK', name: 'Sarah Kim', username: 'sarahcollects', bio: 'Chasing vintage holos and clean slabs.', color: 'blue', pro: false },
];

export function Current() {
  const [tab, setTab] = useState<'feed' | 'discover'>('feed');
  const [sheetOpen, setSheetOpen] = useState(true);
  const [body, setBody] = useState('');
  const [query, setQuery] = useState('');
  const filteredCollectors = useMemo(
    () => collectors.filter((collector) => `${collector.name} ${collector.username}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <main className="community-current">
      <div className="community-current__frame">
        <section className="community-current__screen" aria-label="Community">
          <header className="community-current__header">
            <h1>Community</h1>
            {tab === 'feed' && <button className="community-current__post-button" onClick={() => setSheetOpen(true)}><Pencil size={14} />Post</button>}
          </header>
          <nav className="community-current__tabs" aria-label="Community sections">
            <button className={`community-current__tab ${tab === 'feed' ? 'community-current__tab--active' : ''}`} onClick={() => setTab('feed')}>Feed</button>
            <button className={`community-current__tab ${tab === 'discover' ? 'community-current__tab--active' : ''}`} onClick={() => setTab('discover')}>Discover</button>
          </nav>

          {tab === 'feed' ? (
            <div className="community-current__feed">
              <article className="community-current__post-card">
                <div className="community-current__post-head">
                  <div className="community-current__avatar community-current__avatar--violet">JM</div>
                  <div className="community-current__identity">
                    <div className="community-current__name-line"><span className="community-current__name">Jordan Miles</span><span className="community-current__pro">PRO</span></div>
                    <div className="community-current__handle">@jordanmiles · 2h</div>
                  </div>
                </div>
                <p className="community-current__post-copy">Finally added this one to the collection. The centering is even better in person.</p>
                <span className="community-current__card-ref"><CreditCard size={12} />Charizard ex 199/165</span>
                <div className="community-current__actions">
                  <button className="community-current__action community-current__action--liked"><Heart size={16} fill="currentColor" />24</button>
                  <button className="community-current__action"><MessageCircle size={16} />6</button>
                </div>
              </article>
              <article className="community-current__post-card">
                <div className="community-current__post-head">
                  <div className="community-current__avatar community-current__avatar--blue">SK</div>
                  <div className="community-current__identity"><div className="community-current__name">Sarah Kim</div><div className="community-current__handle">@sarahcollects · 5h</div></div>
                </div>
                <p className="community-current__post-copy">Trade night was a success. Always appreciate meeting collectors who care about condition as much as I do.</p>
                <div className="community-current__actions"><button className="community-current__action"><Heart size={16} />12</button><button className="community-current__action"><MessageCircle size={16} />3</button></div>
              </article>
            </div>
          ) : (
            <div className="community-current__discover">
              <label className="community-current__search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search collectors…" aria-label="Search collectors" />{query && <X size={16} onClick={() => setQuery('')} />}</label>
              {query.length >= 2 && filteredCollectors.length > 0 ? <div className="community-current__collectors">{filteredCollectors.map((collector) => <div className="community-current__collector" key={collector.username}><div className={`community-current__avatar community-current__avatar--${collector.color}`}>{collector.initials}</div><div className="community-current__identity"><div className="community-current__name-line"><span className="community-current__collector-name">{collector.name}</span>{collector.pro && <span className="community-current__pro">PRO</span>}</div><div className="community-current__collector-handle">@{collector.username}</div><div className="community-current__bio">{collector.bio}</div></div><ChevronRight size={18} color="#9A9A9A" /></div>)}</div> : query.length >= 2 ? <div className="community-current__empty"><Search size={32} /><p>No collectors found for "{query}"</p></div> : <div className="community-current__empty"><Users size={36} /><h2>Find Collectors</h2><p>Search by username or display name to find collectors in the community.</p></div>}
            </div>
          )}
        </section>

        {sheetOpen && <><button className="community-current__backdrop" aria-label="Dismiss new post" onClick={() => setSheetOpen(false)} /><section className="community-current__sheet" aria-label="New Post"><div className="community-current__sheet-head"><span className="community-current__sheet-title">New Post</span><button className="community-current__close" onClick={() => setSheetOpen(false)} aria-label="Close"><X size={22} /></button></div><textarea className="community-current__textarea" value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} placeholder="What's on your mind? Share a card find, trade tip, or milestone…" /><div className="community-current__sheet-foot"><span>{body.length}/500</span><button className="community-current__submit" disabled={!body.trim()}>Post</button></div></section></>}
      </div>
    </main>
  );
}