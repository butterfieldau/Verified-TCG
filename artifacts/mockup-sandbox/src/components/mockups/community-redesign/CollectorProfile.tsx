import { useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Grid2X2,
  Heart,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";

type ProfileTab = "collection" | "posts";

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
  const [tab, setTab] = useState<ProfileTab>("collection");
  const [following, setFollowing] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [liked, setLiked] = useState<number[]>([]);
  const [shared, setShared] = useState(false);

  const sendMessage = () => {
    if (!message.trim()) return;
    setSent(true);
    setMessage("");
    window.setTimeout(() => { setSent(false); setMessageOpen(false); }, 1200);
  };

  return (
    <main className="profile-native min-h-[100dvh] bg-[#0A0A0A] text-white [font-family:ui-sans-serif,system-ui,sans-serif]">
      <style>{`
        .profile-native [class*="bg-[#1b1414]"], .profile-native [class*="bg-[#211817]"], .profile-native [class*="bg-[#241a19]"], .profile-native [class*="bg-[#1f1716]"] { background-color:#1A1A1A !important; }
        .profile-native [class*="border-[#3"], .profile-native [class*="border-[#4"], .profile-native [class*="border-[#5"], .profile-native [class*="border-[#342422]"] { border-color:#2A2A2A !important; }
        .profile-native [class*="text-[#f4e7dc]"], .profile-native [class*="text-[#f0dfd4]"], .profile-native [class*="text-[#dfc6ba]"] { color:#FFFFFF !important; }
        .profile-native [class*="text-[#8"], .profile-native [class*="text-[#9"], .profile-native [class*="text-[#7"] { color:#9A9A9A !important; }
        .profile-native [class*="bg-[#e9443d]"] { background-color:#FF1E2D !important; }
        .profile-native .font-serif { font-family:inherit; font-weight:700; }
        .profile-native .font-mono { font-family:inherit; }
      `}</style>
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-hidden border-x border-[#382523] bg-[radial-gradient(circle_at_90%_0%,#3b2421_0%,transparent_35%),#1b1414]">
        <header className="flex items-center justify-between px-5 pb-3 pt-4">
          <button aria-label="Go back" className="flex h-10 w-10 items-center justify-center rounded-full text-[#c0aaa0] hover:bg-white/5"><ArrowLeft size={19} /></button>
          <p className="font-mono text-[10px] uppercase tracking-[.24em] text-[#a88d84]">Collector profile</p>
          <button aria-label="More profile options" className="flex h-10 w-10 items-center justify-center rounded-full text-[#c0aaa0] hover:bg-white/5"><MoreHorizontal size={20} /></button>
        </header>

        <section className="px-5 pb-5 pt-3">
          <div className="flex items-start gap-4">
            <div className="relative"><Avatar initials="MC" /><button aria-label="Change profile photo" className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#1b1414] bg-[#e9443d] text-white"><Camera size={12} /></button></div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center gap-1.5"><h1 className="font-serif text-[25px] leading-none tracking-[-.02em]">Mara Chen</h1><span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#FF1E2D] text-white"><Check size={11} strokeWidth={3} /></span></div>
              <p className="mt-1 text-xs text-[#987f77]">@marachens · Tokyo, JP</p>
              <div className="mt-3 flex gap-2"><button onClick={() => setFollowing(!following)} className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-[11px] font-bold transition-transform active:scale-95 ${following ? "border border-[#70413a] bg-transparent text-[#e17b6d]" : "bg-[#e9443d] text-white"}`}>{following ? <Check size={13} /> : <UserPlus size={13} />}{following ? "Following" : "Follow"}</button><button onClick={() => setMessageOpen(true)} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#58322f] px-4 text-[11px] font-bold text-[#edc2b4] hover:bg-white/5"><MessageCircle size={14} /> Message</button></div>
            </div>
          </div>
          <p className="mt-5 max-w-[360px] text-[13px] leading-[1.55] text-[#c3aaa0]">Sealed product, Japanese promos, and the stories behind the cardboard. Collecting slowly, looking closely.</p>
          <div className="mt-5 flex items-center justify-between border-y border-[#342422] py-3.5">
            <div><p className="font-serif text-[19px]">486</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#806b64]">Cards</p></div>
            <button onClick={() => alert("Followers list coming from the community roster.")} className="text-left"><p className="font-serif text-[19px]">1.2k</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#806b64]">Followers</p></button>
            <button onClick={() => alert("Following list coming from the community roster.")} className="text-left"><p className="font-serif text-[19px]">89</p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#806b64]">Following</p></button>
            <div><p className="flex items-center gap-1 font-serif text-[19px]">A+ <Sparkles size={13} className="text-[#e7b36c]" /></p><p className="font-mono text-[8px] uppercase tracking-[.14em] text-[#806b64]">Trust score</p></div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#b89583]"><LockKeyhole size={13} className="text-[#e7b36c]" /> Identity verified · Collector since 2018 <ChevronRight size={13} className="ml-auto text-[#806b64]" /></div>
        </section>

        <div className="flex border-y border-[#342422] px-5">
          <button onClick={() => setTab("collection")} className={`relative flex h-12 flex-1 items-center justify-center gap-2 text-[11px] font-bold ${tab === "collection" ? "text-[#f4e7dc]" : "text-[#806b64]"}`}><Grid2X2 size={15} /> Collection{tab === "collection" && <span className="absolute bottom-0 h-[2px] w-10 rounded-full bg-[#e9443d]" />}</button>
          <button onClick={() => setTab("posts")} className={`relative flex h-12 flex-1 items-center justify-center gap-2 text-[11px] font-bold ${tab === "posts" ? "text-[#f4e7dc]" : "text-[#806b64]"}`}><MessageCircle size={15} /> Posts{tab === "posts" && <span className="absolute bottom-0 h-[2px] w-10 rounded-full bg-[#e9443d]" />}</button>
        </div>

        {tab === "collection" ? <section className="px-5 pb-10 pt-5">
          <div className="mb-4 flex items-end justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#c8776d]">Curated shelves</p><h2 className="mt-1 font-serif text-[22px]">Collection highlights</h2></div><button aria-label="Filter shelves" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#4b2d29] text-[#c18f82]"><SlidersHorizontal size={16} /></button></div>
          <div className="space-y-3">{shelves.map((shelf, i) => <button key={shelf.title} onClick={() => alert(`Opening ${shelf.title}`)} className="group flex w-full items-center gap-3 rounded-xl border border-[#3b2825] bg-[#241a19] p-3 text-left transition-colors hover:border-[#70403a]"><div className="flex -space-x-3">{shelf.cards.map((kind, j) => <div key={kind} className="relative rounded-[10px] border-2 border-[#241a19]" style={{ zIndex: 3 - j }}><CardArt kind={kind} compact /></div>)}</div><div className="min-w-0 flex-1 pl-1"><h3 className="text-[13px] font-bold text-[#f0dfd4]">{shelf.title}</h3><p className="mt-1 text-[10px] text-[#90776f]">{shelf.count} · <span style={{ color: shelf.accent }}>View shelf</span></p></div><ChevronRight size={16} className="text-[#735b55] transition-transform group-hover:translate-x-0.5" /></button>)}</div>
          <div className="mt-7 flex items-center justify-between"><h2 className="font-serif text-[20px]">Recent additions</h2><button onClick={() => alert("Opening the full collection.")} className="text-[10px] font-bold text-[#e47b6e]">View all</button></div>
          <div className="mt-3 grid grid-cols-3 gap-2">{postCards.map(card => <button key={card.name} onClick={() => alert(`Opening ${card.name}`)} className="text-left"><CardArt kind={card.kind} /><p className="mt-2 truncate text-[10px] font-bold text-[#dfc6ba]">{card.name}</p><p className="mt-0.5 truncate font-mono text-[8px] text-[#806b64]">{card.set}</p></button>)}</div>
        </section> : <section className="px-5 pb-10 pt-5"><div className="mb-4 flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#c8776d]">From the lounge</p><h2 className="mt-1 font-serif text-[22px]">Mara's posts</h2></div><span className="text-[10px] text-[#806b64]">24 posts</span></div><div className="space-y-4">{postCards.map((card, i) => <article key={card.name} className="rounded-xl border border-[#3b2825] bg-[#241a19] p-3.5"><div className="flex items-center gap-2.5"><Avatar initials="MC" size="small" /><div className="flex-1"><p className="text-[11px] font-bold">Mara Chen <span className="font-normal text-[#806b64]">· {i + 1}d</span></p><p className="text-[9px] text-[#806b64]">@marachens</p></div><MoreHorizontal size={16} className="text-[#806b64]" /></div><p className="mt-3 text-[12px] leading-5 text-[#c5ada2]">{i === 0 ? "The texture on this one is unreal in hand. Found it tucked behind a stack of commons at Nakano Broadway." : i === 1 ? "Small mail day, big feeling. The seller included the original receipt and a note from 2001." : "Some cards earn their place by rarity. This one earned it by making me stop and look."}</p><div className="mt-3 flex gap-3 rounded-lg border border-[#49302b] bg-[#1f1716] p-2"><div className="w-[57px] shrink-0"><CardArt kind={card.kind} compact /></div><div className="flex min-w-0 flex-1 flex-col justify-center"><p className="truncate text-[11px] font-bold">{card.name}</p><p className="mt-1 text-[9px] text-[#866f68]">{card.set} · Verified</p></div></div><div className="mt-2 flex items-center gap-1 text-[#8e756d]"><button aria-label="Like post" onClick={() => setLiked(liked.includes(i) ? liked.filter(n => n !== i) : [...liked, i])} className={`flex h-9 items-center gap-1.5 px-1 text-[10px] ${liked.includes(i) ? "text-[#e9443d]" : ""}`}><Heart size={15} fill={liked.includes(i) ? "currentColor" : "none"} />{card.likes + (liked.includes(i) ? 1 : 0)}</button><button aria-label="Comment on post" className="flex h-9 items-center gap-1.5 px-1 text-[10px]"><MessageCircle size={15} />{i + 8}</button><button aria-label="Share post" onClick={() => setShared(true)} className="ml-auto flex h-9 items-center px-1">{shared ? <Check size={15} className="text-[#e7b36c]" /> : <Share2 size={15} />}</button></div></article>)}</div></section>}
      </div>

      {messageOpen && <div className="fixed inset-0 z-20 flex items-end justify-center bg-[#100c0c]/75 sm:items-center sm:p-5"><div className="w-full max-w-[430px] rounded-t-2xl border border-[#58322f] bg-[#241a19] p-5 sm:rounded-2xl"><div className="flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#c8776d]">Private note</p><h2 className="mt-1 font-serif text-[23px]">Message Mara</h2></div><button aria-label="Close message" onClick={() => setMessageOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-[#9c827a]"><MoreHorizontal size={18} /></button></div><div className="mt-5 flex items-start gap-3"><Avatar initials="MC" size="small" /><textarea autoFocus value={message} onChange={e => setMessage(e.target.value)} placeholder="Say hello about a card..." className="min-h-[92px] flex-1 resize-none rounded-lg border border-[#49302b] bg-[#1b1414] p-3 text-[12px] leading-5 outline-none placeholder:text-[#725c56] focus:border-[#a45048]" /></div><button disabled={!message.trim()} onClick={sendMessage} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e9443d] text-[11px] font-bold text-white disabled:opacity-35">{sent ? "Message sent" : "Send message"}{sent ? <Check size={14} /> : <Send size={14} />}</button></div></div>}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#4c2b28] bg-[#241a19]/95 px-4 py-2 text-[9px] text-[#9d8179] shadow-xl"><Users size={12} className="text-[#e7b36c]" /> 12 collectors viewing this profile</div>
    </main>
  );
}
