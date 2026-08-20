import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { StatCard, SkeletonCard, ErrorBanner } from "@/components/admin-ui";
import { Info, ExternalLink } from "lucide-react";

interface AnalyticsData {
  range: { preset: string; start: string; end: string };
  tracking: { startedAt: string | null; historyLimited: boolean; reason?: string; retainedEvents: boolean };
  acquisition: { signups: number; totalUsers: number; daily: { date: string; count: number }[]; priorPeriodSignups: number | null };
  activeUsers: { daily: number; weekly: number; monthly: number; inRange: number; definition: string };
  retention: { 
    available: boolean; 
    reason?: string; 
    cohorts: { cohortWeek: string; signups: number; eligibleSignups: number; eligible: boolean; returnedWeek1: number | null; retainedWeek1Rate: number | null }[];
  };
  onboarding: { 
    available: boolean; 
    reason?: string; 
    steps: { key: string; label: string; count: number; conversionRate: number }[];
  };
  adoption: { features: { key: string; label: string; users: number; events: number }[] };
  performance: {
    requests: number;
    errors: number;
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    series: { date: string; requests: number; errors: number; p95Ms: number | null }[];
  };
  comparisons: {
    available: boolean;
    reason: string | null;
    signups: { current: number; prior: number } | null;
    activeUsers: { current: number; prior: number | null } | null;
    errorRate: { current: number; prior: number | null } | null;
  };
  dataAvailability: { revenue?: { available: boolean; reason?: string } };
}

export default function AnalyticsPage() {
  const { logout } = useAuth();
  
  const queryParams = new URLSearchParams(window.location.search);
  const initialPreset = queryParams.get("preset") || "30d";
  const initialStart = queryParams.get("start") || "";
  const initialEnd = queryParams.get("end") || "";
  
  const [dateRange, setDateRange] = useState(initialPreset);
  const [customStart, setCustomStart] = useState(initialStart);
  const [customEnd, setCustomEnd] = useState(initialEnd);
  
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    
    if (dateRange === "custom" && (!customStart || !customEnd)) {
      setLoading(false);
      return; // Wait until both are provided
    }

    const url = new URL(window.location.href);
    url.searchParams.set("preset", dateRange);
    if (dateRange === "custom") {
      url.searchParams.set("start", customStart);
      url.searchParams.set("end", customEnd);
    } else {
      url.searchParams.delete("start");
      url.searchParams.delete("end");
    }
    window.history.replaceState(null, "", url.toString());

    setLoading(true);
    let qs = `preset=${dateRange}`;
    if (dateRange === "custom") qs += `&start=${customStart}&end=${customEnd}`;

    apiFetch<AnalyticsData>(`/admin/intelligence/analytics?${qs}`)
      .then((res) => {
        if (!active) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) logout();
        else setError(err instanceof Error ? err.message : "Failed to load analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
      
    return () => { active = false; };
  }, [logout, dateRange, customStart, customEnd]);

  const perfData = data?.performance?.series?.map(s => ({
    ...s,
    p95Ms: s.p95Ms ?? 0 // handle nulls for charting
  })) || [];

  const comparisonText = (comparison: { current: number; prior: number | null } | null | undefined) =>
    comparison && comparison.prior !== null
      ? `Prior period: ${comparison.prior.toLocaleString()}`
      : data?.comparisons.reason || undefined;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Platform Analytics</h1>
          <p className="text-sm text-muted-foreground">Adoption, retention, and API telemetry.</p>
        </div>
        <div className="flex gap-2 items-center">
          {dateRange === "custom" && (
            <div className="flex gap-2">
              <input 
                type="date" 
                value={customStart} 
                onChange={e => setCustomStart(e.target.value)} 
                className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" 
              />
              <input 
                type="date" 
                value={customEnd} 
                onChange={e => setCustomEnd(e.target.value)} 
                className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" 
              />
            </div>
          )}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors min-w-[120px]"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {!loading && data?.tracking?.historyLimited && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-amber-300 text-sm">
          <Info className="shrink-0 mt-0.5" size={16} />
          <div>
            <div className="font-bold">History Limited</div>
            <div>{data.tracking.reason || "Some historical data is unavailable prior to tracking implementation."}</div>
          </div>
        </div>
      )}

      <section>
        <div className="flex justify-between items-end mb-3">
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Audience & Activity</h2>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Metrics are retained telemetry based on selected range</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading && !data ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : data ? (
            <>
              <StatCard label="TOTAL USERS (SNAPSHOT)" value={data.acquisition.totalUsers} />
              <StatCard label="SIGNUPS (IN RANGE)" value={data.acquisition.signups} sub={comparisonText(data.comparisons.signups)} accent />
              <StatCard label="ACTIVE (LAST 24H)" value={data.activeUsers.daily} sub={data.activeUsers.definition} />
              <StatCard label="MONTHLY ACTIVE" value={data.activeUsers.monthly} sub={comparisonText(data.comparisons.activeUsers)} />
            </>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="mb-5">
            <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Acquisition Trend</h2>
            <p className="text-xs text-muted-foreground mt-1">Accounts created per retained UTC day</p>
          </div>
          {loading && !data ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading chart...</div>
          ) : data && data.acquisition.daily.some(day => day.count > 0) ? (
            <div className="h-64" aria-label="Daily account creation chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.acquisition.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(value: string) =>
                      new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    }
                  />
                  <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={28} />
                  <RechartsTooltip
                    labelFormatter={(value) => new Date(`${String(value)}T00:00:00Z`).toLocaleDateString()}
                    contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))" }}
                  />
                  <Bar dataKey="count" name="Accounts created" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No account creation events were retained in this period.</div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="mb-5">
            <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Feature Adoption</h2>
            <p className="text-xs text-muted-foreground mt-1">Distinct collectors using tracked product areas</p>
          </div>
          {loading && !data ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading adoption...</div>
          ) : data && data.adoption.features.some(feature => feature.users > 0) ? (
            <div className="space-y-4">
              {data.adoption.features.map(feature => {
                const maxUsers = Math.max(...data.adoption.features.map(item => item.users), 1);
                const width = Math.max(4, (feature.users / maxUsers) * 100);
                return (
                  <div key={feature.key}>
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <span className="text-sm font-semibold">{feature.label}</span>
                      <span className="text-sm tabular-nums">
                        {feature.users.toLocaleString()} users · {feature.events.toLocaleString()} events
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${width}%` }}
                        role="img"
                        aria-label={`${feature.label}: ${feature.users} distinct users`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No tracked feature-use events were retained in this period.</div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 uppercase">Onboarding Funnel</h2>
          <div className="bg-card border border-border rounded-xl p-5 min-h-[200px] overflow-x-auto">
            {loading && !data ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading...</div>
            ) : data && data.onboarding.available ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 font-medium">Step</th>
                    <th className="pb-2 font-medium text-right">Users</th>
                    <th className="pb-2 font-medium text-right">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.onboarding.steps.map(step => (
                    <tr key={step.key}>
                      <td className="py-2.5 font-medium">{step.label}</td>
                      <td className="py-2.5 text-right font-mono">{step.count.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-mono">{(step.conversionRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{data?.onboarding?.reason || "Onboarding data unavailable."}</div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 uppercase">Retention Cohorts (Week 1)</h2>
          <div className="bg-card border border-border rounded-xl p-5 min-h-[200px] overflow-x-auto">
            {loading && !data ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading...</div>
            ) : data && data.retention.available ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 font-medium">Cohort Week</th>
                    <th className="pb-2 font-medium text-right">Signups</th>
                    <th className="pb-2 font-medium text-right">Retained W1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.retention.cohorts.map(cohort => (
                    <tr key={cohort.cohortWeek}>
                      <td className="py-2.5 font-medium">{new Date(cohort.cohortWeek).toLocaleDateString()}</td>
                      <td className="py-2.5 text-right font-mono">{cohort.signups.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-mono">
                        {cohort.eligible && cohort.retainedWeek1Rate !== null ? (
                           <span className={cohort.retainedWeek1Rate > 0.2 ? "text-positive font-bold" : ""}>
                             {(cohort.retainedWeek1Rate * 100).toFixed(1)}%
                           </span>
                        ) : (
                           <span className="text-muted-foreground text-xs">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{data?.retention?.reason || "Cohort data unavailable."}</div>
            )}
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 uppercase">API Telemetry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {loading && !data ? (
             Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : data ? (
            <>
              <StatCard label="TOTAL REQUESTS" value={data.performance.requests} />
              <StatCard
                label="ERROR RATE"
                value={`${(data.performance.errorRate * 100).toFixed(2)}%`}
                sub={
                  data.comparisons.errorRate?.prior !== null && data.comparisons.errorRate
                    ? `Prior period: ${(data.comparisons.errorRate.prior * 100).toFixed(2)}%`
                    : data.comparisons.reason || undefined
                }
                accent={data.performance.errorRate >= 0.05}
              />
              <StatCard label="P50 LATENCY" value={data.performance.p50Ms !== null ? `${Math.round(data.performance.p50Ms)}ms` : "—"} />
              <StatCard label="P95 LATENCY" value={data.performance.p95Ms !== null ? `${Math.round(data.performance.p95Ms)}ms` : "—"} />
            </>
          ) : null}
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6 h-72">
           {loading && !data ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading chart...</div>
           ) : perfData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No telemetry data available.</div>
           ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perfData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    yAxisId="left"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip 
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700 }}
                  />
                  <Line yAxisId="left" type="monotone" dataKey="requests" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Requests" />
                  <Line yAxisId="right" type="monotone" dataKey="p95Ms" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="P95 Latency" />
                </LineChart>
              </ResponsiveContainer>
           )}
        </div>
      </section>

      {!loading && data?.dataAvailability?.revenue?.available === false && (
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col justify-center max-w-sm">
          <div className="text-xs font-bold text-muted-foreground tracking-wider mb-2">REVENUE</div>
          <div className="font-display text-2xl font-bold leading-none text-muted-foreground/50">—</div>
          <div className="text-xs text-amber-500/80 mt-2 flex items-center gap-1.5 font-medium">
             <ExternalLink size={12} /> {data.dataAvailability.revenue.reason || "Revenue data unavailable"}
          </div>
        </div>
      )}
    </div>
  );
}
