import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Archive,
  BadgeDollarSign,
  Bell,
  Calendar,
  CreditCard,
  DatabaseZap,
  Flag,
  HeartPulse,
  Laptop,
  LayoutDashboard,
  Library,
  LockKeyhole,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  PanelLeft,
  ScanLine,
  ScanSearch,
  Search,
  Shield,
  Store,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { apiFetch, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const NAV_ITEMS = [
  { path: "/overview", label: "Overview", icon: LayoutDashboard, permission: "dashboard:read" },
  { path: "/operations", label: "Operations", icon: Activity, permission: "operations:read" },
  { path: "/users", label: "Users", icon: Users, permission: "users:read" },
  { path: "/subscriptions", label: "Subscriptions", icon: CreditCard, permission: "users:read" },
  { path: "/community", label: "Community", icon: HeartPulse, permission: "community:read" },
  { path: "/reports", label: "Reports", icon: Flag, permission: "reports:read" },
  { path: "/trust", label: "Trust & Safety", icon: Shield, permission: "trust:read" },
  { path: "/events", label: "Events", icon: Calendar, permission: "events:read" },
  { path: "/vendors", label: "Vendors", icon: Store, permission: "vendors:read" },
  { path: "/scans", label: "Scans", icon: ScanLine, permission: "analytics:read" },
  { path: "/catalogue", label: "Cards & catalogue", icon: Library, permission: "catalogue:read" },
  { path: "/pricing", label: "Pricing", icon: BadgeDollarSign, permission: "pricing:read" },
  { path: "/scanner-review", label: "Scanner review", icon: ScanSearch, permission: "scanner:read" },
  { path: "/collection-intelligence", label: "Data quality", icon: DatabaseZap, permission: "collections:read" },
  { path: "/contact", label: "Support", icon: MessageSquare, permission: "contact:read" },
  { path: "/notifications", label: "Campaigns", icon: Bell, permission: "notifications:read" },
  { path: "/requests", label: "Requests", icon: Archive, permission: "privacy:read" },
  { path: "/announcements", label: "Announcements", icon: Megaphone, permission: "announcements:read" },
  { path: "/team", label: "Admin team", icon: UsersRound, permission: "team:read", owner: true },
  { path: "/sessions", label: "Sessions", icon: Laptop, permission: "sessions:read", owner: true },
];

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ type: string; id: string; title: string; subtitle: string; path?: string }[] | null>(null);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      setSourceNote(null);
      return;
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      apiFetch<{
        results: {
          users?: {
            id: string;
            displayName: string;
            username: string;
            email: string;
            subscriptionTier: string;
          }[];
          reports?: { id: string; reason: string; status: string }[];
          support?: {
            id: string;
            subject: string;
            email: string;
            category: string;
            status: string;
          }[];
        };
        dataAvailability: Record<string, { available: boolean; reason?: string }>;
      }>(`/admin/search?q=${encodeURIComponent(query)}`)
        .then((data) => {
          const normalized = [
            ...(data.results.users ?? []).map((user) => ({
              type: "user",
              id: user.id,
              title: user.displayName,
              subtitle: `@${user.username} · ${user.email} · ${user.subscriptionTier}`,
              path: `/users?id=${encodeURIComponent(user.id)}`,
            })),
            ...(data.results.reports ?? []).map((report) => ({
              type: "report",
              id: report.id,
              title: report.reason.replaceAll("_", " "),
              subtitle: `Report · ${report.status.replaceAll("_", " ")}`,
              path: `/reports?id=${encodeURIComponent(report.id)}`,
            })),
            ...(data.results.support ?? []).map((support) => ({
              type: "support",
              id: support.id,
              title: support.subject,
              subtitle: `${support.category} · ${support.email}`,
              path: `/contact?id=${encodeURIComponent(support.id)}`,
            })),
          ];
          setResults(normalized);
          const unavailable = ["cards", "events"].filter(
            (source) => data.dataAvailability[source]?.available === false,
          );
          setSourceNote(
            unavailable.length > 0
              ? `${unavailable.map((value) => value[0]!.toUpperCase() + value.slice(1)).join(" and ")} search unavailable`
              : null,
          );
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative flex-1 max-w-md mx-4 hidden sm:block" ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          placeholder="Global search..."
          className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setOpen(false);
              setResults(null);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-center text-muted-foreground">Searching...</div>
          ) : results && results.length > 0 ? (
            <div className="py-2">
              {results.map((r, i) => (
                <button
                  key={`${r.type}-${r.id}-${i}`}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    if (r.path) {
                      setLocation(r.path);
                    } else if (r.type === "user") {
                      setLocation(`/users?id=${encodeURIComponent(r.id)}`);
                    } else if (r.type === "report") {
                      setLocation(`/reports?id=${encodeURIComponent(r.id)}`);
                    } else if (r.type === "contact") {
                      setLocation(`/contact?id=${encodeURIComponent(r.id)}`);
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-background transition-colors flex items-center justify-between border-b border-border/50 last:border-0"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-sm font-bold truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-background px-2 py-0.5 rounded border border-border shrink-0">
                    {r.type}
                  </span>
                </button>
              ))}
              {sourceNote && (
                <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                  {sourceNote}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 text-sm text-center text-muted-foreground">
              No results found or search unavailable.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthLoading, setReauthLoading] = useState(false);

  useEffect(() => {
    apiFetch("/healthz")
      .then(() => setHealthy(true))
      .catch(() => setHealthy(false));
  }, []);

  useEffect(() => {
    const open = () => {
      setReauthError(null);
      setReauthOpen(true);
    };
    window.addEventListener("admin:reauth-required", open);
    return () => window.removeEventListener("admin:reauth-required", open);
  }, []);

  const navItems = NAV_ITEMS.filter(
    (item) =>
      (!item.owner || auth?.admin.role === "owner") &&
      auth?.permissions.includes(item.permission),
  );

  async function confirmRecentAccess(event: React.FormEvent) {
    event.preventDefault();
    setReauthLoading(true);
    setReauthError(null);
    try {
      await apiPost("/admin/auth/reauth", { password: reauthPassword });
      setReauthPassword("");
      setReauthOpen(false);
      toast({
        title: "Sensitive access confirmed",
        description: "Repeat your protected action within the next 10 minutes.",
      });
    } catch (error) {
      setReauthError(error instanceof Error ? error.message : "Could not confirm access.");
    } finally {
      setReauthLoading(false);
    }
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background selection:bg-primary/30">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-card transition-[width,transform] duration-200 md:static ${
          collapsed ? "md:w-16" : "md:w-64"
        } w-72 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className={`flex h-16 shrink-0 items-center gap-3 border-b border-border px-5 ${collapsed ? "md:justify-center md:gap-0 md:px-2" : ""}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-[0_0_15px_rgba(255,30,45,0.35)]">
            <Shield size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <div className={collapsed ? "md:hidden" : ""}>
            <div className="font-display text-sm font-bold leading-none tracking-wide">VERIFIED TCG</div>
            <div className="mt-0.5 text-[10px] tracking-wider text-muted-foreground">COMMAND CENTRE</div>
          </div>
          <button
            type="button"
            className="ml-auto p-2 text-muted-foreground md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <div className={`shrink-0 border-b border-border/50 px-4 py-4 ${collapsed ? "md:hidden" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-xs font-bold text-muted-foreground">
                {auth?.admin.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{auth?.admin.displayName}</div>
                <div className="truncate font-mono text-xs capitalize text-muted-foreground">{auth?.admin.role}</div>
              </div>
            </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const active = location === item.path || location.startsWith(item.path + "?");
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setMobileMenuOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                  collapsed ? "md:justify-center md:gap-0 md:px-2" : ""
                } ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                <item.icon size={16} />
                <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => void logout()}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-negative/10 hover:text-negative ${
              collapsed ? "md:justify-center md:gap-0 md:px-2" : ""
            }`}
          >
            <LogOut size={16} />
            <span className={collapsed ? "md:hidden" : ""}>Sign out</span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur md:px-5">
          <button
            type="button"
            className="p-2 text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            className="hidden p-2 text-muted-foreground hover:text-foreground md:block"
            onClick={() => setCollapsed((value) => !value)}
            aria-label="Toggle navigation width"
          >
            <PanelLeft size={18} />
          </button>
          <div className="min-w-0 md:w-48 xl:w-64">
            <div className="truncate text-sm font-bold">Admin Command Centre</div>
            <div className="hidden text-xs text-muted-foreground sm:block">Secure platform operations</div>
          </div>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline-flex">
              {import.meta.env.PROD ? "Production" : "Development"}
            </span>
            <Link
              href="/overview"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold ${
                healthy === false
                  ? "border-negative/30 bg-negative/10 text-negative"
                  : "border-positive/30 bg-positive/10 text-positive"
              }`}
              aria-label="Open platform health overview"
            >
              {healthy === false ? <Activity size={14} /> : <HeartPulse size={14} />}
              <span className="hidden sm:inline">{healthy === false ? "Needs attention" : "Platform healthy"}</span>
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {reauthOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/70"
            onClick={() => setReauthOpen(false)}
            aria-label="Close password confirmation"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reauth-title"
            className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-2xl"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole size={19} />
            </div>
            <h2 id="reauth-title" className="font-display text-xl font-bold">Confirm sensitive access</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your password, then repeat the action. Confirmation remains valid for 10 minutes.
            </p>
            <form onSubmit={confirmRecentAccess} className="mt-5 space-y-3">
              <input
                type="password"
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="Your password"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary"
              />
              {reauthError && <p className="text-sm text-negative">{reauthError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setReauthOpen(false)} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-bold">
                  Cancel
                </button>
                <button disabled={reauthLoading || !reauthPassword} className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {reauthLoading ? "Confirming…" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
