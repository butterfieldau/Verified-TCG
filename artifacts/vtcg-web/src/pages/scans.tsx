import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Activity } from "lucide-react";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { TierBadge, fmtNum, StatCard, SkeletonCard, ErrorBanner } from "@/components/admin-ui";

interface ScanData {
  totalScans: number;
  scansThisMonth: number;
  usersAtQuota: number;
  freeScanLimit: number;
  monthlyData: { period: string; label: string; total: number }[];
  topScanners: {
    userId: string;
    displayName: string;
    username: string;
    subscriptionTier: string;
    totalScans: number;
  }[];
}

export default function ScansPage() {
  const { logout } = useAuth();
  const [data, setData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ScanData>("/admin/scan-usage")
      .then(setData)
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load scan data.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Scans</h1>
      <p className="text-sm text-muted-foreground mb-8">Scanning analytics and usage by user.</p>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <StatCard label="TOTAL SCANS" value={data.totalScans} />
            <StatCard label="SCANS THIS MONTH" value={data.scansThisMonth} />
            <StatCard label="FREE USERS AT QUOTA" value={data.usersAtQuota} sub={`${data.freeScanLimit} scan limit`} accent={data.usersAtQuota > 0} />
          </>
        ) : null}
      </div>

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">MONTHLY SCANS</h2>
      <div className="bg-card border border-border rounded-xl p-4 md:p-6 mb-8">
        {loading ? (
          <div className="h-48 flex items-center justify-center"><div className="text-sm text-muted-foreground animate-pulse">Loading chart…</div></div>
        ) : !data || data.monthlyData.length === 0 ? (
          <div className="h-48 flex items-center justify-center"><div className="text-sm text-muted-foreground">No scan data yet.</div></div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.monthlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700 }} itemStyle={{ color: "hsl(var(--primary))" }} />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Scans" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">TOP SCANNERS</h2>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div>
          <div className="hidden sm:grid grid-cols-[40px_1fr_140px_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>#</span><span>USER</span><span>TIER</span><span className="text-right">TOTAL SCANS</span>
          </div>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[32px_1fr_auto] sm:grid-cols-[40px_1fr_140px_120px] gap-3 sm:gap-4 px-4 sm:px-5 py-4 border-b border-border animate-pulse">
                {Array.from({ length: 4 }).map((_, j) => <div key={j} className={`${j === 2 ? "hidden sm:block" : ""} h-3 bg-border rounded w-12`} />)}
              </div>
            ))
          ) : !data || data.topScanners.length === 0 ? (
            <div className="py-12 text-center">
              <Activity size={28} className="text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No scan data yet.</p>
            </div>
          ) : (
            data.topScanners.map((scanner, idx) => (
              <div key={scanner.userId} className="grid grid-cols-[32px_1fr_auto] sm:grid-cols-[40px_1fr_140px_120px] gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 border-b border-border items-center hover:bg-background/50 transition-colors">
                <span className="text-sm text-muted-foreground font-mono pl-1">{idx + 1}</span>
                <div className="min-w-0 pr-4">
                  <div className="text-sm font-semibold truncate">{scanner.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">@{scanner.username}</div>
                  <div className="mt-1 sm:hidden"><TierBadge tier={scanner.subscriptionTier} founding={false} /></div>
                </div>
                <div className="hidden sm:block"><TierBadge tier={scanner.subscriptionTier} founding={false} /></div>
                <div className="text-sm font-bold text-right tabular-nums">{fmtNum(scanner.totalScans)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
