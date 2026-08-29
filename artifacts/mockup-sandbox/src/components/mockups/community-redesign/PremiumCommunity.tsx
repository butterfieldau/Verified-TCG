import { useMemo, useState, type ReactNode } from "react";
import {
  Bell, Bookmark, Camera, ChevronRight, CircleCheck, Heart, Image as ImageIcon,
  MessageCircle, MoreHorizontal, Plus, Search, Send, Share2, Sparkles, Star,
  Users, X
} from "lucide-react";

type Tab = "feed" | "discover" | "messages";

const collectors = [
  { initials: "MC", name: "Mara Chen", handle: "@marachens", note: "Tokyo · 1.8k cards", color: "#c45d52", following: true },
  { initials: "JL", name: "Jonah Lewis", handle: "@jonahpulls", note: "Portland · 642 cards", color: "#4f7881", following: false },
  { initials: "AS", name: "Ari Soto", handle: "@arisoto", note: "Austin · 2.4k cards", color: "#a07a4e", following: false },
];

const posts = [
  {
    initials: "MC", name: "Mara Chen", handle: "@marachens", time: "18 min", color: "#c45d52",
    copy: "The texture on this one is unreal in hand. Found it tucked behind a stack of commons at Nakano Broadway. A very good Saturday.",
    card: "1999 Base Set · Charizard Holo", set: "Base Set / 4 of 102", art: "charizard", likes: 184, comments: 23, liked: true,
    detail: "NM / Centering 52–48"
  },
  {
    initials: "JL", name: "Jonah Lewis", handle: "@jonahpulls", time: "1 hr", color: "#4f7881",
    copy: "Small mail day, big feeling. The seller included the original receipt and a note from 2001. Those details matter.",
    card: "2001 Neo Revelation · Shining Gyarados", set: "Neo Revelation / 65 of 64", art: "gyarados", likes: 96, comments: 11, liked: false,
    detail: "PSA 8 · Verified purchase"
  },
];

function Avatar({ initials, color, size = "md" }: { initials: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 w-9 text-[11px]", md: "h-11 w-11 text-xs", lg: "h-[66px] w-[66px] text-lg" };
  return <div className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-[#241b1a]`} style={{ background: `linear-gradient(145deg, ${color}, #302322)` }}>{initials}</div>;
}

function CardArt({ kind, compact = false }: { kind: string; compact?: boolean }) {
  return (
    <div className={`card-art relative overflow-hidden rounded-xl ${compact ? "h-14 w-11" : "h-[190px] sm:h-[235px]"}`} data-kind={kind}>
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 30% 22%, rgba(255,221,164,.8) 0 1px, transparent 2px), radial-gradient(circle at 75% 68%, rgba(255,255,255,.35) 0 1px, transparent 2px)", backgroundSize: "18px 19px, 26px 23px" }} />
      {!compact && <><span className="absolute left-3 top-3 font-mono text-[8px] tracking-[.18em] text-white/70">VTCG ARCHIVE</span><span className="absolute bottom-3 left-3 right-3 font-serif text-lg italic text-white">{kind === "charizard" ? "Charizard" : "Gyarados"}</span></>}
      {compact && <span className="absolute inset-x-0 bottom-1 text-center text-[7px] font-semibold text-white">{kind === "charizard" ? "H" : "G"}</span>}
    </div>
  );
}

function IconButton({ label, children, active = false, onClick }: { label: string; children: ReactNode; active?: boolean; onClick?: () => void }) {
  return <button aria-label={label} onClick={onClick} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-95 ${active ? "text-[#ff6b5f]" : "text-[#b9aaa4]"}`}>{children}</button>;
}

export function PremiumCommunity() {
  const [tab, setTab] = useState<Tab>("feed");
  const [liked, setLiked] = useState(posts.map(p => p.liked));
  const [saved, setSaved] = useState<number[]>([]);
  const [following, setFollowing] = useState(collectors.map(c => c.following));
  const [composer, setComposer] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);

  const results = useMemo(() => collectors.filter(c => `${c.name} ${c.handle}`.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <main className="min-h-screen bg-[#120f0f] text-[#f8eee8] selection:bg-[#b92f2b]">
      <style>{`
        .card-art { background: linear-gradient(150deg, #a73c32 0%, #6d2525 46%, #201b20 100%); }
        .card-art[data-kind="gyarados"] { background: linear-gradient(150deg, #427a82 0%, #193d4d 52%, #171b29 100%); }
      `}</style>
      <div className="mx-auto flex min-h-screen max-w-[1420px] flex-col lg:flex-row">
        <aside className="hidden w-[250px] shrink-0 border-r border-[#332525] px-7 py-8 lg:block">
          <div className="mb-12 flex items-center gap-2"><div className="h-7 w-7 rounded-md bg-[#e9443d] shadow-[4px_4px_0_#70211f]" /><span className="font-serif text-[22px] tracking-tight">Verified <i>TCG</i></span></div>
          <p className="mb-5 font-mono text-[9px] uppercase tracking-[.22em] text-[#917f78]">Collector lounge</p>
          <nav className="space-y-2">
            {([["feed", "The Lounge", Sparkles], ["discover", "Discover", Search], ["messages", "Messages", MessageCircle]] as const).map(([value, label, Icon]) => <button key={value} onClick={() => setTab(value)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-sm transition-colors ${tab === value ? "bg-[#3a2221] text-white" : "text-[#a5948d] hover:bg-[#241a1a]"}`}><Icon className={tab === value ? "text-[#ff6b5f]" : ""} size={18} />{label}{value === "messages" && <span className="ml-auto rounded-full bg-[#e9443d] px-2 py-0.5 text-[10px] text-white">2</span>}</button>)}
          </nav>
          <div className="mt-12 rounded-2xl border border-[#4b2b29] bg-[#281918] p-4"><div className="mb-3 flex items-center gap-2 text-[#f1b4a8]"><CircleCheck size={15} /><span className="text-xs font-semibold">Verified circles</span></div><p className="text-xs leading-5 text-[#b59b94]">Trust is a feature. Every collector here has a traceable collection history.</p><button className="mt-4 text-xs font-semibold text-[#ff796e]">How it works <ChevronRight className="inline" size={13} /></button></div>
          <div className="mt-auto pt-20"><button onClick={() => setComposer(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e9443d] text-sm font-bold text-white shadow-[0_8px_24px_rgba(233,68,61,.18)] transition hover:bg-[#f15a50]"><Plus size={17} /> Share a find</button></div>
        </aside>

        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#332525] bg-[#120f0f]/95 px-5 py-4 backdrop-blur lg:hidden"><div className="flex items-center gap-2"><div className="h-6 w-6 rounded bg-[#e9443d]" /><span className="font-serif text-xl">Verified <i>TCG</i></span></div><div className="flex"><IconButton label="Notifications"><Bell size={19} /></IconButton><IconButton label="Open messages" onClick={() => setTab("messages")}><MessageCircle size={19} /></IconButton></div></header>

        <section className="min-w-0 flex-1 lg:max-w-[760px] lg:border-r lg:border-[#332525]">
          <div className="flex items-center justify-between px-5 pb-3 pt-7 lg:px-10"><div><p className="font-mono text-[9px] uppercase tracking-[.24em] text-[#bc6c62]">Friday, 24 May</p><h1 className="mt-1 font-serif text-3xl tracking-tight sm:text-[38px]">{tab === "feed" ? "The Lounge" : tab === "discover" ? "Find your people" : "Private notes"}</h1></div><IconButton label="Search community" onClick={() => setTab("discover")}><Search size={20} /></IconButton></div>
          <div className="mb-5 flex gap-1 border-b border-[#332525] px-5 lg:px-10">{([["feed", "For you"], ["discover", "Discover"], ["messages", "Inbox"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`min-h-12 border-b-2 px-3 text-xs font-semibold transition-colors ${tab === value ? "border-[#e9443d] text-white" : "border-transparent text-[#907f78]"}`}>{label}{value === "messages" && <span className="ml-2 rounded bg-[#3a2221] px-1.5 py-0.5 text-[9px] text-[#ff857d]">2</span>}</button>)}</div>

          {tab === "feed" && <div className="space-y-5 px-5 pb-10 lg:px-10">
            <button onClick={() => setComposer(true)} className="group flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-dashed border-[#68413b] bg-[#1d1515] p-3 text-left transition hover:border-[#c65a50]"><Avatar initials="RV" color="#b9473f" /><div className="flex-1"><p className="text-sm font-medium text-[#d9c8c1]">What are you displaying today?</p><p className="mt-1 text-[11px] text-[#866f69]">Share a card, a story, or a sharp eye.</p></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3b201f] text-[#f07167]"><Camera size={18} /></div></button>
            {posts.map((post, i) => <article key={post.handle} className="overflow-hidden rounded-2xl border border-[#352725] bg-[#1a1515]">
              <div className="flex items-center gap-3 px-4 pb-3 pt-4"><Avatar initials={post.initials} color={post.color} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm font-semibold">{post.name}<span className="rounded bg-[#293c34] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-[#8dd8a8]">verified</span></div><p className="text-[11px] text-[#8c7872]">{post.handle} · {post.time}</p></div><IconButton label="More post options"><MoreHorizontal size={18} /></IconButton></div>
              <p className="px-4 pb-4 text-[13px] leading-5 text-[#ddcec8]">{post.copy}</p>
              <div className="mx-4 mb-3 flex overflow-hidden rounded-xl border border-[#56302d] bg-[#241716]"><div className="w-[39%]"><CardArt kind={post.art} /></div><div className="flex flex-1 flex-col justify-between p-3"><div><p className="font-mono text-[8px] uppercase tracking-[.15em] text-[#c76a61]">Card reference</p><h3 className="mt-2 font-serif text-[18px] leading-5">{post.card}</h3><p className="mt-1 text-[10px] text-[#9f8981]">{post.set}</p></div><div className="flex items-center gap-1.5 text-[10px] text-[#c18d83]"><Star size={12} fill="currentColor" /> {post.detail}</div></div></div>
              <div className="flex items-center border-t border-[#302221] px-3 py-1"><IconButton label={liked[i] ? "Unlike post" : "Like post"} active={liked[i]} onClick={() => setLiked(v => v.map((x, j) => j === i ? !x : x))}><Heart size={17} fill={liked[i] ? "currentColor" : "none"} /></IconButton><span className="-ml-2 mr-2 text-[11px] text-[#987f78]">{post.likes + (liked[i] && !post.liked ? 1 : 0)}</span><IconButton label="Comment on post"><MessageCircle size={17} /></IconButton><span className="-ml-2 text-[11px] text-[#987f78]">{post.comments}</span><div className="ml-auto flex"><IconButton label="Save post" active={saved.includes(i)} onClick={() => setSaved(v => v.includes(i) ? v.filter(x => x !== i) : [...v, i])}><Bookmark size={17} fill={saved.includes(i) ? "currentColor" : "none"} /></IconButton><IconButton label="Share post"><Share2 size={17} /></IconButton></div></div>
            </article>)}
          </div>}

          {tab === "discover" && <div className="space-y-6 px-5 pb-12 lg:px-10"><div className="flex items-center gap-3 rounded-xl border border-[#4a302d] bg-[#1d1515] px-4 py-2"><Search size={17} className="text-[#aa766c]" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search names, sets, specialties" className="min-h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-[#725e59]" />{query && <button onClick={() => setQuery("")}><X size={16} /></button>}</div><div className="rounded-2xl bg-[#2b1c1b] p-5"><div className="flex items-center gap-2 text-[#ff9a8e]"><Sparkles size={16} /><span className="font-mono text-[9px] uppercase tracking-[.2em]">Curated for you</span></div><h2 className="mt-2 font-serif text-2xl">Collectors with a sharp eye</h2><p className="mt-1 text-xs text-[#ac9189]">Based on your Base Set shelf and recent saves.</p></div>{results.map((c, i) => <div key={c.handle} className="flex items-center gap-3 border-b border-[#302221] pb-4"><Avatar initials={c.initials} color={c.color} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{c.name}</p><p className="text-[11px] text-[#8c7872]">{c.handle} · {c.note}</p></div><button onClick={() => setFollowing(v => v.map((x, j) => j === i ? !x : x))} className={`min-h-10 rounded-lg border px-3 text-[11px] font-semibold ${following[i] ? "border-[#67423d] text-[#b9948c]" : "border-[#e9443d] text-[#ff8178]"}`}>{following[i] ? "Following" : "Follow"}</button></div>)}</div>}

          {tab === "messages" && <div className="space-y-2 px-5 pb-12 lg:px-10">{[["NB", "Nadia Bell", "I pulled the binder pages you asked about — the 1st edition has no whitening.", "8 min", "#7d5d8c"], ["AS", "Ari Soto", "That Sapporo trade is still on if you want to compare centering.", "Yesterday", "#a07a4e"], ["JL", "Jonah Lewis", "Your note on the Gyarados was spot on.", "Tue", "#4f7881"]].map((m, i) => <button key={m[1]} className="flex min-h-[82px] w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[#241a1a]"><Avatar initials={m[0]} color={m[4]} /><div className="min-w-0 flex-1"><div className="flex justify-between"><span className="text-sm font-semibold">{m[1]}</span><span className="text-[10px] text-[#876f68]">{m[3]}</span></div><p className="mt-1 truncate text-xs text-[#a79088]">{m[2]}</p></div>{i === 0 && <span className="h-2 w-2 rounded-full bg-[#e9443d]" />}</button>)}</div>}
        </section>

        <aside className="hidden w-[330px] shrink-0 px-7 py-8 xl:block"><div className="mb-8 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.22em] text-[#917f78]">Your profile</span><button className="text-[#b97970]"><MoreHorizontal size={18} /></button></div><div className="flex items-center gap-3"><Avatar initials="RV" color="#b9473f" size="lg" /><div><h2 className="font-serif text-xl">Rafael Velez</h2><p className="text-xs text-[#8e7770]">@rafaelcollects</p></div></div><p className="mt-4 text-xs leading-5 text-[#b59e96]">Sealed product, Japanese promos, and the stories behind the cardboard.</p><div className="mt-5 flex gap-6 border-y border-[#332525] py-4"><div><p className="font-serif text-lg">486</p><p className="font-mono text-[8px] uppercase tracking-wider text-[#806a63]">Cards</p></div><div><p className="font-serif text-lg">1.2k</p><p className="font-mono text-[8px] uppercase tracking-wider text-[#806a63]">Followers</p></div><div><p className="font-serif text-lg">89</p><p className="font-mono text-[8px] uppercase tracking-wider text-[#806a63]">Following</p></div></div><div className="mt-8 flex items-center justify-between"><h3 className="font-serif text-lg">People to know</h3><button onClick={() => setTab("discover")} className="text-[11px] font-semibold text-[#eb7469]">See all</button></div><div className="mt-4 space-y-4">{collectors.slice(0, 2).map(c => <div key={c.handle} className="flex items-center gap-3"><Avatar initials={c.initials} color={c.color} size="sm" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{c.name}</p><p className="truncate text-[10px] text-[#89736d]">{c.note}</p></div><button onClick={() => setTab("discover")} className="text-[10px] font-semibold text-[#eb7469]">View</button></div>)}</div><div className="mt-9 rounded-xl border border-[#432826] bg-[#211716] p-4"><p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#c6776d]">Collection signal</p><p className="mt-2 text-sm font-medium">Your Base Set shelf is in the top 14% of verified collections.</p><p className="mt-2 text-[10px] text-[#967d75]">Updated after your last passport scan</p></div></aside>
      </div>
      {composer && <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"><div className="w-full max-w-[520px] rounded-t-2xl border border-[#59302d] bg-[#211817] p-5 shadow-2xl sm:rounded-2xl"><div className="flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#c9746a]">New lounge post</p><h2 className="mt-1 font-serif text-2xl">Put it in the case</h2></div><IconButton label="Close composer" onClick={() => setComposer(false)}><X size={20} /></IconButton></div><div className="mt-5 flex gap-3"><Avatar initials="RV" color="#b9473f" /><textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Share a card, a story, or a sharp eye..." className="min-h-[110px] flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-[#806b64]" /></div><div className="mt-4 flex items-center justify-between border-t border-[#392422] pt-4"><button className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs text-[#bd948c] hover:bg-white/5"><ImageIcon size={17} /> Add photo</button><button disabled={!draft.trim()} onClick={() => { setSent(true); setDraft(""); setTimeout(() => { setSent(false); setComposer(false); }, 1000); }} className="flex min-h-11 items-center gap-2 rounded-lg bg-[#e9443d] px-5 text-xs font-bold text-white disabled:opacity-40">{sent ? "Posted" : "Publish"} <Send size={14} /></button></div></div></div>}
    </main>
  );
}