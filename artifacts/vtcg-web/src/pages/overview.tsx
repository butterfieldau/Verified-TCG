import { useState, useEffect } from "react";
import { Link } from "wouter";
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
import { Activity, AlertCircle, ArrowRight, ExternalLink } from "lucide-react";

interface Comparison {
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
}

interface OverviewData {
  range: { preset: string; start: string; end: string; days: number };
  totals: {
    totalUsers: number | null;
    proUsers: number | null;
    freeUsers: number | null;
    foundingMembers: number | null;
    signupsInRange: number | null;
    scansInCoveredMonths: number | null;
    unresolvedReports: number | null;
    unresolvedSupport: number | null;
  };
  comparisons: Record<string, Comparison | undefined>;
  trends: { dailySignups: { date: string; count: number }[] };
  dataAvailability: Record<string, { available: boolean; reason?: string }>;
}

interface ActivityData {
  events: {
    kind: string;
    eventType: string;
    label: string | null;
    createdAt: string;
  }[];
}

interface AttentionData {
  items: {
    type: string;
    priority: number;
    count: number;
    label: string;
    deepLink: string;
  }[];
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

function formatComparison(value?: Comparison) {
  if (!value) return null;
  if (value.percentChange === null) {
    return (
      <span>
        {value.previous === 0
          ? "No prior-period baseline"
          : `${value.delta >= 0 ? "+" : ""}${value.delta} vs prior period`}
      </span>
    );
  }
  return (
    <span>
      {value.percentChange >= 0 ? "+" : ""}
      {value.percentChange}% vs prior period
    </span>
  );
}

function activityDescription(event: ActivityData["events"][number]) {
  if (event.eventType === "user_signup") return `Collector @${event.label ?? "unknown"} joined`;
  if (event.eventType === "report_submitted") return "A collector report was submitted";
  if (event.eventType === "contact_submitted") {
    return `Support request received${event.label ? ` · ${event.label}` : ""}`;
  }
  const action = event.eventType.replaceAll("_", " ");
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}${event.label ? ` · ${event.label}` : ""}`;
}

export default function OverviewPage() {
  const { logout } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [activity, setActivity] = useState<ActivityData["events"]>([]);
  const [attention, setAttention] = useState<AttentionData["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState("30d");

  useEffect(() => {
    setLoading(true);
    const query = `preset=${dateRange}`;
    Promise.all([
      apiFetch<OverviewData>(`/admin/overview?${query}`),
      apiFetch<ActivityData>(`/admin/activity?${query}&limit=12`),
      apiFetch<AttentionData>(`/admin/attention?${query}`),
    ])
      .then(([overview, activityResult, attentionResult]) => {
        setData(overview);
        setActivity(activityResult.events);
        setAttention(attentionResult.items);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load statistics.");
      })
      .finally(() => setLoading(false));
  }, [logout, dateRange]);

  const chartData = data
    ? fillDailySignups(data.trends.dailySignups, dateRange === "7d" ? 7 : dateRange === "90d" ? 90 : 30)
    : [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Platform Overview</h1>
          <p className="text-sm text-muted-foreground">Live platform statistics and operational health.</p>
        </div>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors min-w-[120px]"
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}

      {!loading && (
        <div className="mb-8 space-y-3">
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider">NEEDS ATTENTION</h2>
          {attention.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attention.map((item) => (
                <Link
                  key={item.type}
                  href={item.deepLink}
                  className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${
                    item.priority === 1
                      ? "bg-negative/5 border-negative/30 hover:bg-negative/10"
                      : item.priority === 2
                        ? "bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10"
                        : "bg-card border-border hover:bg-background"
                  }`}
                >
                  <AlertCircle
                    className={`mt-0.5 shrink-0 ${
                      item.priority === 1
                        ? "text-negative"
                        : item.priority === 2
                          ? "text-amber-500"
                          : "text-muted-foreground"
                    }`}
                    size={16}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm">{item.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.count} item{item.count === 1 ? "" : "s"} in this date range
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground opacity-50 shrink-0 self-center" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-positive/20 bg-positive/5 px-4 py-3 text-sm text-positive">
              No unresolved items were found in this date range.
            </div>
          )}
        </div>
      )}

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">USERS</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <StatCard label="TOTAL USERS" value={data.totals.totalUsers ?? "Unavailable"} />
            <StatCard label="PRO PLAN" value={data.totals.proUsers ?? "Unavailable"} accent />
            <StatCard label="FREE PLAN" value={data.totals.freeUsers ?? "Unavailable"} />
            <StatCard label="FOUNDING PRO" value={data.totals.foundingMembers ?? "Unavailable"} />
            <StatCard
              label={`NEW · ${data.range.days} DAYS`}
              value={data.totals.signupsInRange ?? "Unavailable"}
              sub={formatComparison(data.comparisons.users)}
            />
            <StatCard
              label="OPEN REPORTS"
              value={data.totals.unresolvedReports ?? "Unavailable"}
              sub={formatComparison(data.comparisons.reports)}
            />
            <StatCard
              label="OPEN SUPPORT"
              value={data.totals.unresolvedSupport ?? "Unavailable"}
              sub={formatComparison(data.comparisons.support)}
            />
            <StatCard
              label="PRO PLAN SHARE"
              value={
                data.totals.totalUsers !== null &&
                data.totals.proUsers !== null &&
                data.totals.totalUsers > 0
                  ? `${Math.round((data.totals.proUsers / data.totals.totalUsers) * 1000) / 10}%`
                  : "—"
              }
              sub="Platform plan state, not paid conversion"
              accent
            />
          </>
        ) : null}
      </div>

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">SCANNING & PAYMENTS</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-8">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <StatCard
              label="SCANS · COVERED MONTHS"
              value={data.totals.scansInCoveredMonths ?? "Unavailable"}
              sub="Monthly cumulative buckets; exact daily comparison unavailable"
            />
            <StatCard label="SCAN HISTORY" value="Limited" sub={data.dataAvailability.scans?.reason} />
            <div className="bg-card border border-border rounded-xl p-5 flex flex-col justify-center">
              <div className="text-xs font-bold text-muted-foreground tracking-wider mb-2">REVENUE</div>
              <div className="font-display text-2xl font-bold leading-none text-muted-foreground/50">—</div>
              <div className="text-xs text-amber-500/80 mt-2 flex items-center gap-1.5 font-medium">
                 <ExternalLink size={12} /> Provider revenue and charges unavailable
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">SIGNUP TREND</h2>
          <div className="bg-card border border-border rounded-xl p-4 md:p-6">
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-sm text-muted-foreground animate-pulse">Loading chart…</div>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-sm text-muted-foreground">No signup data for this period.</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={30}
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
                    cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Signups" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">ACTIVITY TIMELINE</h2>
          <div className="bg-card border border-border rounded-xl p-0 overflow-hidden">
            {loading ? (
               <div className="p-6 flex items-center justify-center h-64">
                 <div className="text-sm text-muted-foreground animate-pulse">Loading activity…</div>
               </div>
            ) : activity.length > 0 ? (
              <div className="divide-y divide-border">
                {activity.map((event, index) => (
                  <div key={`${event.eventType}-${event.createdAt}-${index}`} className="p-4 flex gap-3 hover:bg-background transition-colors">
                    <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{activityDescription(event)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center h-64 flex flex-col items-center justify-center">
                <Activity size={24} className="text-muted-foreground opacity-30 mb-2" />
                <div className="text-sm text-muted-foreground">No recent activity</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
