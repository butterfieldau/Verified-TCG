import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, Users, ChevronRight as ChevronRightIcon, Ban, AlertTriangle, Trash2, CheckCircle, Star, Crown, User, RotateCcw, X } from "lucide-react";
import { apiFetch, apiPost, apiDelete, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { TierBadge, fmtDate, fmtNum, ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

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

export default function UsersPage() {
  const { logout } = useAuth();
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
          if (err instanceof UnauthorizedError) logout();
          else setError("Failed to load users.");
        })
        .finally(() => setLoading(false));
    },
    [logout],
  );

  useEffect(() => { load(search, tier, sort, page); }, []); 

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
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Users</h1>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `${fmtNum(total)} total users` : "Manage all collector accounts"}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
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
        <div className="flex gap-3">
          <select value={tier} onChange={(e) => handleTierChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors flex-1 sm:flex-none">
            <option value="all">All Tiers</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="founding_pro">Founding Pro</option>
          </select>
          <select value={sort} onChange={(e) => handleSortChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors flex-1 sm:flex-none">
            <option value="date">Newest First</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="mb-4 hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div>
          <div className="grid grid-cols-[1fr_1fr_120px_120px_100px_36px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>USER</span><span>EMAIL</span><span>TIER</span><span>JOINED</span><span>SCANS / MO</span><span />
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_120px_120px_100px_36px] gap-4 px-5 py-4 border-b border-border animate-pulse">
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
                className="w-full grid grid-cols-[1fr_1fr_120px_120px_100px_36px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center"
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
                <ChevronRightIcon size={16} className="text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="mb-4 space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <Users size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              {search || tier !== "all" ? "No users match your filters." : "No users yet."}
            </p>
          </div>
        ) : users.map((user) => (
          <button key={user.id} onClick={() => setSelected(user)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{user.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{user.email}</div>
              </div>
              <ChevronRightIcon size={16} className="mt-1 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <TierBadge tier={user.subscriptionTier} founding={user.isFoundingMember} />
              <div className="text-right text-xs text-muted-foreground">
                <div>{user.scansThisMonth} scans this month</div>
                <div>Joined {fmtDate(user.createdAt)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {!loading && total > LIMIT && (
        <div className="flex flex-col sm:flex-row items-center justify-between text-sm gap-4">
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
          onSessionExpired={logout}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

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
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[420px] bg-background border-l border-border z-50 flex flex-col overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
          <span className="text-sm font-bold text-muted-foreground tracking-wider">USER DETAIL</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2">
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
                disabled={saving || (tier === user.subscriptionTier && founding === user.isFoundingMember)}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_10px_rgba(255,30,45,0.2)]"
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
                  ? "border-positive/40 bg-positive/10 text-positive hover:bg-positive/20"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              <Ban size={15} />
              {suspending ? "Working…" : isSuspended ? "Unsuspend Account" : "Suspend Account"}
              <span className="ml-auto text-xs font-normal opacity-70 hidden sm:inline">
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
                <span className="ml-auto text-xs font-normal opacity-70 hidden sm:inline">Permanent — cannot be undone</span>
              </button>
            ) : (
              <div className="border border-negative/40 bg-negative/5 rounded-xl p-4 space-y-3 animate-in fade-in zoom-in-95">
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
