import { Star, Crown, User, AlertTriangle } from "lucide-react";

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtNum(n: number) {
  return n.toLocaleString();
}

export function TierBadge({ tier, founding }: { tier: string; founding: boolean }) {
  if (tier === "pro" && founding) {
    return (
      <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold px-2 py-0.5 rounded-full">
        <Star size={10} /> FOUNDING PRO
      </span>
    );
  }
  if (tier === "pro") {
    return (
      <span className="inline-flex items-center gap-1 bg-primary/20 text-primary border border-primary/40 text-xs font-bold px-2 py-0.5 rounded-full">
        <Crown size={10} /> PRO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-400 border border-zinc-700 text-xs font-bold px-2 py-0.5 rounded-full">
      <User size={10} /> FREE
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs font-bold text-muted-foreground tracking-wider mb-2">{label}</div>
      <div
        className={`font-display text-3xl font-bold leading-none ${accent ? "text-primary" : "text-foreground"}`}
      >
        {typeof value === "number" ? fmtNum(value) : value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
      <div className="h-3 bg-border rounded w-24 mb-3" />
      <div className="h-8 bg-border rounded w-16" />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-negative/10 border border-negative/30 text-negative rounded-xl px-4 py-3 text-sm mb-6">
      <AlertTriangle size={15} className="shrink-0" /> {message}
    </div>
  );
}
