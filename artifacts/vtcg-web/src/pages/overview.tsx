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
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { StatCard, SkeletonCard, ErrorBanner } from "@/components/admin-ui";

interface StatsData {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  foundingMembers: number;
  signupsToday: number;
  signupsThisWeek: number;
  signupsThisMonth: number;
  totalScans: number;
  scansThisMonth: number;
  proConversionRate: number;
  dailySignups: { date: string; count: number }[];
}

function fillDailySignups(
  data: { date: string; count: number }[],
  days = 30,
): { label: string; count: number }[] {
  const map = new Map(data.map((d) => [d.date, d.count]));
  const result: { label: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      count: map.get(key) ?? 0,
    });
  }
  return result;
}

export default function OverviewPage() {
  const { logout } = useAuth();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StatsData>("/admin/stats")
      .then(setData)
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load statistics.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  const chartData = data ? fillDailySignups(data.dailySignups) : [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Platform Overview</h1>
      <p className="text-sm text-muted-foreground mb-8">Live platform statistics — updated on each page load.</p>

      {error && <ErrorBanner message={error} />}

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">USERS</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <StatCard label="TOTAL USERS" value={data.totalUsers} />
            <StatCard label="PRO USERS" value={data.proUsers} accent />
            <StatCard label="FREE USERS" value={data.freeUsers} />
            <StatCard label="FOUNDING PRO" value={data.foundingMembers} />
            <StatCard label="SIGNUPS TODAY" value={data.signupsToday} />
            <StatCard label="SIGNUPS THIS WEEK" value={data.signupsThisWeek} />
            <StatCard label="SIGNUPS THIS MONTH" value={data.signupsThisMonth} />
            <StatCard
              label="PRO CONVERSION"
              value={`${data.proConversionRate}%`}
              sub={`${data.proUsers} of ${data.totalUsers} users`}
              accent
            />
          </>
        ) : null}
      </div>

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">SCANNING</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-8">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <StatCard label="TOTAL SCANS" value={data.totalScans} />
            <StatCard label="SCANS THIS MONTH" value={data.scansThisMonth} />
            <StatCard label="REVENUE" value="—" sub="Provider not connected" />
          </>
        ) : null}
      </div>

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">30-DAY SIGNUPS</h2>
      <div className="bg-card border border-border rounded-xl p-4 md:p-6 mb-8">
        {loading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="text-sm text-muted-foreground animate-pulse">Loading chart…</div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">No signup data yet.</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700 }}
                itemStyle={{ color: "hsl(var(--primary))" }}
              />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Signups" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {data && (
        <div className="bg-card border border-border rounded-xl p-4 md:p-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold">Pro Conversion Rate</span>
            <span className="text-sm font-bold text-primary">{data.proConversionRate}%</span>
          </div>
          <div className="h-2.5 w-full bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, data.proConversionRate)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{data.proUsers} Pro users</span>
            <span>{data.totalUsers} total users</span>
          </div>
        </div>
      )}
    </div>
  );
}
