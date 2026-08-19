import { useState, useEffect, useCallback } from "react";
import { MessageSquare, X, ChevronLeft, ChevronRight, Mail, CheckCircle, Clock, UserPlus } from "lucide-react";
import { apiFetch, apiPatch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface OperationalNote {
  id: string;
  authorAdminId: string;
  authorDisplayName: string | null;
  body: string;
  createdAt: string;
}

interface ContactRow {
  id: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  submittedAt: string;
  status: string;
  assignedAdminId?: string | null;
  assignedAdminDisplayName?: string | null;
  resolution?: string | null;
  resolutionReason?: string | null;
  escalatedAt?: string | null;
  escalationReason?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  notes?: OperationalNote[];
}

export default function ContactPage() {
  const { logout } = useAuth();
  const [locationStr] = useLocation();
  const [messages, setMessages] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactRow | null>(null);

  const params = new URLSearchParams(window.location.search);
  const [statusFilter, setStatusFilter] = useState(params.get("status") || "all");
  const [search, setSearch] = useState(params.get("q") || "");
  const [page, setPage] = useState(parseInt(params.get("page") || "1", 10));
  const LIMIT = 20;

  const updateUrl = useCallback((s: string, q: string, p: number, id?: string | null) => {
    const urlParams = new URLSearchParams();
    if (s !== "all") urlParams.set("status", s);
    if (q) urlParams.set("q", q);
    if (p > 1) urlParams.set("page", String(p));
    if (id) urlParams.set("id", id);

    const newSearch = urlParams.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, []);

  const load = useCallback((s: string, q: string, p: number, id?: string | null) => {
    setLoading(true);
    setError(null);
    const qParams = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (s !== "all") qParams.set("status", s);
    if (q) qParams.set("q", q);
    const requestedId =
      id === undefined ? new URLSearchParams(window.location.search).get("id") : id;
    if (requestedId) qParams.set("id", requestedId);

    apiFetch<{ submissions: ContactRow[]; total?: number; page?: number }>(`/admin/contact?${qParams}`)
      .then((data) => {
        setMessages(data.submissions || []);
        setTotal(data.total || data.submissions?.length || 0);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load contact messages.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  useEffect(() => {
    const currentParams = newSearchParams(window.location.search);
    const specificId = currentParams.get("id");
    if (specificId && !selected) {
      const found = messages.find(m => m.id === specificId);
      if (found) setSelected(found);
    }
  }, [messages, selected]);

  useEffect(() => {
    load(statusFilter, search, page);
  }, [load, statusFilter, search, page]);

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(1);
    updateUrl(val, search, 1);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
    updateUrl(statusFilter, e.target.value, 1);
  }

  function handlePageChange(next: number) {
    setPage(next);
    updateUrl(statusFilter, search, next);
  }

  function reloadQueue() {
    load(statusFilter, search, page, null);
  }

  function openMessage(message: ContactRow) {
    setSelected(message);
    updateUrl(statusFilter, search, page, message.id);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Contact Submissions</h1>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `${total} messages` : "Support & inquiries queue"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search support..."
            value={search}
            onChange={handleSearchChange}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors min-w-[200px]"
          />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors min-w-[150px]"
          >
            <option value="all">All Statuses</option>
            <option value="unresolved">All Unresolved</option>
            <option value="open">Open</option>
            <option value="in_review">In Review</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="escalated">Escalated</option>
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block mb-4">
        <div>
          <div className="grid grid-cols-[1.5fr_1fr_2fr_120px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>SENDER</span><span>CATEGORY</span><span>SUBJECT</span><span>DATE</span><span>STATUS</span>
          </div>

          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_1fr_2fr_120px_100px] gap-4 px-5 py-4 border-b border-border animate-pulse items-center">
                {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-24" />)}
              </div>
            ))
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <MessageSquare size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                {statusFilter !== "all" || search ? "No messages match." : "No messages yet."}
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const status = m.status || "open";
              return (
                <button key={m.id} onClick={() => openMessage(m)} className="w-full grid grid-cols-[1.5fr_1fr_2fr_120px_100px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
                  <div className="min-w-0 pr-4">
                    <div className="text-sm font-semibold truncate">{m.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                  </div>
                  <div className="text-sm text-muted-foreground capitalize truncate">
                    <span className="inline-flex bg-background border border-border px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">{m.category.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-sm font-medium truncate pr-4">{m.subject}</div>
                  <div className="text-sm text-muted-foreground tabular-nums">{fmtDate(m.submittedAt)}</div>
                  <ContactStatusBadge status={status} />
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden mb-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <MessageSquare size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          </div>
        ) : messages.map((message) => (
          <button key={message.id} onClick={() => openMessage(message)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{message.subject}</div>
                <div className="truncate text-xs text-muted-foreground">{message.name} · {message.email}</div>
              </div>
              <ContactStatusBadge status={message.status || "open"} />
            </div>
            <div className="mt-3 border-t border-border pt-3 flex items-end justify-between">
              <div>
                <span className="inline-flex rounded border border-border bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {message.category.replace(/_/g, " ")}
                </span>
                <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{message.message}</p>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground ml-2">{fmtDate(message.submittedAt)}</div>
            </div>
          </button>
        ))}
      </div>

      {!loading && total > LIMIT && (
        <div className="flex flex-col sm:flex-row items-center justify-between text-sm gap-4">
          <span className="text-muted-foreground">Page {page} of {totalPages} · {total} messages</span>
          <div className="flex items-center gap-2">
            <button onClick={() => handlePageChange(page - 1)} disabled={page <= 1} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {selected && (
        <ContactDrawer
          message={selected}
          onClose={() => {
            setSelected(null);
            const currentParams = newSearchParams(window.location.search);
            if (currentParams.has("id")) {
              currentParams.delete("id");
              const newSearch = currentParams.toString();
              const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
              window.history.replaceState(null, "", newUrl);
              load(statusFilter, search, page, null);
            }
          }}
          onReloadQueue={reloadQueue}
        />
      )}
    </div>
  );
}

function newSearchParams(searchStr: string) {
  return new URLSearchParams(searchStr);
}

function ContactStatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  if (norm === "resolved") {
    return <span className="text-[10px] font-bold bg-positive/10 text-positive border border-positive/30 px-2 py-0.5 rounded uppercase tracking-wider inline-flex w-fit shrink-0">RESOLVED</span>;
  }
  if (norm === "in_review") {
    return <span className="text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 rounded uppercase tracking-wider inline-flex w-fit shrink-0">IN REVIEW</span>;
  }
  if (norm === "dismissed") {
    return <span className="text-[10px] font-bold bg-background text-muted-foreground border border-border px-2 py-0.5 rounded uppercase tracking-wider inline-flex w-fit shrink-0">DISMISSED</span>;
  }
  if (norm === "escalated") {
    return <span className="text-[10px] font-bold bg-negative/10 text-negative border border-negative/30 px-2 py-0.5 rounded uppercase tracking-wider inline-flex w-fit shrink-0">ESCALATED</span>;
  }
  return <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded uppercase tracking-wider inline-flex w-fit shrink-0">OPEN</span>;
}

function ContactDrawer({ message, onClose, onReloadQueue }: { message: ContactRow; onClose: () => void; onReloadQueue: () => void }) {
  const { auth, logout } = useAuth();
  const { toast } = useToast();

  const [status, setStatus] = useState(message.status || "open");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState(message.resolution || "");
  const [resolutionReason, setResolutionReason] = useState(message.resolutionReason || "");
  const [escalationReason, setEscalationReason] = useState(message.escalationReason || "");
  const [assignedAdminId, setAssignedAdminId] = useState(message.assignedAdminId || "");

  const [saving, setSaving] = useState(false);
  const canModerate = Boolean(auth?.permissions.includes("contact:moderate"));

  const isTerminal = status === "resolved" || status === "dismissed";
  const isEscalated = status === "escalated";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isTerminal && (!resolution || !resolutionReason)) {
      toast({ title: "Validation Error", description: "Terminal states require a resolution and reason.", variant: "destructive" });
      return;
    }
    if (isEscalated && !escalationReason) {
      toast({ title: "Validation Error", description: "Escalated states require a reason.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await apiPatch<{ id: string; status: string; notes: any[] }>(
        `/admin/contact/${message.id}`,
        {
          status,
          note: note || undefined,
          assignedAdminId: assignedAdminId || null,
          resolution: isTerminal ? resolution : undefined,
          resolutionReason: isTerminal ? resolutionReason : undefined,
          escalationReason: isEscalated ? escalationReason : undefined,
        }
      );
      toast({ title: "Updated", description: "Submission status saved." });
      onReloadQueue();
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else toast({ title: "Error", description: "Failed to update submission.", variant: "destructive" });
      setSaving(false);
    }
  }

  function handleSelfAssign() {
    setAssignedAdminId(auth?.admin.id || "");
  }

  function handleUnassign() {
    setAssignedAdminId("");
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[500px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10 shrink-0">
          <span className="text-xs font-bold text-muted-foreground tracking-wider flex items-center gap-2">
            <MessageSquare size={14} /> MESSAGE DETAIL
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Assignee:</span>
              <span className="text-sm font-semibold">
                {assignedAdminId === auth?.admin.id
                  ? "You"
                  : assignedAdminId
                    ? message.assignedAdminDisplayName || "Assigned administrator"
                    : "Unassigned"}
              </span>
            </div>
            {canModerate && (assignedAdminId ? (
               <button onClick={handleUnassign} className="text-xs bg-card border border-border px-2 py-1 rounded hover:bg-background">Unassign</button>
            ) : (
               <button onClick={handleSelfAssign} className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded hover:bg-primary/20 flex items-center gap-1"><UserPlus size={12} /> Assign to me</button>
             ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">From</div>
              <div className="text-sm font-bold truncate">{message.name}</div>
              <div className="text-sm text-primary truncate font-mono mt-0.5">{message.email}</div>
            </div>
            <div className="sm:w-[150px] shrink-0">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Received</div>
              <div className="text-sm font-medium">{new Date(message.submittedAt).toLocaleString()}</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="inline-flex bg-background border border-border px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {message.category.replace(/_/g, " ")}
              </span>
              <div className="text-sm font-bold">{message.subject}</div>
            </div>
            <div className="w-full h-px bg-border" />
            <div className="text-sm whitespace-pre-wrap leading-relaxed">
              {message.message}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border mt-2">
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={10} /> First Response</div>
                <div className="text-xs">{message.firstResponseAt ? new Date(message.firstResponseAt).toLocaleString() : "None"}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={10} /> Resolved</div>
                <div className="text-xs">{message.resolvedAt ? new Date(message.resolvedAt).toLocaleString() : "None"}</div>
              </div>
            </div>
          </div>

          {canModerate ? (
          <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">RESOLUTION WORKFLOW</span>
              <a
                href={`mailto:${message.email}?subject=Re: ${encodeURIComponent(message.subject)}`}
                className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-background border border-border hover:border-primary hover:text-primary transition-colors px-2 py-1 rounded"
              >
                <Mail size={12} /> Open Email Client
              </a>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
              >
                <option value="open">Open</option>
                <option value="in_review">In Review</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
                <option value="escalated">Escalated</option>
              </select>
            </div>

            {isTerminal && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Resolution</label>
                  <input
                    type="text"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="E.g., Contacted user..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Resolution Reason</label>
                  <textarea
                    value={resolutionReason}
                    onChange={(e) => setResolutionReason(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary min-h-[60px]"
                  />
                </div>
              </>
            )}

            {isEscalated && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Escalation Reason</label>
                <textarea
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary min-h-[60px]"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Add Internal Note (Optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Log actions taken or context for other admins..."
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors min-h-[60px] resize-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving…" : <><CheckCircle size={15} /> Save Status</>}
              </button>
            </div>
          </form>
          ) : (
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Your administrator permissions allow viewing support cases, not updating them.
            </div>
          )}

          {message.notes && message.notes.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Note History</div>
              <div className="space-y-2">
                {message.notes.map(n => (
                  <div key={n.id} className="bg-card border border-border rounded-lg p-3 text-sm">
                    <div className="flex justify-between items-center mb-1 text-xs text-muted-foreground">
                      <span className="font-semibold">{n.authorDisplayName || "System"}</span>
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
