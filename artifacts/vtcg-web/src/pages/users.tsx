import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, Users, ChevronRight as ChevronRightIcon, Ban, AlertTriangle, Trash2, CheckCircle, Star, Crown, User, RotateCcw, X, Shield, Activity, ListOrdered, Heart, Bell, AlertCircle, MessageSquare } from "lucide-react";
import { apiFetch, apiPost, apiDelete, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { TierBadge, fmtDate, fmtNum, ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

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
  const { auth, logout } = useAuth();
  const [locationStr] = useLocation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get("q") || "");
  const [tier, setTier] = useState(params.get("tier") || "all");
  const [statusFilter, setStatusFilter] = useState(params.get("status") || "all");
  const [sort, setSort] = useState(params.get("sort") || "date");
  const [page, setPage] = useState(parseInt(params.get("page") || "1", 10));

  const [selectedUserId, setSelectedUserId] = useState<string | null>(params.get("id"));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LIMIT = 20;

  const updateUrl = useCallback((q: string, t: string, st: string, s: string, p: number, id: string | null) => {
    const urlParams = new URLSearchParams();
    if (q.trim()) urlParams.set("q", q.trim());
    if (t !== "all") urlParams.set("tier", t);
    if (st !== "all") urlParams.set("status", st);
    if (s !== "date") urlParams.set("sort", s);
    if (p > 1) urlParams.set("page", String(p));
    if (id) urlParams.set("id", id);

    const newSearch = urlParams.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, []);

  const load = useCallback(
    (q: string, t: string, st: string, s: string, p: number) => {
      setLoading(true);
      setError(null);
      const queryParams = new URLSearchParams({ page: String(p), limit: String(LIMIT), sort: s });
      if (q.trim()) queryParams.set("q", q.trim());
      if (t !== "all") queryParams.set("tier", t);
      if (st !== "all") queryParams.set("status", st);

      apiFetch<{ users: UserRow[]; total: number; page: number }>(`/admin/users?${queryParams}`)
        .then((data) => { setUsers(data.users || []); setTotal(data.total || 0); })
        .catch((err) => {
          if (err instanceof UnauthorizedError) logout();
          else setError("Failed to load users.");
        })
        .finally(() => setLoading(false));
    },
    [logout],
  );

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const q = currentParams.get("q") || "";
    const specificId = currentParams.get("id");

    if (q !== search && !specificId) {
      setSearch(q);
      load(q, tier, statusFilter, sort, 1);
    } else {
      load(search, tier, statusFilter, sort, page);
    }
  }, [locationStr, load]);

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    updateUrl(val, tier, statusFilter, sort, 1, selectedUserId);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(val, tier, statusFilter, sort, 1), 300);
  }

  function handleTierChange(val: string) {
    setTier(val);
    setPage(1);
    updateUrl(search, val, statusFilter, sort, 1, selectedUserId);
    load(search, val, statusFilter, sort, 1);
  }
  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(1);
    updateUrl(search, tier, val, sort, 1, selectedUserId);
    load(search, tier, val, sort, 1);
  }
  function handleSortChange(val: string) {
    setSort(val);
    setPage(1);
    updateUrl(search, tier, statusFilter, val, 1, selectedUserId);
    load(search, tier, statusFilter, val, 1);
  }
  function handlePage(next: number) {
    setPage(next);
    updateUrl(search, tier, statusFilter, sort, next, selectedUserId);
    load(search, tier, statusFilter, sort, next);
  }

  function openDrawer(id: string) {
    setSelectedUserId(id);
    updateUrl(search, tier, statusFilter, sort, page, id);
  }

  function closeDrawer() {
    setSelectedUserId(null);
    updateUrl(search, tier, statusFilter, sort, page, null);
  }

  function handleUpdated(updated: UserRow) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
  }

  function handleDeleted(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    closeDrawer();
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
        <div className="flex gap-3 flex-wrap sm:flex-nowrap">
          <select value={tier} onChange={(e) => handleTierChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors flex-1 sm:flex-none min-w-[120px]">
            <option value="all">All Tiers</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="founding_pro">Founding Pro</option>
          </select>
          <select value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors flex-1 sm:flex-none min-w-[120px]">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select value={sort} onChange={(e) => handleSortChange(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors flex-1 sm:flex-none min-w-[120px]">
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
                {search || tier !== "all" || statusFilter !== "all" ? "No users match your filters." : "No users yet."}
              </p>
            </div>
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                onClick={() => openDrawer(user.id)}
                className="w-full grid grid-cols-[1fr_1fr_120px_120px_100px_36px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    user.suspendedAt ? "bg-amber-500/10 border border-amber-500/30 text-amber-400" : "bg-primary/10 border border-primary/20 text-primary"
                  }`}>
                    {user.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {user.displayName}
                      {user.suspendedAt && <Ban size={12} className="text-amber-500" />}
                    </div>
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
              {search || tier !== "all" || statusFilter !== "all" ? "No users match your filters." : "No users yet."}
            </p>
          </div>
        ) : users.map((user) => (
          <button key={user.id} onClick={() => openDrawer(user.id)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                user.suspendedAt ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-primary/10 border-primary/20 text-primary"
              }`}>
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold flex items-center gap-1.5">
                  {user.displayName}
                  {user.suspendedAt && <Ban size={12} className="text-amber-500" />}
                </div>
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

      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={closeDrawer}
          onSessionExpired={logout}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          canManage={Boolean(auth?.permissions.includes("users:manage"))}
          canDelete={Boolean(auth?.permissions.includes("users:delete"))}
        />
      )}
    </div>
  );
}

function UserDetailPanel({
  userId,
  onClose,
  onSessionExpired,
  onUpdated,
  onDeleted,
  canManage,
  canDelete,
}: {
  userId: string;
  onClose: () => void;
  onSessionExpired: () => void;
  onUpdated: (updated: UserRow) => void;
  onDeleted: (id: string) => void;
  canManage: boolean;
  canDelete: boolean;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [tier, setTier] = useState("free");
  const [founding, setFounding] = useState(false);
  const [subReason, setSubReason] = useState("");

  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendConfirm, setShowSuspendConfirm] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/admin/users/${userId}/detail`)
      .then(res => {
        setData(res);
        setTier(res.account.subscriptionTier);
        setFounding(res.account.isFoundingMember);
      })
      .catch(err => {
        if (err instanceof UnauthorizedError) onSessionExpired();
        else {
          toast({ title: "Error", description: "Failed to load user details.", variant: "destructive" });
          onClose();
        }
      })
      .finally(() => setLoading(false));
  }, [userId, onSessionExpired, onClose, toast]);

  const isSuspended = data?.account?.suspended;
  const user = data?.user;

  async function handleSaveSub(e: React.FormEvent) {
    e.preventDefault();
    if (!subReason.trim()) {
      toast({ title: "Reason Required", description: "Please provide a reason for the subscription change.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await apiPost<{ message: string; user: UserRow }>(
        `/admin/users/${userId}/subscription`,
        { subscription_tier: tier, is_founding_member: founding, reason: subReason.trim() },
      );
      onUpdated({ ...user, ...result.user });
      setData((prev: any) => ({
        ...prev,
        account: { ...prev.account, subscriptionTier: tier, isFoundingMember: founding }
      }));
      setSubReason("");
      toast({ title: "Saved", description: result.message });
    } catch (err) {
      if (err instanceof UnauthorizedError) onSessionExpired();
      else toast({ title: "Error", description: err instanceof Error ? err.message : "Update failed.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspend() {
    if (!suspendReason.trim()) return;
    setSuspending(true);
    try {
      const result = await apiPost<{ message: string; user: { suspendedAt: string | null } }>(
        `/admin/users/${userId}/suspend`,
        { suspend: !isSuspended, reason: suspendReason.trim() || undefined },
      );
      onUpdated({ ...user, suspendedAt: result.user.suspendedAt });
      setData((prev: any) => ({
        ...prev,
        account: { ...prev.account, suspended: !isSuspended, suspendedAt: result.user.suspendedAt }
      }));
      toast({ title: isSuspended ? "Account unsuspended" : "Account suspended", description: result.message });
      setShowSuspendConfirm(false);
      setSuspendReason("");
    } catch (err) {
      if (err instanceof UnauthorizedError) onSessionExpired();
      else toast({ title: "Error", description: err instanceof Error ? err.message : "Action failed.", variant: "destructive" });
    } finally {
      setSuspending(false);
    }
  }

  async function handleDelete() {
    if (!deleteReason.trim()) return;
    setDeleting(true);
    try {
      await apiDelete<{ message: string }>(`/admin/users/${userId}`, {
        reason: deleteReason.trim(),
      });
      toast({ title: "Account deleted", description: `Account has been permanently deleted.` });
      onDeleted(userId);
    } catch (err) {
      if (err instanceof UnauthorizedError) onSessionExpired();
      else toast({ title: "Error", description: err instanceof Error ? err.message : "Delete failed.", variant: "destructive" });
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleRevokeSessions() {
    if (!revokeReason.trim()) return;
    setRevoking(true);
    try {
      const res = await apiDelete<{ message: string }>(
        `/admin/users/${userId}/sessions`,
        { reason: revokeReason.trim() },
      );
      toast({ title: "Sessions Revoked", description: res.message });
      setShowRevokeConfirm(false);
      setRevokeReason("");
      // optimistically clear sessions in view
      setData((prev: any) => ({
        ...prev,
        sessions: { active: [], count: 0 }
      }));
    } catch (err) {
      if (err instanceof UnauthorizedError) onSessionExpired();
      else toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to revoke sessions.", variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
        <div className="fixed right-0 top-0 bottom-0 w-full max-w-[500px] bg-background border-l border-border z-50 flex items-center justify-center">
           <div className="animate-pulse flex flex-col items-center">
             <div className="h-12 w-12 rounded-full bg-border mb-4" />
             <div className="h-4 w-32 bg-border rounded mb-2" />
             <div className="h-3 w-24 bg-border rounded" />
           </div>
        </div>
      </>
    );
  }

  if (!data) return null;
  const initials = user.displayName?.slice(0, 2).toUpperCase() || "??";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[550px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
          <span className="text-xs font-bold text-muted-foreground tracking-wider">USER DETAIL</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-full border flex items-center justify-center text-xl font-display font-bold shrink-0 ${isSuspended ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-primary/10 border-primary/30 text-primary"}`}>
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-lg truncate">{user.displayName}</div>
              <div className="text-sm text-muted-foreground truncate">@{user.username}</div>
              <div className="text-xs text-muted-foreground/70 truncate font-mono">{user.email}</div>
              {isSuspended && (
                <div className="inline-flex items-center gap-1 mt-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded">
                  <Ban size={10} /> SUSPENDED
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 text-sm">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Joined</div>
              <div>{fmtDate(user.createdAt)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profile</div>
              <div>{user.profilePublic ? "Public" : "Private"}</div>
            </div>
            {user.location && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Location</div>
                <div>{user.location}</div>
              </div>
            )}
            {user.favouriteTcg && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Favourite TCG</div>
                <div>{user.favouriteTcg}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-3 flex flex-col items-center text-center">
              <ListOrdered size={16} className="text-muted-foreground mb-1" />
              <div className="text-xs font-bold text-muted-foreground tracking-wider mb-0.5">COLLECTION</div>
              <div className="text-lg font-bold">{fmtNum(data.collection.totalQuantity)}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 flex flex-col items-center text-center">
              <Heart size={16} className="text-muted-foreground mb-1" />
              <div className="text-xs font-bold text-muted-foreground tracking-wider mb-0.5">WISHLIST</div>
              <div className="text-lg font-bold">{fmtNum(data.wishlist.items)}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 flex flex-col items-center text-center">
              <Activity size={16} className="text-muted-foreground mb-1" />
              <div className="text-xs font-bold text-muted-foreground tracking-wider mb-0.5">SCANS</div>
              <div className="text-lg font-bold">{fmtNum(data.scanUsage.scansThisMonth)}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 flex flex-col items-center text-center relative">
              <Bell size={16} className="text-muted-foreground mb-1" />
              <div className="text-xs font-bold text-muted-foreground tracking-wider mb-0.5">NOTIFS</div>
              <div className="text-lg font-bold">{fmtNum(data.notifications.total)}</div>
              <div className="text-[10px] text-muted-foreground">{fmtNum(data.notifications.unread)} unread</div>
              {data.notifications.unread > 0 && (
                <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </div>
          </div>

          {data.collection.recent.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Recent Collection
              </div>
              <div className="divide-y divide-border">
                {data.collection.recent.map((item: { cardId: string; name: string | null; quantity: number; addedAt: string }) => (
                  <div key={`${item.cardId}-${item.addedAt}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.name || item.cardId}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(item.addedAt)}</div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">Qty {item.quantity}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Support & Reports</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {data.relationships.reportsAvailable && (
                <>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Reports Against</div>
                    <div className="text-sm font-bold">{data.relationships.reportsAgainst}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Reports By</div>
                    <div className="text-sm font-bold">{data.relationships.reportsSubmitted}</div>
                  </div>
                </>
              )}
              {data.relationships.supportAvailable && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Support Tickets</div>
                  <div className="text-sm font-bold">{data.relationships.supportSubmissions}</div>
                </div>
              )}
            </div>
            {!data.relationships.reportsAvailable && !data.relationships.supportAvailable && (
              <p className="text-xs text-muted-foreground">
                Report and support context is unavailable with your current permissions.
              </p>
            )}
            {(
              data.relationships.recentReportsAgainst.length > 0 ||
              data.relationships.recentReportsSubmitted.length > 0 ||
              data.relationships.recentSupport.length > 0
            ) && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                {data.relationships.recentReportsAgainst.map((report: { id: string; reason: string; status: string }) => (
                  <Link key={`against-${report.id}`} href={`/reports?id=${encodeURIComponent(report.id)}`} className="flex items-center justify-between gap-3 text-xs hover:text-primary">
                    <span className="truncate">Report against · {report.reason.replaceAll("_", " ")}</span>
                    <span className="shrink-0 text-muted-foreground">{report.status.replaceAll("_", " ")}</span>
                  </Link>
                ))}
                {data.relationships.recentReportsSubmitted.map((report: { id: string; reason: string; status: string }) => (
                  <Link key={`submitted-${report.id}`} href={`/reports?id=${encodeURIComponent(report.id)}`} className="flex items-center justify-between gap-3 text-xs hover:text-primary">
                    <span className="truncate">Report submitted · {report.reason.replaceAll("_", " ")}</span>
                    <span className="shrink-0 text-muted-foreground">{report.status.replaceAll("_", " ")}</span>
                  </Link>
                ))}
                {data.relationships.recentSupport.map((support: { id: string; subject: string; status: string }) => (
                  <Link key={`support-${support.id}`} href={`/contact?id=${encodeURIComponent(support.id)}`} className="flex items-center justify-between gap-3 text-xs hover:text-primary">
                    <span className="truncate">Support · {support.subject}</span>
                    <span className="shrink-0 text-muted-foreground">{support.status.replaceAll("_", " ")}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSaveSub} className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">SUBSCRIPTION</span>
              <span className="text-[10px] flex items-center gap-1 text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                <AlertCircle size={10} /> {data.dataAvailability.payment.reason}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(["free", "pro"] as const).map((t) => (
                <label
                  key={t}
                  className={`flex items-center gap-2.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    tier === t ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <input disabled={!canManage} type="radio" name="tier" value={t} checked={tier === t} onChange={() => setTier(t)} className="sr-only" />
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
                <input disabled={!canManage} type="checkbox" className="sr-only peer" checked={founding} onChange={(e) => setFounding(e.target.checked)} />
                <div className="w-10 h-6 bg-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 shadow-inner" />
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Reason for change</label>
              <input
                type="text"
                value={subReason}
                onChange={e => setSubReason(e.target.value)}
                disabled={!canManage}
                placeholder="Reason for this plan change..."
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => { setTier(data.account.subscriptionTier); setFounding(data.account.isFoundingMember); setSubReason(""); }}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw size={13} /> Reset
              </button>
              <button
                type="submit"
                disabled={!canManage || saving || (tier === data.account.subscriptionTier && founding === data.account.isFoundingMember)}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_10px_rgba(255,30,45,0.2)]"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Your administrator permissions allow viewing this plan state, not changing it.
              </p>
            )}
          </form>

          {/* Account Actions */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">ACCOUNT ACTIONS</div>

            {/* Sessions */}
            <div className="border border-border rounded-xl p-4 mb-4 bg-background space-y-3">
              <div className="flex justify-between items-start">
                 <div>
                   <div className="text-sm font-bold">Active Sessions</div>
                   <div className="text-xs text-muted-foreground">{data.sessions.count} devices currently logged in</div>
                 </div>
                  {canManage && !showRevokeConfirm && data.sessions.count > 0 && (
                   <button onClick={() => setShowRevokeConfirm(true)} className="text-xs bg-negative/10 text-negative border border-negative/20 px-2 py-1 rounded hover:bg-negative/20 font-bold">
                     Revoke All
                   </button>
                 )}
              </div>
              {data.sessions.active.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {data.sessions.active.map((session: { id: string; createdAt: string; expiresAt: string }) => (
                    <div key={session.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-mono text-muted-foreground">{session.id.slice(0, 8)}</span>
                      <span className="text-right text-muted-foreground">
                        Created {new Date(session.createdAt).toLocaleString()}<br />
                        Expires {new Date(session.expiresAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {showRevokeConfirm && (
                <div className="border border-negative/40 bg-negative/5 rounded-xl p-3 space-y-3 animate-in fade-in zoom-in-95">
                  <div className="text-sm font-bold text-negative">Revoke {data.sessions.count} sessions?</div>
                  <input
                    type="text"
                    value={revokeReason}
                    onChange={e => setRevokeReason(e.target.value)}
                    placeholder="Reason (required)"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-negative"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRevokeConfirm(false)}
                      className="flex-1 px-3 py-2 bg-card border border-border text-sm font-bold rounded-lg hover:bg-background transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={revoking || !revokeReason.trim()}
                      onClick={handleRevokeSessions}
                      className="flex-1 px-3 py-2 bg-negative text-white text-sm font-bold rounded-lg hover:bg-negative/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {revoking ? "Revoking…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Suspend / Unsuspend */}
            {canManage && (!showSuspendConfirm ? (
              <button
                type="button"
                onClick={() => setShowSuspendConfirm(true)}
                className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                  isSuspended
                    ? "border-positive/40 bg-positive/10 text-positive hover:bg-positive/20"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                <Ban size={15} />
                {isSuspended ? "Unsuspend Account" : "Suspend Account"}
                <span className="ml-auto text-xs font-normal opacity-70 hidden sm:inline">
                  {isSuspended ? "Restore login access" : "Block login"}
                </span>
              </button>
            ) : (
              <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl p-4 space-y-3 animate-in fade-in zoom-in-95">
                <div className="text-sm">
                  <span className="font-bold text-amber-500">
                    {isSuspended ? "Unsuspend account?" : "Suspend account?"}
                  </span>
                  <span className="text-muted-foreground">
                    {isSuspended
                      ? " The collector will be able to sign in again."
                      : " The collector will be logged out and unable to return."}
                  </span>
                </div>
                <input
                  type="text"
                  value={suspendReason}
                  onChange={e => setSuspendReason(e.target.value)}
                  placeholder={`${isSuspended ? "Unsuspension" : "Suspension"} reason (required)`}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSuspendConfirm(false)}
                    className="flex-1 px-3 py-2 bg-card border border-border text-sm font-bold rounded-lg hover:bg-background transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={suspending || !suspendReason.trim()}
                    onClick={handleSuspend}
                    className="flex-1 px-3 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                      {suspending
                        ? isSuspended ? "Unsuspending…" : "Suspending…"
                        : isSuspended ? "Confirm Unsuspend" : "Confirm Suspend"}
                  </button>
                </div>
              </div>
            ))}

            {/* Delete */}
            {canDelete && (!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border border-negative/30 bg-negative/5 text-negative text-sm font-bold hover:bg-negative/15 transition-all"
              >
                <Trash2 size={15} />
                Delete Account
                <span className="ml-auto text-xs font-normal opacity-70 hidden sm:inline">Permanent action</span>
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
                <input
                  type="text"
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  placeholder="Reason (required for audit log)"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-negative"
                />
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
                    disabled={deleting || !deleteReason.trim()}
                    onClick={handleDelete}
                    className="flex-1 px-3 py-2 bg-negative text-white text-sm font-bold rounded-lg hover:bg-negative/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleting ? "Deleting…" : "Confirm Delete"}
                  </button>
                </div>
              </div>
            ))}
            {!canManage && !canDelete && (
              <p className="text-sm text-muted-foreground">
                Your administrator permissions allow viewing this collector, not account actions.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}