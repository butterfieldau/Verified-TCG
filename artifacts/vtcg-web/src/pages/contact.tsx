import { useState, useEffect } from "react";
import { MessageSquare, X, CheckCircle, Clock } from "lucide-react";
import { apiFetch, apiPatch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

interface SupportCase {
  id: string;
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assignedToAdminId?: string;
  outcome?: string;
  createdAt: string;
  updatedAt: string;
  submission: {
    id: string;
    name: string;
    email: string;
    category: string;
    subject: string;
    message: string;
    submittedAt: string;
  };
}

interface CaseNote {
  id: string;
  content: string;
  authorAdminId: string;
  noteType?: "internal" | "off_platform_reply";
  createdAt: string;
}

export default function ContactPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canManage = auth?.permissions.includes("support:manage") ?? false;
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [submissionsWithoutCase, setSubmissionsWithoutCase] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SupportCase | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [noteType, setNoteType] = useState<"internal" | "off_platform_reply">("internal");
  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadCases();
  }, [logout]);

  const loadCases = () => {
    setLoading(true);
    setError(null);
    apiFetch<{ cases: SupportCase[], submissionsWithoutCase: number }>("/admin/governance/support")
      .then((data) => {
        setCases(data.cases || []);
        setSubmissionsWithoutCase(data.submissionsWithoutCase || 0);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError(err.message || "Failed to load support cases.");
      })
      .finally(() => setLoading(false));
  };

  const openCase = async (c: SupportCase) => {
    setSelected(c);
    setLoadingNotes(true);
    setNotesError(null);
    setNotes([]);
    setNewNote("");
    setNoteType("internal");
    setOutcomeDraft(c.outcome ?? "");
    try {
      const data = await apiFetch<{ case: SupportCase; notes: CaseNote[] }>(`/admin/governance/support/${c.id}`);
      if (data.case) {
        setSelected(data.case);
        setOutcomeDraft(data.case.outcome ?? "");
      }
      setNotes(data.notes || []);
    } catch (err: any) {
      if (err instanceof UnauthorizedError) { logout(); return; }
      setNotesError(err.message || "Could not load case details.");
    } finally {
      setLoadingNotes(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!selected) return;
    setUpdating(true);
    try {
      const res = await apiPatch<{ case: SupportCase }>(`/admin/governance/support/${selected.id}`, { status });
      const updated = res.case ? { ...selected, ...res.case } : { ...selected, status: status as any };
      setSelected(updated);
      setCases(cases.map(c => c.id === selected.id ? { ...c, status: updated.status } : c));
      toast({ title: "Status updated" });
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !newNote.trim()) return;
    setUpdating(true);
    try {
      const res = await apiPost<{ note: CaseNote }>(`/admin/governance/support/${selected.id}/notes`, {
        content: newNote,
        noteType,
      });
      if (res.note) setNotes((prev) => [res.note, ...prev]);
      setNewNote("");
      setNoteType("internal");
      toast({ title: noteType === "off_platform_reply" ? "Off-platform reply logged" : "Note added" });
    } catch (err: any) {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const saveOutcome = async () => {
    if (!selected || !outcomeDraft.trim()) return;
    setUpdating(true);
    try {
      const res = await apiPatch<{ case: SupportCase }>(
        `/admin/governance/support/${selected.id}`,
        { outcome: outcomeDraft.trim() },
      );
      setSelected((current) => current ? { ...current, ...res.case } : current);
      setCases((current) => current.map((item) => item.id === selected.id ? { ...item, ...res.case } : item));
      toast({ title: "Outcome recorded" });
    } catch (err: any) {
      toast({ title: "Outcome update failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Support Inbox</h1>
      <p className="text-sm text-muted-foreground mb-8">Manage user support cases and inquiries.</p>

      {error && <ErrorBanner message={error} />}

      {!loading && submissionsWithoutCase > 0 && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
          <MessageSquare size={15} className="shrink-0" />
          {submissionsWithoutCase} contact submission{submissionsWithoutCase !== 1 ? "s" : ""} not yet linked to a support case.
        </div>
      )}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div>
          <div className="grid grid-cols-[1.5fr_1fr_2fr_100px_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>SENDER</span><span>CATEGORY</span><span>SUBJECT</span><span>STATUS</span><span>DATE</span>
          </div>

          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
               <div key={i} className="grid grid-cols-[1.5fr_1fr_2fr_100px_120px] gap-4 px-5 py-4 border-b border-border animate-pulse">
                {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-20" />)}
              </div>
            ))
          ) : cases.length === 0 ? (
            <div className="py-16 text-center">
              <MessageSquare size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No cases found.</p>
            </div>
          ) : (
            cases.map((m) => (
              <button key={m.id} onClick={() => openCase(m)} className="w-full grid grid-cols-[1.5fr_1fr_2fr_100px_120px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
                <div className="min-w-0 pr-4">
                  <div className="text-sm font-semibold truncate">{m.submission.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.submission.email}</div>
                </div>
                <div className="text-sm text-muted-foreground capitalize truncate">
                  <span className="inline-flex bg-background border border-border px-2 py-0.5 rounded-md text-xs">{m.submission.category.replace(/_/g, " ")}</span>
                </div>
                <div className="text-sm font-medium truncate pr-4">{m.submission.subject}</div>
                <div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    m.status === 'resolved' || m.status === 'closed' ? 'bg-positive/15 text-positive border border-positive/30' :
                    m.status === 'in_progress' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30' :
                    'bg-primary/15 text-primary border border-primary/30'
                  }`}>
                    {m.status || "OPEN"}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground tabular-nums">{fmtDate(m.submission.submittedAt)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)
        ) : cases.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <MessageSquare size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No cases found.</p>
          </div>
        ) : cases.map((m) => (
          <button key={m.id} onClick={() => openCase(m)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{m.submission.subject}</div>
                <div className="truncate text-xs text-muted-foreground">{m.submission.name} · {m.submission.email}</div>
              </div>
              <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                m.status === 'resolved' || m.status === 'closed' ? 'bg-positive/15 text-positive border border-positive/30' :
                m.status === 'in_progress' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30' :
                'bg-primary/15 text-primary border border-primary/30'
              }`}>
                {m.status || "OPEN"}
              </span>
            </div>
            <div className="mt-3 border-t border-border pt-3 flex justify-between items-center">
              <span className="inline-flex rounded-md border border-border bg-background px-2 py-0.5 text-xs capitalize text-muted-foreground">
                {m.submission.category.replace(/_/g, " ")}
              </span>
              <div className="text-xs text-muted-foreground">{fmtDate(m.submission.submittedAt)}</div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-4xl bg-background border border-border rounded-2xl shadow-2xl z-50 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground tracking-wider">CASE {selected.id.slice(0, 8).toUpperCase()}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  selected.status === 'resolved' || selected.status === 'closed' ? 'bg-positive/15 text-positive border border-positive/30' :
                  selected.status === 'in_progress' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30' :
                  'bg-primary/15 text-primary border border-primary/30'
                }`}>
                  {selected.status || "OPEN"}
                </span>
                {selected.priority && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-zinc-700">
                    PRIORITY: {selected.priority}
                  </span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 bg-card border border-border rounded-xl p-4">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">From</div>
                    <div className="text-sm font-bold truncate">{selected.submission.name}</div>
                    <a href={`mailto:${selected.submission.email}`} className="text-sm text-primary hover:underline truncate inline-block">{selected.submission.email}</a>
                  </div>
                  <div className="sm:w-[200px]">
                    <div className="text-xs text-muted-foreground mb-1">Date</div>
                    <div className="text-sm font-medium">{new Date(selected.submission.submittedAt).toLocaleString()}</div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-flex bg-background border border-border px-2 py-1 rounded-md text-xs font-semibold capitalize text-muted-foreground">
                      {selected.submission.category.replace(/_/g, " ")}
                    </span>
                    <div className="text-base font-bold">{selected.submission.subject}</div>
                  </div>
                  <div className="w-full h-px bg-border" />
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {selected.submission.message}
                  </div>
                </div>
              </div>

              <div className="w-full md:w-[320px] bg-card border-t md:border-t-0 md:border-l border-border flex flex-col">
                {canManage && (
                  <div className="p-4 border-b border-border bg-background/50">
                    <h4 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">WORKFLOW</h4>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStatus("in_progress")}
                          disabled={updating || selected.status === "in_progress"}
                          className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs font-bold rounded-md bg-background border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                        >
                          <Clock size={12} /> In Progress
                        </button>
                        <button
                          onClick={() => updateStatus("resolved")}
                          disabled={updating || selected.status === "resolved"}
                          className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs font-bold rounded-md bg-positive/10 text-positive border border-positive/30 hover:bg-positive/20 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle size={12} /> Resolve
                        </button>
                      </div>
                       <input
                         value={outcomeDraft}
                         onChange={(event) => setOutcomeDraft(event.target.value)}
                         placeholder="Record the case outcome..."
                         className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                       />
                       <button
                         onClick={saveOutcome}
                         disabled={updating || !outcomeDraft.trim()}
                         className="w-full rounded-md border border-border bg-background py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-50"
                       >
                         Save outcome
                       </button>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 flex flex-col">
                  <h4 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">CASE NOTES</h4>

                  <div className="flex-1 space-y-3 mb-4">
                    {loadingNotes ? (
                      <div className="animate-pulse space-y-3">
                        <div className="h-16 bg-border rounded-lg" />
                        <div className="h-16 bg-border rounded-lg" />
                      </div>
                    ) : notesError ? (
                      <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{notesError}</div>
                    ) : notes.length === 0 ? (
                      <div className="text-center text-sm text-muted-foreground py-6">No case notes.</div>
                    ) : (
                      notes.map(note => (
                        <div key={note.id} className="bg-background border border-border rounded-lg p-3 text-sm">
                          {note.noteType === "off_platform_reply" && (
                            <span className="mb-2 inline-flex rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                              Off-platform reply
                            </span>
                          )}
                          <p className="mb-2 whitespace-pre-wrap">{note.content}</p>
                          <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                            <span>{note.authorAdminId}</span>
                            <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {canManage ? (
                    <form onSubmit={addNote} className="mt-auto shrink-0 space-y-2">
                      <select
                        value={noteType}
                        onChange={(e) => setNoteType(e.target.value as "internal" | "off_platform_reply")}
                        className="w-full bg-background border border-border rounded-lg p-2 text-xs outline-none focus:border-primary"
                      >
                        <option value="internal">Internal note</option>
                        <option value="off_platform_reply">Log off-platform reply</option>
                      </select>
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={noteType === "off_platform_reply" ? "Summarise the reply you sent off-platform..." : "Add a private note..."}
                        className="w-full bg-background border border-border rounded-lg p-2 text-sm min-h-[80px] outline-none focus:border-primary resize-none"
                        required
                      />
                      <button
                        type="submit"
                        disabled={updating || !newNote.trim()}
                        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                      >
                        {noteType === "off_platform_reply" ? "Log Reply" : "Save Note"}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-auto shrink-0 text-xs text-muted-foreground">You do not have permission to add case notes.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border flex justify-end shrink-0 bg-card rounded-b-2xl">
              {canManage ? (
                <a
                  href={`mailto:${selected.submission.email}?subject=Re: ${encodeURIComponent(selected.submission.subject)}`}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Reply off-platform (Email)
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Read-only access. No reply action is available.</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
