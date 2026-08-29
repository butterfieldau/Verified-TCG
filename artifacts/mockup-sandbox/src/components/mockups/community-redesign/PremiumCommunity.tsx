import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell, Bookmark, Camera, ChevronRight, CircleCheck, Heart, Image as ImageIcon,
  MessageCircle, MoreHorizontal, Plus, Search, Send, Share2, Sparkles, Star, X
} from "lucide-react";

type Tab = "feed" | "discover" | "messages";

const collectors = [
  { initials: "MC", name: "Mara Chen", handle: "@marachens", note: "Tokyo · 1.8k cards", color: "#B04A53", following: true },
  { initials: "JL", name: "Jonah Lewis", handle: "@jonahpulls", note: "Portland · 642 cards", color: "#3E7182", following: false },
  { initials: "AS", name: "Ari Soto", handle: "@arisoto", note: "Austin · 2.4k cards", color: "#A37A3D", following: false },
];

const posts = [
  {
    initials: "MC", name: "Mara Chen", handle: "@marachens", time: "18 min", color: "#B04A53",
    copy: "The texture on this one is unreal in hand. Found it tucked behind a stack of commons at Nakano Broadway. A very good Saturday.",
    card: "1999 Base Set · Charizard Holo", set: "Base Set / 4 of 102", art: "charizard", likes: 184, comments: 23, liked: true,
    detail: "NM / Centering 52–48",
  },
  {
    initials: "JL", name: "Jonah Lewis", handle: "@jonahpulls", time: "1 hr", color: "#3E7182",
    copy: "Small mail day, big feeling. The seller included the original receipt and a note from 2001. Those details matter.",
    card: "2001 Neo Revelation · Shining Gyarados", set: "Neo Revelation / 65 of 64", art: "gyarados", likes: 96, comments: 11, liked: false,
    detail: "PSA 8 · Verified purchase",
  },
];

const messages = [
  ["NB", "Nadia Bell", "I pulled the binder pages you asked about — the 1st edition has no whitening.", "8 min", "#765A91"],
  ["AS", "Ari Soto", "That Sapporo trade is still on if you want to compare centering.", "Yesterday", "#A37A3D"],
  ["JL", "Jonah Lewis", "Your note on the Gyarados was spot on.", "Tue", "#3E7182"],
] as const;

function Avatar({ initials, color, size = "md" }: { initials: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 w-9 text-[11px]", md: "h-10 w-10 text-xs", lg: "h-[62px] w-[62px] text-lg" };
  return <div className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-full border border-white/10 font-semibold text-white`} style={{ background: `linear-gradient(145deg, ${color}, #292929)` }}>{initials}</div>;
}

function CardArt({ kind, compact = false }: { kind: string; compact?: boolean }) {
  return (
    <div className={`card-art relative overflow-hidden rounded-lg ${compact ? "h-14 w-11" : "h-[178px] sm:h-[224px]"}`} data-kind={kind}>
      <div className="absolute inset-0 opacity-45" style={{ backgroundImage: "radial-gradient(circle at 30% 22%, rgba(255,255,255,.45) 0 1px, transparent 2px), radial-gradient(circle at 75% 68%, rgba(255,255,255,.28) 0 1px, transparent 2px)", backgroundSize: "18px 19px, 26px 23px" }} />
      {!compact && <><span className="absolute left-3 top-3 font-mono text-[8px] tracking-[.16em] text-white/65">VERIFIED TCG</span><span className="absolute bottom-3 left-3 right-3 text-lg font-bold tracking-tight text-white">{kind === "charizard" ? "Charizard" : "Gyarados"}</span></>}
      {compact && <span className="absolute inset-x-0 bottom-1 text-center text-[7px] font-semibold text-white">{kind === "charizard" ? "H" : "G"}</span>}
    </div>
  );
}

function IconButton({ label, children, active = false, onClick }: { label: string; children: ReactNode; active?: boolean; onClick?: () => void }) {
  return <button aria-label={label} onClick={onClick} className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-full transition-transform hover:bg-white/[.08] active:scale-95 ${active ? "text-[#FF1E2D]" : "text-[#9A9A9A]"}`}>{children}</button>;
}

export function PremiumCommunity() {
  const [tab, setTab] = useState<Tab>("feed");
  const [liked, setLiked] = useState(posts.map((p) => p.liked));
  const [saved, setSaved] = useState<number[]>([]);
  const [following, setFollowing] = useState(collectors.map((c) => c.following));
  const [composer, setComposer] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => collectors.filter((c) => `${c.name} ${c.handle}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const announce = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2200); };

  return (
    <main className="community-shell min-h-[100dvh] bg-[#0A0A0A] text-white selection:bg-[#FF1E2D]/30">
      <style>{`
        .community-shell { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .card-art { background: linear-gradient(145deg, #9C343D 0%, #541C25 52%, #171717 100%); }
        .card-art[data-kind="gyarados"] { background: linear-gradient(145deg, #367A87 0%, #183C4A 54%, #171717 100%); }
        .community-shell button, .community-shell input, .community-shell textarea { font: inherit; }
      `}</style>
      <div className="mx-auto flex min-h-[100dvh] max-w-[1420px] flex-col lg:flex-row">
        <aside className="hidden w-[244px] shrink-0 border-r border-[#2A2A2A] px-6 py-7 lg:flex lg:flex-col">
          <div className="mb-12 flex items-center gap-2"><div className="h-7 w-7 rounded-[8px] bg-[#FF1E2D]" /><span className="text-[19px] font-bold tracking-[-.04em]">Verified TCG</span></div>
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[.18em] text-[#9A9A9A]">Community</p>
          <nav className="space-y-1.5">
            {([["feed", "Feed", Sparkles], ["discover", "Discover", Search], ["messages", "Inbox", MessageCircle]] as const).map(([value, label, Icon]) => <button key={value} onClick={() => setTab(value)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium transition-colors ${tab === value ? "bg-[#1A1A1A] text-white" : "text-[#9A9A9A] hover:bg-[#141414] hover:text-white"}`}><Icon size={18} className={tab === value ? "text-[#FF1E2D]" : ""} />{label}{value === "messages" && <span className="ml-auto rounded-full bg-[#FF1E2D] px-2 py-0.5 text-[10px] font-bold text-white">2</span>}</button>)}
          </nav>
          <div className="mt-10 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-4"><div className="mb-3 flex items-center gap-2 text-white"><CircleCheck size={15} className="text-[#22C55E]" /><span className="text-xs font-semibold">Verified circles</span></div><p className="text-xs leading-5 text-[#9A9A9A]">Trust is a feature. Every collector here has a traceable collection history.</p><button onClick={() => announce("Verification details are coming soon")} className="mt-4 text-xs font-semibold text-[#FF1E2D]">How it works <ChevronRight className="inline" size={13} /></button></div>
          <button onClick={() => setComposer(true)} className="mt-auto flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FF1E2D] text-sm font-bold text-white transition hover:bg-[#e51b29] active:scale-[.99]"><Plus size={17} /> Share a find</button>
        </aside>

        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#2A2A2A] bg-[#0A0A0A]/95 px-4 py-3 backdrop-blur lg:hidden"><div className="flex items-center gap-2"><div className="h-6 w-6 rounded-[6px] bg-[#FF1E2D]" /><span className="text-lg font-bold tracking-[-.04em]">Verified TCG</span></div><div className="flex"><IconButton label="Notifications" onClick={() => announce("No new notifications")}><Bell size={19} /></IconButton><IconButton label="Open inbox" onClick={() => setTab("messages")}><MessageCircle size={19} /></IconButton></div></header>

        <section className="min-w-0 flex-1 lg:max-w-[760px] lg:border-r lg:border-[#2A2A2A]">
          <div className="flex items-center justify-between px-4 pb-3 pt-6 sm:px-6 lg:px-10"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#9A9A9A]">Friday, 24 May</p><h1 className="mt-1 text-[30px] font-bold tracking-[-.05em] sm:text-[36px]">{tab === "feed" ? "Your community" : tab === "discover" ? "Find your people" : "Inbox"}</h1></div><IconButton label="Search community" onClick={() => setTab("discover")}><Search size={20} /></IconButton></div>
          <div className="mb-5 flex gap-1 border-b border-[#2A2A2A] px-4 sm:px-6 lg:px-10">{([["feed", "For you"], ["discover", "Discover"], ["messages", "Inbox"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`min-h-11 border-b-2 px-3 text-xs font-semibold transition-colors ${tab === value ? "border-[#FF1E2D] text-white" : "border-transparent text-[#9A9A9A] hover:text-white"}`}>{label}{value === "messages" && <span className="ml-2 rounded bg-[#2A2A2A] px-1.5 py-0.5 text-[9px] text-white">2</span>}</button>)}</div>

          {tab === "feed" && <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-10">
            <button onClick={() => setComposer(true)} className="group flex min-h-[70px] w-full items-center gap-3 rounded-2xl border border-dashed border-[#3A3A3A] bg-[#141414] p-3 text-left transition hover:border-[#FF1E2D]/70"><Avatar initials="RV" color="#B04A53" /><div className="flex-1"><p className="text-sm font-medium text-white">What are you displaying today?</p><p className="mt-1 text-[11px] text-[#9A9A9A]">Share a card, a story, or a sharp eye.</p></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2A2A2A] text-[#FF1E2D]"><Camera size={18} /></div></button>
            {posts.map((post, i) => <article key={post.handle} className="overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] shadow-[0_8px_30px_rgba(0,0,0,.18)]">
              <div className="flex items-center gap-3 px-4 pb-3 pt-4"><Avatar initials={post.initials} color={post.color} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm font-semibold">{post.name}<span className="rounded bg-[#17351F] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#62D982]">verified</span></div><p className="text-[11px] text-[#9A9A9A]">{post.handle} · {post.time}</p></div><IconButton label="More post options" onClick={() => announce("Post options opened")}><MoreHorizontal size={18} /></IconButton></div>
              <p className="px-4 pb-4 text-[13px] leading-5 text-[#D0D0D0]">{post.copy}</p>
              <div className="mx-4 mb-3 flex overflow-hidden rounded-xl border border-[#2A2A2A] bg-[#141414]"><div className="w-[39%]"><CardArt kind={post.art} /></div><div className="flex flex-1 flex-col justify-between p-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#9A9A9A]">Card reference</p><h3 className="mt-2 text-[16px] font-bold leading-5 tracking-[-.02em]">{post.card}</h3><p className="mt-1 text-[10px] text-[#9A9A9A]">{post.set}</p></div><div className="flex items-center gap-1.5 text-[10px] text-[#D4AF37]"><Star size={12} fill="currentColor" /> {post.detail}</div></div></div>
              <div className="flex items-center border-t border-[#2A2A2A] px-3 py-1"><IconButton label={liked[i] ? "Unlike post" : "Like post"} active={liked[i]} onClick={() => setLiked((v) => v.map((x, j) => j === i ? !x : x))}><Heart size={17} fill={liked[i] ? "currentColor" : "none"} /></IconButton><span className="-ml-1 mr-2 text-[11px] text-[#9A9A9A]">{post.likes + (liked[i] && !post.liked ? 1 : 0)}</span><IconButton label="Comment on post" onClick={() => announce("Comments are ready to read")}><MessageCircle size={17} /></IconButton><span className="-ml-1 text-[11px] text-[#9A9A9A]">{post.comments}</span><div className="ml-auto flex"><IconButton label="Save post" active={saved.includes(i)} onClick={() => setSaved((v) => v.includes(i) ? v.filter((x) => x !== i) : [...v, i])}><Bookmark size={17} fill={saved.includes(i) ? "currentColor" : "none"} /></IconButton><IconButton label="Share post" onClick={() => announce("Post link copied")}><Share2 size={17} /></IconButton></div></div>
            </article>)}
          </div>}

          {tab === "discover" && <div className="space-y-6 px-4 pb-12 sm:px-6 lg:px-10"><div className="flex items-center gap-3 rounded-xl border border-[#2A2A2A] bg-[#141414] px-4 py-2"><Search size={17} className="text-[#9A9A9A]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, sets, specialties" className="min-h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-[#666]" />{query && <button aria-label="Clear search" onClick={() => setQuery("")} className="text-[#9A9A9A]"><X size={16} /></button>}</div><div className="rounded-2xl border border-[#2A2A2A] bg-[#141414] p-5"><div className="flex items-center gap-2 text-[#FF1E2D]"><Sparkles size={16} /><span className="text-[9px] font-bold uppercase tracking-[.18em]">Curated for you</span></div><h2 className="mt-2 text-2xl font-bold tracking-[-.04em]">Collectors with a sharp eye</h2><p className="mt-1 text-xs text-[#9A9A9A]">Based on your Base Set shelf and recent saves.</p></div>{results.map((c, i) => <div key={c.handle} className="flex items-center gap-3 border-b border-[#2A2A2A] pb-4"><Avatar initials={c.initials} color={c.color} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{c.name}</p><p className="text-[11px] text-[#9A9A9A]">{c.handle} · {c.note}</p></div><button onClick={() => setFollowing((v) => v.map((x, j) => j === i ? !x : x))} className={`min-h-10 rounded-lg border px-3 text-[11px] font-semibold transition ${following[i] ? "border-[#3A3A3A] text-[#9A9A9A]" : "border-[#FF1E2D] text-[#FF1E2D] hover:bg-[#FF1E2D]/10"}`}>{following[i] ? "Following" : "Follow"}</button></div>)}</div>}
          {tab === "messages" && <div className="space-y-2 px-4 pb-12 sm:px-6 lg:px-10">{messages.map((m, i) => <button key={m[1]} onClick={() => announce(`Opening conversation with ${m[1]}`)} className="flex min-h-[82px] w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[#141414]"><Avatar initials={m[0]} color={m[4]} /><div className="min-w-0 flex-1"><div className="flex justify-between"><span className="text-sm font-semibold">{m[1]}</span><span className="text-[10px] text-[#9A9A9A]">{m[3]}</span></div><p className="mt-1 truncate text-xs text-[#9A9A9A]">{m[2]}</p></div>{i === 0 && <span className="h-2 w-2 rounded-full bg-[#FF1E2D]" />}</button>)}</div>}
        </section>

        <aside className="hidden w-[330px] shrink-0 px-7 py-8 xl:block"><div className="mb-8 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#9A9A9A]">Your profile</span><IconButton label="Profile options" onClick={() => announce("Profile options opened")}><MoreHorizontal size={18} /></IconButton></div><div className="flex items-center gap-3"><Avatar initials="RV" color="#B04A53" size="lg" /><div><h2 className="text-xl font-bold tracking-[-.04em]">Rafael Velez</h2><p className="text-xs text-[#9A9A9A]">@rafaelcollects</p></div></div><p className="mt-4 text-xs leading-5 text-[#BDBDBD]">Sealed product, Japanese promos, and the stories behind the cardboard.</p><div className="mt-5 flex gap-6 border-y border-[#2A2A2A] py-4"><div><p className="text-lg font-bold">486</p><p className="text-[9px] uppercase tracking-wider text-[#9A9A9A]">Cards</p></div><div><p className="text-lg font-bold">1.2k</p><p className="text-[9px] uppercase tracking-wider text-[#9A9A9A]">Followers</p></div><div><p className="text-lg font-bold">89</p><p className="text-[9px] uppercase tracking-wider text-[#9A9A9A]">Following</p></div></div><div className="mt-8 flex items-center justify-between"><h3 className="text-lg font-bold">People to know</h3><button onClick={() => setTab("discover")} className="text-[11px] font-semibold text-[#FF1E2D]">See all</button></div><div className="mt-4 space-y-4">{collectors.slice(0, 2).map((c) => <div key={c.handle} className="flex items-center gap-3"><Avatar initials={c.initials} color={c.color} size="sm" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{c.name}</p><p className="truncate text-[10px] text-[#9A9A9A]">{c.note}</p></div><button onClick={() => setTab("discover")} className="text-[10px] font-semibold text-[#FF1E2D]">View</button></div>)}</div><div className="mt-9 rounded-xl border border-[#2A2A2A] bg-[#141414] p-4"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#9A9A9A]">Collection signal</p><p className="mt-2 text-sm font-medium">Your Base Set shelf is in the top 14% of verified collections.</p><p className="mt-2 text-[10px] text-[#777]">Updated after your last passport scan</p></div></aside>
      </div>

      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-[#3A3A3A] bg-[#1A1A1A] px-4 py-2 text-xs font-medium text-white shadow-xl">{notice}</div>}
      {composer && <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"><div className="w-full max-w-[520px] rounded-t-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-5 shadow-2xl sm:rounded-2xl"><div className="flex items-center justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-[#9A9A9A]">New community post</p><h2 className="mt-1 text-2xl font-bold tracking-[-.04em]">Share a find</h2></div><IconButton label="Close composer" onClick={() => setComposer(false)}><X size={20} /></IconButton></div><div className="mt-5 flex gap-3"><Avatar initials="RV" color="#B04A53" /><textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Share a card, a story, or a sharp eye..." className="min-h-[110px] flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-[#666]" /></div>{photo && <p className="mt-2 pl-[52px] text-xs text-[#22C55E]">Photo attached: {photo}</p>}<div className="mt-4 flex items-center justify-between border-t border-[#2A2A2A] pt-4"><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0]?.name ?? "")} /><button onClick={() => fileRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs text-[#9A9A9A] hover:bg-white/5"><ImageIcon size={17} /> Add photo</button><button disabled={!draft.trim()} onClick={() => { setDraft(""); setPhoto(""); setComposer(false); announce("Post published to your community"); }} className="flex min-h-11 items-center gap-2 rounded-lg bg-[#FF1E2D] px-5 text-xs font-bold text-white transition hover:bg-[#e51b29] disabled:opacity-40">Publish <Send size={14} /></button></div></div></div>}
    </main>
  );
}