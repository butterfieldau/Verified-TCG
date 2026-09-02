import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Camera,
  Check,
  ChevronRight,
  Heart,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  WalletCards,
} from "lucide-react";

type ProfileTab = "overview" | "activity";

const shelves = [
  { title: "Japanese promos", count: "38 cards", accent: "#d47359", cards: ["charizard", "pikachu", "umbreon"] },
  { title: "Neo era favorites", count: "24 cards", accent: "#688c8a", cards: ["gyarados", "lugia", "celebi"] },
  { title: "One-of-ones", count: "7 cards", accent: "#b28b58", cards: ["gold", "mew", "dragonite"] },
];

const postCards = [
  { set: "Base Set · 4/102", name: "Charizard Holo", kind: "charizard", likes: 184 },
  { set: "Neo Revelation · 65/64", name: "Shining Gyarados", kind: "gyarados", likes: 96 },
  { set: "Promo · 001", name: "Pikachu Illustrator", kind: "pikachu", likes: 241 },
];

function Avatar({ initials, size = "large" }: { initials: string; size?: "small" | "large" }) {
  return (
    <div
      className={`${size === "large" ? "h-[76px] w-[76px] text-[20px]" : "h-9 w-9 text-[10px]"} flex shrink-0 items-center justify-center rounded-full font-bold text-[#fff7ef] ring-2 ring-[#281d1c]`}
      style={{ background: "linear-gradient(145deg, #d16a59 5%, #713936 58%, #302120 100%)" }}
    >
      {initials}
    </div>
  );
}

function CardArt({ kind, compact = false }: { kind: string; compact?: boolean }) {
  const palettes: Record<string, string> = {
    charizard: "linear-gradient(145deg,#bb5a47 0%,#e18d56 48%,#5e2c2d 100%)",
    gyarados: "linear-gradient(145deg,#416d75 0%,#98b4a6 45%,#243b4b 100%)",
    pikachu: "linear-gradient(145deg,#c0933f 0%,#f1c96d 46%,#5c4630 100%)",
    umbreon: "linear-gradient(145deg,#2d3e4b 0%,#877758 52%,#232526 100%)",
    lugia: "linear-gradient(145deg,#739ca1 0%,#d6d7c1 52%,#435267 100%)",
    celebi: "linear-gradient(145deg,#708c72 0%,#c4bd7c 52%,#38474a 100%)",
    gold: "linear-gradient(145deg,#81683f 0%,#ead18b 50%,#563d34 100%)",
    mew: "linear-gradient(145deg,#a47a89 0%,#d9b1b1 50%,#614c61 100%)",
    dragonite: "linear-gradient(145deg,#c47f47 0%,#e9c274 50%,#65433b 100%)",
  };
  return (
    <div className={`${compact ? "h-[74px] w-[55px]" : "h-[164px] w-full"} relative overflow-hidden rounded-[10px] border border-white/15 shadow-[0_7px_18px_rgba(0,0,0,.25)]`} style={{ background: palettes[kind] || palettes.gold }}>
      <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(circle at 20% 25%,rgba(255,241,196,.7) 0 1px,transparent 2px),radial-gradient(circle at 80% 66%,rgba(255,255,255,.35) 0 1px,transparent 2px)", backgroundSize: "17px 19px,23px 21px" }} />
      {!compact && <><span className="absolute left-2.5 top-2 font-mono text-[7px] tracking-[.16em] text-white/70">VTCG ARCHIVE</span><span className="absolute bottom-2.5 left-2.5 font-serif text-[17px] italic text-white/90">{kind === "charizard" ? "Charizard" : kind === "gyarados" ? "Gyarados" : kind === "pikachu" ? "Pikachu" : kind}</span></>}
      {compact && <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[7px] font-bold text-white/90">01</span>}
    </div>
  );
}

export function CollectorProfile() {
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [following, setFollowing] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [liked, setLiked] = useState<number[]>([]);
  const [shared, setShared] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const sendMessage = () => {
    if (!message.trim()) return;
    setSent(true);
    setMessage("");
    window.setTimeout(() => { setSent(false); setMessageOpen(false); }, 1200);
  };

  return (
    <main className="profile-native min-h-[100dvh] bg-[#0D0D0F] text-white [font-family:ui-sans-serif,system-ui,sans-serif]">
      <style>{`
        .profile-native .portfolio-rise { animation: portfolio-rise .65s cubic-bezier(.2,.75,.25,1) both; }
        .profile-native .portfolio-delay-1 { animation-delay: 80ms; }
        .profile-native .portfolio-delay-2 { animation-delay: 150ms; }
        .profile-native .portfolio-delay-3 { animation-delay: 220ms; }
        .profile-native .portfolio-bar { transform-origin: bottom; animation: portfolio-bar 1s cubic-bezier(.2,.75,.25,1) both; }
        @keyframes portfolio-rise { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes portfolio-bar { from { transform:scaleY(0) } to { transform:scaleY(1) } }
        .profile-native .tap { transition: transform .2s ease, background-color .2s ease, border-color .2s ease; }
        .profile-native .tap:active { transform: scale(.96); }
      `}</style>
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-hidden border-x border-[#2A2224] bg-[radial-gradient(circle_at_90%_0%,#332023_0%,transparent_34%),#0D0D0F]">
        <header className="flex items-center justify-between px-5 pb-3 pt-4">
          <button onClick={() => window.history.back()} aria-label="Go back" className="tap flex h-10 w-10 items-center justify-center rounded-full text-[#A49A9A] hover:bg-white/5"><ArrowLeft size={19} /></button>
          <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#847A7D]">Collector profile</p>
          <div className="relative">
            <button onClick={() => setMenuOpen(open => !open)} aria-label="More portfolio options" className="tap flex h-10 w-10 items-center justify-center rounded-full text-[#A49A9A] hover:bg-white/5"><MoreHorizontal size={20} /></button>
            {menuOpen && <div className="absolute right-0 top-11 z-10 w-36 rounded-xl border border-[#383034] bg-[#19181B] p-1.5 text-[11px] shadow-2xl"><button onClick={() => setShared(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#D5CCCD] hover:bg-white/5"><Share2 size={13} /> {shared ? "Link copied" : "Share portfolio"}</button><button onClick={() => setMenuOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#D5CCCD] hover:bg-white/5"><LockKeyhole size={13} /> Privacy</button></div>}
          </div>
        </header>

        <section className="portfolio-rise px-5 pb-5 pt-3">
          <div className="flex items-start gap-4">
            <div className="relative"><Avatar initials="MC" /><button onClick={() => setMenuOpen(true)} aria-label="Change profile photo" className="tap absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0D0D0F] bg-[#FF1E2D] text-white"><Camera size={12} /></button></div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center gap-1.5"><h1 className="font-serif text-[25px] leading-none tracking-[-.02em]">Mara Chen</h1><span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#FF1E2D] text-white"><Check size={11} strokeWidth={3} /></span></div>
              <p className="mt-1 text-xs text-[#8D8285]">@marachens · Tokyo, JP</p>
              <div className="mt-3 flex gap-2"><button onClick={() => setFollowing(!following)} className={`tap flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-[11px] font-bold ${following ? "border border-[#63363D] bg-transparent text-[#FF8F9A]" : "bg-[#FF1E2D] text-white"}`}>{following ? <Check size={13} /> : <UserPlus size={13} />}{following ? "Following" : "Follow"}</button><button onClick={() => setMessageOpen(true)} className="tap flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#383034] px-4 text-[11px] font-bold text-[#D7CBCD] hover:bg-white/5"><MessageCircle size={14} /> Message</button></div>
            </div>
          </div>
          <p className="mt-5 max-w-[360px] text-[13px] leading-[1.55] text-[#B4AAAC]">Japanese promos, sealed product, and the stories behind the cardboard. A patient vault built one careful acquisition at a time.</p>
          <div className="mt-5 grid grid-cols-4 border-y border-[#292528] py-3.5">
            <div><p className="font-serif text-[19px]">486</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#777074]">Cards</p></div>
            <div><p className="font-serif text-[19px]">89</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#777074]">Graded</p></div>
            <div><p className="font-serif text-[19px]">2018</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#777074]">Since</p></div>
            <div><p className="flex items-center gap-1 font-serif text-[19px]">A+ <Sparkles size={13} className="text-[#E7B36C]" /></p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#777074]">Trust</p></div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#B89583]"><LockKeyhole size={13} className="text-[#E7B36C]" /> Identity verified · Public portfolio <ChevronRight size={13} className="ml-auto text-[#777074]" /></div>
        </section>

        <div className="flex border-y border-[#292528] px-5">
          <button onClick={() => setTab("overview")} className={`relative flex h-12 flex-1 items-center justify-center gap-2 text-[11px] font-bold ${tab === "overview" ? "text-[#F4F1E8]" : "text-[#777074]"}`}><WalletCards size={15} /> Overview{tab === "overview" && <span className="absolute bottom-0 h-[2px] w-10 rounded-full bg-[#FF1E2D]" />}</button>
          <button onClick={() => setTab("activity")} className={`relative flex h-12 flex-1 items-center justify-center gap-2 text-[11px] font-bold ${tab === "activity" ? "text-[#F4F1E8]" : "text-[#777074]"}`}><BarChart3 size={15} /> Activity{tab === "activity" && <span className="absolute bottom-0 h-[2px] w-10 rounded-full bg-[#FF1E2D]" />}</button>
        </div>

        {tab === "overview" ? <section className="px-5 pb-10 pt-5">
          <section className="portfolio-rise rounded-2xl border border-[#52252C] bg-[linear-gradient(135deg,#281317_0%,#1B1216_62%,#141316_100%)] p-4 shadow-[0_18px_38px_rgba(0,0,0,.28)]">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><WalletCards size={14} className="text-[#FF8F9A]" /><p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#B9A6A8]">Portfolio value</p></div><span className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[.12em] text-[#FF8F9A]"><i className="h-1.5 w-1.5 rounded-full bg-[#EF3F4D]" /> Live</span></div>
            <div className="mt-2 flex items-end justify-between"><div><p className="font-serif text-[32px] leading-none tracking-[-.04em]">$24,680</p><p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[#FF8994]"><ArrowUpRight size={14} /> $3,840 <span className="font-normal text-[#AA888C]">· 12.4% this month</span></p></div><div className="rounded-lg border border-[#79313D] bg-[#4A1B24] px-2 py-1 text-[9px] font-bold text-[#FFB3B8]">AUD</div></div>
            <div className="mt-5 flex h-[76px] items-end gap-1 border-b border-white/10 bg-[repeating-linear-gradient(0deg,transparent_0_23px,rgba(255,255,255,.045)_24px)]">{[24,32,27,40,37,50,44,58,55,65,61,76].map((height, index) => <span key={index} className="portfolio-bar flex-1 rounded-t-[3px] bg-[linear-gradient(to_top,#A52838,#FF6974)] opacity-90" style={{ height: `${height}%`, animationDelay: `${index * 55}ms` }} />)}</div>
            <div className="mt-3 flex items-center justify-between"><p className="text-[10px] text-[#AA888C]"><b className="mr-1 text-[12px] text-[#F5DDD8]">486</b> cards tracked</p><p className="text-[10px] text-[#AA888C]"><b className="mr-1 text-[12px] text-[#F5DDD8]">89</b> graded</p><p className="font-mono text-[9px] text-[#79666A]">Synced 09:42</p></div>
          </section>
          <div className="portfolio-rise portfolio-delay-1 mt-4 flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#D06A6D]">Portfolio mix</p><h2 className="mt-1 font-serif text-[22px]">Where the vault sits</h2></div><button onClick={() => setSearchOpen(!searchOpen)} aria-label="Search portfolio" className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-[#383034] text-[#B99798]">{searchOpen ? <ChevronRight size={16} /> : <Search size={16} />}</button></div>
          {searchOpen && <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#383034] bg-[#18181B] px-3 py-2"><Search size={13} className="text-[#777074]" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search portfolio notes" className="w-full bg-transparent text-[11px] text-[#F5F0E6] outline-none placeholder:text-[#625B60]" /></div>}
          <div className="portfolio-rise portfolio-delay-2 mt-4 space-y-2.5 rounded-xl border border-[#292528] bg-[#18181B] p-3.5">{[["Japanese promos", "63%", "$15,548", "#D47359"], ["Sealed product", "21%", "$5,183", "#688C8A"], ["Graded blue chips", "16%", "$3,949", "#B28B58"]].filter(row => !query.trim() || row[0].toLowerCase().includes(query.trim().toLowerCase())).map(([label, percent, value, accent]) => <div key={label}><div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="font-bold text-[#D5CCCD]">{label}</span><span className="font-mono text-[#8D8285]">{percent} <b className="ml-2 text-[#E7D7D3]">{value}</b></span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#302B2E]"><div className="h-full rounded-full" style={{ width: percent, backgroundColor: accent }} /></div></div>)}</div>
          <div className="portfolio-rise portfolio-delay-2 mb-4 mt-7 flex items-end justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#D06A6D]">Curated shelves</p><h2 className="mt-1 font-serif text-[22px]">Collection highlights</h2></div><button onClick={() => setSearchOpen(!searchOpen)} aria-label="Filter shelves" className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-[#383034] text-[#B99798]"><SlidersHorizontal size={16} /></button></div>
          <div className="space-y-3">{shelves.map((shelf) => <button key={shelf.title} onClick={() => setSearchOpen(true)} className="tap group flex w-full items-center gap-3 rounded-xl border border-[#292528] bg-[#18181B] p-3 text-left hover:border-[#63363D]"><div className="flex -space-x-3">{shelf.cards.map((kind, j) => <div key={kind} className="relative rounded-[10px] border-2 border-[#18181B]" style={{ zIndex: 3 - j }}><CardArt kind={kind} compact /></div>)}</div><div className="min-w-0 flex-1 pl-1"><h3 className="text-[13px] font-bold text-[#F0E9E5]">{shelf.title}</h3><p className="mt-1 text-[10px] text-[#82787B]">{shelf.count} · <span style={{ color: shelf.accent }}>View shelf</span></p></div><ChevronRight size={16} className="text-[#6F6569]" /></button>)}</div>
          <div className="mb-4 mt-7 flex items-end justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#D06A6D]">Recent additions</p><h2 className="mt-1 font-serif text-[22px]">Latest in the vault</h2></div><button onClick={() => setTab("activity")} className="text-[10px] font-bold text-[#FF8994]">View activity <ArrowUpRight size={11} className="inline" /></button></div>
          <div className="grid grid-cols-3 gap-2">{postCards.map(card => <button key={card.name} onClick={() => setTab("activity")} className="tap text-left"><CardArt kind={card.kind} /><p className="mt-2 truncate text-[10px] font-bold text-[#DFD6D3]">{card.name}</p><p className="mt-0.5 truncate font-mono text-[8px] text-[#777074]">{card.set}</p></button>)}</div>
        </section> : <section className="px-5 pb-10 pt-5">
          <div className="mb-4 flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#D06A6D]">Performance log</p><h2 className="mt-1 font-serif text-[22px]">Recent movement</h2></div><span className="text-[10px] text-[#777074]">Last 30 days</span></div>
          <div className="space-y-3">{postCards.map((card, i) => <article key={card.name} className="portfolio-rise rounded-xl border border-[#292528] bg-[#18181B] p-3.5"><div className="flex items-center gap-3"><div className="w-[57px] shrink-0"><CardArt kind={card.kind} compact /></div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold text-[#F3ECE9]">{card.name}</p><p className="mt-1 truncate text-[9px] text-[#81777A]">{card.set}</p><p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-[#FF8994]"><TrendingUp size={12} /> {i === 0 ? "+18.6%" : i === 1 ? "+9.2%" : "+6.4%"} <span className="font-normal text-[#82787B]">this month</span></p></div><Target size={16} className="text-[#E7B36C]" /></div><div className="mt-3 flex items-center justify-between border-t border-[#292528] pt-2.5 text-[10px] text-[#82787B]"><span>Holding value</span><strong className="text-[#F0E9E5]">{i === 0 ? "$4,820" : i === 1 ? "$2,940" : "$1,680"}</strong><button onClick={() => setLiked(liked.includes(i) ? liked.filter(n => n !== i) : [...liked, i])} aria-label="Save movement" className={`tap flex items-center gap-1 ${liked.includes(i) ? "text-[#FF8994]" : "text-[#82787B]"}`}><Heart size={13} fill={liked.includes(i) ? "currentColor" : "none"} /> Track</button></div></article>)}</div>
        </section>}
      </div>

      {messageOpen && <div className="fixed inset-0 z-20 flex items-end justify-center bg-[#100c0c]/75 sm:items-center sm:p-5"><div className="w-full max-w-[430px] rounded-t-2xl border border-[#58322f] bg-[#241a19] p-5 sm:rounded-2xl"><div className="flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#c8776d]">Private note</p><h2 className="mt-1 font-serif text-[23px]">Message Mara</h2></div><button aria-label="Close message" onClick={() => setMessageOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-[#9c827a]"><MoreHorizontal size={18} /></button></div><div className="mt-5 flex items-start gap-3"><Avatar initials="MC" size="small" /><textarea autoFocus value={message} onChange={e => setMessage(e.target.value)} placeholder="Say hello about a card..." className="min-h-[92px] flex-1 resize-none rounded-lg border border-[#49302b] bg-[#1b1414] p-3 text-[12px] leading-5 outline-none placeholder:text-[#725c56] focus:border-[#a45048]" /></div><button disabled={!message.trim()} onClick={sendMessage} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e9443d] text-[11px] font-bold text-white disabled:opacity-35">{sent ? "Message sent" : "Send message"}{sent ? <Check size={14} /> : <Send size={14} />}</button></div></div>}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#383034] bg-[#19181B]/95 px-4 py-2 text-[9px] text-[#9D9295] shadow-xl"><WalletCards size={12} className="text-[#E7B36C]" /> Portfolio snapshot · public view</div>
    </main>
  );
}
