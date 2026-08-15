/**
 * Verified TCG — Owner Admin Dashboard
 *
 * Auth is handled via an HttpOnly server-side session cookie.
 * The browser never stores the raw ADMIN_SECRET; it is sent once to the
 * login endpoint which issues the session cookie and discards the secret.
 *
 * Sections: Overview · Users · Scans · Reports · Contact
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Shield,
  LayoutDashboard,
  Users,
  ScanLine,
  Flag,
  MessageSquare,
  LogOut,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  Crown,
  Star,
  User,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  RotateCcw,
  Activity,
  Ban,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// The API server is always mounted at /api regardless of this artifact's
// BASE_URL path (/vtcg-web). Use an absolute path so requests don't become
// /vtcg-web/api which is the wrong origin prefix.
const API = "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  username: string;
  subscriptionTier: string;
  isFoundingMember: boolean;
  createdAt: string;
  avatarUrl?: string | null;
  location?: string | null;
  scansThisMonth: number;
  suspendedAt?: string | null;
}

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

interface ReportRow {
  id: string;
  reason: string;
  note?: string | null;
  createdAt: string;
  reporterUserId: string;
  reportedUserId: string;
  reporterUsername?: string | null;
  reporterDisplayName?: string | null;
  reportedUsername?: string | null;
  reportedDisplayName?: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  submittedAt: string;
}

// ── Fetch helpers (all use credentials: "include" for the session cookie) ─────

class UnauthorizedError extends Error {}

async function apiFetch<T>(path: string): Promise<T> {
  const resp = await fetch(`${API}${path}`, { credentials: "include" });
  if (resp.status === 401) throw new UnauthorizedError("Unauthorized");
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? "Request failed");
  }
  return resp.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (resp.status === 401) throw new UnauthorizedError("Unauthorized");
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? "Request failed");
  }
  return resp.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const resp = await fetch(`${API}${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (resp.status === 401) throw new UnauthorizedError("Unauthorized");
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? "Request failed");
  }
  return resp.json() as Promise<T>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtNum(n: number) {
  return n.toLocaleString();
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

// ── Shared UI ─────────────────────────────────────────────────────────────────

function TierBadge({ tier, founding }: { tier: string; founding: boolean }) {
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

function StatCard({
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

function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
      <div className="h-3 bg-border rounded w-24 mb-3" />
      <div className="h-8 bg-border rounded w-16" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-negative/10 border border-negative/30 text-negative rounded-xl px-4 py-3 text-sm mb-6">
      <AlertTriangle size={15} className="shrink-0" /> {message}
    </div>
  );
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // POST the secret once; the API issues an HttpOnly cookie and discards the secret.
      await apiPost("/admin/auth/login", { secret: secret.trim() });
      setSecret(""); // clear from memory immediately after sending
      onAuthenticated();
    } catch (err) {
      if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Invalid admin secret.")) {
        setError("Invalid secret. Access denied.");
      } else {
        setError("Could not connect to the API. Check that the server is running.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,30,45,0.4)]">
            <Shield size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-xl font-bold tracking-wide leading-none">VERIFIED TCG</div>
            <div className="text-xs text-muted-foreground mt-0.5 tracking-widest">ADMIN DASHBOARD</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-2 tracking-wider">
              ADMIN SECRET
            </label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter your admin secret…"
                autoFocus
                autoComplete="current-password"
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm pr-10 focus:outline-none focus:border-primary transition-colors font-mono placeholder:text-muted-foreground/40"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={show ? "Hide secret" : "Show secret"}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-negative/10 border border-negative/30 text-negative rounded-xl px-4 py-3 text-sm">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !secret.trim()}
            className="w-full py-3 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(255,30,45,0.3)]"
          >
            {loading ? "Verifying…" : "Enter Dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "users", label: "Users", Icon: Users },
  { id: "scans", label: "Scans", Icon: ScanLine },
  { id: "reports", label: "Reports", Icon: Flag },
  { id: "contact", label: "Contact", Icon: MessageSquare },
];

function Sidebar({
  active,
  onNav,
  onLogout,
}: {
  active: string;
  onNav: (id: string) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="w-60 shrink-0 bg-card border-r border-border h-full flex flex-col">
      <div className="p-6 flex items-center gap-3 border-b border-border">
        <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(255,30,45,0.35)]">
          <Shield size={16} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-display text-sm font-bold tracking-wide leading-none">VERIFIED TCG</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 tracking-wider">ADMIN</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNav(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              active === id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-background hover:text-negative transition-all"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewSection({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StatsData>("/admin/stats")
      .then(setData)
      .catch((err) => {
        if (err instanceof UnauthorizedError) onSessionExpired();
        else setError("Failed to load statistics.");
      })
      .finally(() => setLoading(false));
  }, [onSessionExpired]);

  const chartData = data ? fillDailySignups(data.dailySignups) : [];

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold mb-1">Overview</h1>
      <p className="text-sm text-muted-foreground mb-8">Live platform statistics — updated on each page load.</p>

      {error && <ErrorBanner message={error} />}

      <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">USERS</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
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
      <div className="grid grid-cols-3 gap-4 mb-8">
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
      <div className="bg-card border border-border rounded-xl p-6 mb-8">
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
        <div className="bg-card border border-border rounded-xl p-6">
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

// ── User detail panel ─────────────────────────────────────────────────────────

function UserDetailPanel({
  user,
  onClose,
  onSessionExpired,
  onUpdated,
  onDeleted,
}: {
  user: UserRow;
  onClose: () => void;
  onSessionExpired: () => void;
  onUpdated: (updated: UserRow) => void;
  onDeleted: (id: string) => void;
}) {
  const { toast } = useToast();
  const [tier, setTier] = useState(user.subscriptionTier);
  const [founding, setFounding] = useState(user.isFoundingMember);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isSuspended = Boolean(user.suspendedAt);

  useEffect(() => {
    setTier(user.subscriptionTier);
    setFounding(user.isFoundingMember);
    setShowDeleteConfirm(false);
  }, [user.id, user.subscriptionTier, user.isFoundingMember]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await apiPost<{ message: string; user: UserRow }>(
        `/admin/users/${user.id}/subscription`,
        { subscription_tier: tier, is_founding_member: founding },
      );
      onUpdated({ ...user, ...result.user });
      toast({ title: "Saved", description: result.message });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onSessionExpired();
      } else {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Update failed.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspend() {
    setSuspending(true);
    try {
      const result = await apiPost<{ message: string; user: { suspendedAt: string | null } }>(
        `/admin/users/${user.id}/suspend`,
        { suspend: !isSuspended },
      );
      onUpdated({ ...user, suspendedAt: result.user.suspendedAt });
      toast({ title: isSuspended ? "Account unsuspended" : "Account suspended", description: result.message });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onSessionExpired();
      } else {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Action failed.",
          variant: "destructive",
        });
      }
    } finally {
      setSuspending(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiDelete<{ message: string }>(`/admin/users/${user.id}`);
      toast({ title: "Account deleted", description: `${user.displayName}'s account has been permanently deleted.` });
      onDeleted(user.id);
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onSessionExpired();
      } else {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Delete failed.",
          variant: "destructive",
        });
      }
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  const initials = user.displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-background border-l border-border z-50 flex flex-col overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background">
          <span className="text-sm font-bold text-muted-foreground tracking-wider">USER DETAIL</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex-1 space-y-6">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-full border flex items-center justify-center text-xl font-display font-bold shrink-0 ${isSuspended ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-primary/10 border-primary/30 text-primary"}`}>
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-lg truncate">{user.displayName}</div>
              <div className="text-sm text-muted-foreground truncate">@{user.username}</div>
              <div className="text-xs text-muted-foreground/70 truncate font-mono">{user.email}</div>
              {isSuspended && (
                <div className="inline-flex items-center gap-1 mt-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-bold px-2 py-0.5 rounded-full">
                  <Ban size={10} /> SUSPENDED
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {[
              ["User ID", <span key="id" className="font-mono text-xs text-muted-foreground/70 truncate max-w-[200px]">{user.id}</span>],
              ["Current tier", <TierBadge key="tier" tier={user.subscriptionTier} founding={user.isFoundingMember} />],
              ["Member since", <span key="date" className="font-medium">{fmtDate(user.createdAt)}</span>],
              ...(user.location ? [["Location", <span key="loc" className="font-medium">{user.location}</span>]] : []),
              ["Scans this month", <span key="scans" className="font-medium">{user.scansThisMonth}</span>],
              ...(isSuspended ? [["Suspended", <span key="susp" className="font-medium text-amber-400">{fmtDate(user.suspendedAt!)}</span>]] : []),
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">{label}</span>
                {value}
              </div>
            ))}
          </div>

          <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-5 space-y-5">
            <div className="text-xs font-bold text-muted-foreground tracking-wider">UPDATE SUBSCRIPTION</div>

            <div className="grid grid-cols-2 gap-3">
              {(["free", "pro"] as const).map((t) => (
                <label
                  key={t}
                  className={`flex items-center gap-2.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    tier === t ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <input type="radio" name="tier" value={t} checked={tier === t} onChange={() => setTier(t)} className="sr-only" />
                  {t === "pro" ? (
                    <Crown size={15} className={tier === "pro" ? "text-primary" : "text-muted-foreground"} />
                  ) : (
                    <User size={15} className={tier === "free" ? "text-primary" : "text-muted-foreground"} />
                  )}
                  <span className="text-sm font-bold uppercase">{t}</span>
                  {tier === t && <CheckCircle size={14} className="ml-auto text-primary" />}
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between p-3.5 bg-background border border-border rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-amber-500/10 rounded-lg">
                  <Star size={14} className="text-amber-400" />
                </div>
                <div>
                  <div className="text-sm font-bold">Founding Member</div>
                  <div className="text-xs text-muted-foreground">Early supporter badge</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4">
                <input type="checkbox" className="sr-only peer" checked={founding} onChange={(e) => setFounding(e.target.checked)} />
                <div className="w-10 h-6 bg-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 shadow-inner" />
              </label>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => { setTier(user.subscriptionTier); setFounding(user.isFoundingMember); }}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw size={13} /> Reset
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_10px_rgba(255,30,45,0.2)]"
              >
                {saving ? "Saving…" : <><CheckCircle size={14} /> Save Changes</>}
              </button>
            </div>
          </form>

          {/* Suspend / Unsuspend */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="text-xs font-bold text-muted-foreground tracking-wider">ACCOUNT ACTIONS</div>
            <button
              type="button"
              disabled={suspending}
              onClick={handleSuspend}
              className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isSuspended
                  ? "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              <Ban size={15} />
              {suspending ? "Working…" : isSuspended ? "Unsuspend Account" : "Suspend Account"}
              <span className="ml-auto text-xs font-normal opacity-70">
                {isSuspended ? "Restore login access" : "Block login immediately"}
              </span>
            </button>

            {/* Delete */}
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border border-negative/30 bg-negative/5 text-negative text-sm font-bold hover:bg-negative/15 transition-all"
              >
                <Trash2 size={15} />
                Delete Account
                <span className="ml-auto text-xs font-normal opacity-70">Permanent — cannot be undone</span>
              </button>
            ) : (
              <div className="border border-negative/40 bg-negative/5 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="text-negative mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <span className="font-bold text-negative">Permanently delete</span>
                    <span className="text-muted-foreground"> {user.displayName}'s account? This cannot be undone.</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-3 py-2 bg-card border border-border text-sm font-bold rounded-lg hover:bg-background transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className="flex-1 px-3 py-2 bg-negative text-white text-sm font-bold rounded-lg hover:bg-negative/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Users section ─────────────────────────────────────────────────────────────

function UsersSection({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LIMIT = 20;

  const load = useCallback(
    (q: string, t: string, s: string, p: number) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT), sort: s });
      if (q.trim()) params.set("q", q.trim());
      if (t !== "all") params.set("tier", t);

      apiFetch<{ users: UserRow[]; total: number; page: number }>(`/admin/users?${params}`)
        .then((data) => { setUsers(data.users); setTotal(data.total); })
        .catch((err) => {
          if (err instanceof UnauthorizedError) onSessionExpired();
          else setError("Failed to load users.");
        })
        .finally(() => setLoading(false));
    },
    [onSessionExpired],
  );

  useEffect(() => { load(search, tier, sort, page); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(val, tier, sort, 1), 300);
  }

  function handleTierChange(val: string) { setTier(val); setPage(1); load(search, val, sort, 1); }
  function handleSortChange(val: string) { setSort(val); setPage(1); load(search, tier, val, 1); }
  function handlePage(next: number) { setPage(next); load(search, tier, sort, next); }

  function handleUpdated(updated: UserRow) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
    setSelected((s) => (s?.id === updated.id ? { ...s, ...updated } : s));
  }

  function handleDeleted(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setSelected(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Users</h1>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `${fmtNum(total)} total users` : "Manage all collector accounts"}
          </p>
        </div>
      </div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, email, or username…"
            className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
          />
        </div>
        <select value={tier} onChange={(e) => handleTierChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
          <option value="all">All Tiers</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="founding_pro">Founding Pro</option>
        </select>
        <select value={sort} onChange={(e) => handleSortChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
          <option value="date">Newest First</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
        <div className="grid grid-cols-[1fr_1fr_1fr_120px_100px_36px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>USER</span><span>EMAIL</span><span>TIER</span><span>JOINED</span><span>SCANS / MO</span><span />
        </div>

        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_120px_100px_36px] gap-4 px-5 py-4 border-b border-border animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-border shrink-0" />
                <div className="space-y-1.5"><div className="h-3 bg-border rounded w-24" /><div className="h-2.5 bg-border rounded w-16" /></div>
              </div>
              <div className="h-3 bg-border rounded w-32 self-center" />
              <div className="h-5 bg-border rounded-full w-16 self-center" />
              <div className="h-3 bg-border rounded w-20 self-center" />
              <div className="h-3 bg-border rounded w-8 self-center" />
              <div />
            </div>
          ))
        ) : users.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">
              {search || tier !== "all" ? "No users match your filters." : "No users yet."}
            </p>
          </div>
        ) : (
          users.map((user) => (
            <button
              key={user.id}
              onClick={() => setSelected(user)}
              className="w-full grid grid-cols-[1fr_1fr_1fr_120px_100px_36px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {user.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{user.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground truncate">{user.email}</div>
              <TierBadge tier={user.subscriptionTier} founding={user.isFoundingMember} />
              <div className="text-sm text-muted-foreground">{fmtDate(user.createdAt)}</div>
              <div className="text-sm text-muted-foreground">{user.scansThisMonth}</div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          ))
        )}
      </div>

      {!loading && total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages} · {fmtNum(total)} users</span>
          <div className="flex items-center gap-2">
            <button onClick={() => handlePage(page - 1)} disabled={page <= 1} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {selected && (
        <UserDetailPanel
          user={selected}
          onClose={() => setSelected(null)}
          onSessionExpired={onSessionExpired}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

// ── Scans section ─────────────────────────────────────────────────────────────

function ScansSection({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ScanData>("/admin/scan-usage")
      .then(setData)
      .catch((err) => {
        if (err instanceof UnauthorizedError) onSessionExpired();
        else setError("Failed to load scan data.");
      })
      .finally(() => setLoading(false));
  }, [onSessionExpired]);

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold mb-1">Scans</h1>
      <p className="text-sm text-muted-foreground mb-8">Scanning analytics and usage by user.</p>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-3 gap-4 mb-8">
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
      <div className="bg-card border border-border rounded-xl p-6 mb-8">
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
        <div className="grid grid-cols-[28px_1fr_140px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>#</span><span>USER</span><span>TIER</span><span>TOTAL SCANS</span>
        </div>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_140px_100px] gap-4 px-5 py-3.5 border-b border-border animate-pulse">
              {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-12" />)}
            </div>
          ))
        ) : !data || data.topScanners.length === 0 ? (
          <div className="py-12 text-center">
            <Activity size={28} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No scan data yet.</p>
          </div>
        ) : (
          data.topScanners.map((scanner, idx) => (
            <div key={scanner.userId} className="grid grid-cols-[28px_1fr_140px_100px] gap-4 px-5 py-3.5 border-b border-border items-center">
              <span className="text-sm text-muted-foreground font-mono">{idx + 1}</span>
              <div>
                <div className="text-sm font-semibold">{scanner.displayName}</div>
                <div className="text-xs text-muted-foreground">@{scanner.username}</div>
              </div>
              <TierBadge tier={scanner.subscriptionTier} founding={false} />
              <div className="text-sm font-bold">{fmtNum(scanner.totalScans)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Reports section ───────────────────────────────────────────────────────────

function ReportsSection({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportRow | null>(null);

  useEffect(() => {
    apiFetch<{ reports: ReportRow[] }>("/admin/reports")
      .then((data) => setReports(data.reports))
      .catch((err) => {
        if (err instanceof UnauthorizedError) onSessionExpired();
        else setError("Failed to load reports.");
      })
      .finally(() => setLoading(false));
  }, [onSessionExpired]);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-2xl font-bold mb-1">Reports</h1>
      <p className="text-sm text-muted-foreground mb-8">All user-submitted reports. {reports.length > 0 ? `${reports.length} total.` : ""}</p>

      {error && <ErrorBanner message={error} />}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_1fr_140px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>REPORTER</span><span>REPORTED USER</span><span>REASON</span><span>DATE</span><span>STATUS</span>
        </div>

        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_140px_100px] gap-4 px-5 py-4 border-b border-border animate-pulse">
              {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-24" />)}
            </div>
          ))
        ) : reports.length === 0 ? (
          <div className="py-16 text-center">
            <Flag size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          </div>
        ) : (
          reports.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)} className="w-full grid grid-cols-[1fr_1fr_1fr_140px_100px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
              <div className="text-sm font-medium truncate">
                {r.reporterDisplayName ?? r.reporterUserId.slice(0, 8)}
                {r.reporterUsername && <span className="text-muted-foreground ml-1">@{r.reporterUsername}</span>}
              </div>
              <div className="text-sm font-medium truncate">
                {r.reportedDisplayName ?? r.reportedUserId.slice(0, 8)}
                {r.reportedUsername && <span className="text-muted-foreground ml-1">@{r.reportedUsername}</span>}
              </div>
              <div className="text-sm text-muted-foreground capitalize truncate">{r.reason}</div>
              <div className="text-sm text-muted-foreground">{fmtDate(r.createdAt)}</div>
              <span className="text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">PENDING</span>
            </button>
          ))
        )}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-background border border-border rounded-2xl shadow-2xl z-50 p-6">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">REPORT DETAIL</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Reporter</div>
                  <div className="text-sm font-bold">{selected.reporterDisplayName ?? "Unknown"}</div>
                  {selected.reporterUsername && <div className="text-xs text-muted-foreground">@{selected.reporterUsername}</div>}
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Reported User</div>
                  <div className="text-sm font-bold">{selected.reportedDisplayName ?? "Unknown"}</div>
                  {selected.reportedUsername && <div className="text-xs text-muted-foreground">@{selected.reportedUsername}</div>}
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">Reason</div>
                <div className="text-sm font-semibold capitalize">{selected.reason}</div>
              </div>
              {selected.note && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Note from reporter</div>
                  <div className="text-sm text-foreground/90 leading-relaxed">{selected.note}</div>
                </div>
              )}
              <div className="text-xs text-muted-foreground text-right">Reported {fmtDate(selected.createdAt)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Contact section ───────────────────────────────────────────────────────────

function ContactSection({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [submissions, setSubmissions] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactRow | null>(null);

  useEffect(() => {
    apiFetch<{ submissions: ContactRow[] }>("/admin/contact")
      .then((data) => setSubmissions(data.submissions))
      .catch((err) => {
        if (err instanceof UnauthorizedError) onSessionExpired();
        else setError("Failed to load contact submissions.");
      })
      .finally(() => setLoading(false));
  }, [onSessionExpired]);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-2xl font-bold mb-1">Contact</h1>
      <p className="text-sm text-muted-foreground mb-8">All contact form submissions. {submissions.length > 0 ? `${submissions.length} total.` : ""}</p>

      {error && <ErrorBanner message={error} />}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_2fr_140px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>NAME</span><span>EMAIL</span><span>SUBJECT</span><span>DATE</span>
        </div>

        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2fr_140px] gap-4 px-5 py-4 border-b border-border animate-pulse">
              {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-24" />)}
            </div>
          ))
        ) : submissions.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No contact submissions yet.</p>
          </div>
        ) : (
          submissions.map((s) => (
            <button key={s.id} onClick={() => setSelected(s)} className="w-full grid grid-cols-[1fr_1fr_2fr_140px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className="text-sm text-muted-foreground truncate">{s.email}</div>
              <div className="text-sm text-muted-foreground truncate">
                <span className="font-medium text-foreground/80">{s.subject}</span>{" — "}{s.message.slice(0, 60)}{s.message.length > 60 ? "…" : ""}
              </div>
              <div className="text-sm text-muted-foreground">{fmtDate(s.submittedAt)}</div>
            </button>
          ))
        )}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">CONTACT SUBMISSION</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Name</div>
                  <div className="text-sm font-bold">{selected.name}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Email</div>
                  <div className="text-sm font-bold">{selected.email}</div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">Category</div>
                <div className="text-sm font-semibold capitalize">{selected.category}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">Subject</div>
                <div className="text-sm font-semibold">{selected.subject}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">Message</div>
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{selected.message}</div>
              </div>
              <div className="text-xs text-muted-foreground text-right">Submitted {fmtDate(selected.submittedAt)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

type AuthState = "checking" | "unauthenticated" | "authenticated";

export default function AdminDashboard() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [section, setSection] = useState("overview");

  // On mount: silently check whether an existing session cookie is valid.
  useEffect(() => {
    apiFetch("/admin/auth/me")
      .then(() => setAuthState("authenticated"))
      .catch(() => setAuthState("unauthenticated"));
  }, []);

  const handleSessionExpired = useCallback(() => {
    setAuthState("unauthenticated");
  }, []);

  async function handleLogout() {
    try {
      await apiPost("/admin/auth/logout", {});
    } catch {
      // ignore errors — clear auth state regardless
    }
    setAuthState("unauthenticated");
  }

  // While we probe the session, show a minimal loading screen so there's no flash.
  if (authState === "checking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground animate-pulse">
          <Shield size={20} />
          <span className="text-sm font-medium">Checking session…</span>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return <LoginScreen onAuthenticated={() => setAuthState("authenticated")} />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground">
      <Sidebar active={section} onNav={setSection} onLogout={handleLogout} />
      <main className="flex-1 overflow-y-auto">
        {section === "overview" && <OverviewSection onSessionExpired={handleSessionExpired} />}
        {section === "users"    && <UsersSection    onSessionExpired={handleSessionExpired} />}
        {section === "scans"    && <ScansSection    onSessionExpired={handleSessionExpired} />}
        {section === "reports"  && <ReportsSection  onSessionExpired={handleSessionExpired} />}
        {section === "contact"  && <ContactSection  onSessionExpired={handleSessionExpired} />}
      </main>
    </div>
  );
}
