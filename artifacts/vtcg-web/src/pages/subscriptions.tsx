import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, CreditCard, ExternalLink } from "lucide-react";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner, TierBadge } from "@/components/admin-ui";

interface SubRow {
  id: string;
  email: string;
  displayName: string;
  username: string;
  subscriptionTier: string;
  isFoundingMember: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function SubscriptionsPage() {
  const { logout } = useAuth();
  const [locationStr] = useLocation();
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(parseInt(params.get("page") || "1", 10));
  const [tier, setTier] = useState(params.get("tier") || "all");
  const LIMIT = 20;

  const updateUrl = useCallback((t: string, p: number) => {
    const urlParams = new URLSearchParams();
    if (t !== "all") urlParams.set("tier", t);
    if (p > 1) urlParams.set("page", String(p));
    
    const newSearch = urlParams.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, []);

  const load = useCallback((t: string, p: number) => {
    setLoading(true);
    setError(null);
    const queryParams = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (t !== "all") queryParams.set("tier", t);

    apiFetch<{ subscriptions: SubRow[]; total: number; page: number }>(`/admin/subscriptions?${queryParams}`)
      .then((data) => {
        setSubs(data.subscriptions || []);
        setTotal(data.total || 0);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load subscriptions.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const urlTier = currentParams.get("tier") || "all";
    const urlPage = parseInt(currentParams.get("page") || "1", 10);
    
    if (urlTier !== tier || urlPage !== page) {
      setTier(urlTier);
      setPage(urlPage);
      load(urlTier, urlPage);
    } else {
      load(tier, page);
    }
  }, [locationStr, load]); 

  function handleTierChange(val: string) {
    setTier(val);
    setPage(1);
    updateUrl(val, 1);
    load(val, 1);
  }

  function handlePageChange(next: number) {
    setPage(next);
    updateUrl(tier, next);
    load(tier, next);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `${total} platform plan records` : "Review platform plan states"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <select
          value={tier}
          onChange={(e) => handleTierChange(e.target.value)}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors min-w-[150px]"
        >
          <option value="all">All Tiers</option>
          <option value="pro">Pro</option>
          <option value="founding_pro">Founding Pro</option>
          <option value="free">Free</option>
        </select>
        <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-auto">
          <ExternalLink size={12} />
          External payment details are not connected.
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block mb-4">
        <div>
          <div className="grid grid-cols-[1.5fr_1fr_120px_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>USER</span><span>TIER</span><span>JOINED</span><span>UPDATED</span>
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_1fr_120px_120px] gap-4 px-5 py-4 border-b border-border animate-pulse items-center">
                <div className="h-3 bg-border rounded w-32" />
                <div className="h-5 bg-border rounded-full w-16" />
                <div className="h-3 bg-border rounded w-20" />
                <div className="h-3 bg-border rounded w-20" />
              </div>
            ))
          ) : subs.length === 0 ? (
            <div className="py-16 text-center">
              <CreditCard size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                {tier !== "all" ? "No subscriptions match this filter." : "No subscriptions found."}
              </p>
            </div>
          ) : (
            subs.map((s) => (
              <div key={s.id} className="grid grid-cols-[1.5fr_1fr_120px_120px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
                <div className="min-w-0">
                  <Link href={`/users?id=${encodeURIComponent(s.id)}`} className="text-sm font-semibold truncate hover:underline hover:text-primary transition-colors block">
                    {s.displayName} <span className="text-xs font-normal text-muted-foreground">@{s.username}</span>
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">{s.email}</div>
                </div>
                <div>
                  <TierBadge tier={s.subscriptionTier} founding={s.isFoundingMember} />
                </div>
                <div className="text-sm text-muted-foreground">{fmtDate(s.createdAt)}</div>
                <div className="text-sm text-muted-foreground">{fmtDate(s.updatedAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden mb-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))
        ) : subs.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <CreditCard size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No subscriptions found.</p>
          </div>
        ) : subs.map((s) => (
          <div key={s.id} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <Link href={`/users?id=${encodeURIComponent(s.id)}`} className="truncate text-sm font-bold block hover:underline hover:text-primary transition-colors">
                  {s.displayName} <span className="text-xs font-normal text-muted-foreground">@{s.username}</span>
                </Link>
                <div className="truncate text-xs text-muted-foreground">{s.email}</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <TierBadge tier={s.subscriptionTier} founding={s.isFoundingMember} />
              <div className="text-right text-xs text-muted-foreground">
                <div>Joined {fmtDate(s.createdAt)}</div>
                <div>Updated {fmtDate(s.updatedAt)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && total > LIMIT && (
        <div className="flex flex-col sm:flex-row items-center justify-between text-sm gap-4">
          <span className="text-muted-foreground">Page {page} of {totalPages} · {total} plan records</span>
          <div className="flex items-center gap-2">
            <button onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page <= 1} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
