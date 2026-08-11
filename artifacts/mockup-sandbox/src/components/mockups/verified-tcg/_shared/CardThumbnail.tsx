import React from "react";
import { GradeBadge } from "./GradeBadge";
export function CardThumbnail({ card, compact = false }: { card: any; compact?: boolean }) {
  return <div className={`relative shrink-0 overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br ${card.color} ${compact ? "h-40 w-28" : "h-48 w-36"} shadow-xl`}>
    <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(135deg, transparent 35%, rgba(255,255,255,.55) 50%, transparent 65%)" }} />
    <div className="absolute left-2 top-2 rounded bg-black/30 px-1.5 py-0.5 text-[8px] font-bold text-white">{card.number}</div>
    <div className="absolute left-3 top-10 text-3xl font-black italic text-white/80">{card.name.split(" ")[0]}</div>
    <div className="absolute right-2 top-2"><GradeBadge grade={card.grade} grader={card.grader} /></div>
    <div className="absolute bottom-0 w-full bg-black/75 p-2"><p className="truncate text-xs font-bold text-white">{card.name}</p><p className="text-[10px] text-zinc-300">${card.value.toLocaleString()}</p></div>
  </div>;
}