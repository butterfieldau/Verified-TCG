import { useState, useEffect } from "react";
import { Flag, X, ShieldAlert } from "lucide-react";
import { useReports, useReport, useAssignReport, useReportNotes, useReportOutcome, useSuspendUser } from "@/hooks/use-reports";
import { useAuth } from "@/contexts/auth";
import { ErrorBanner, fmtDate } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

export default function ReportsPage() {
  const { auth } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [assignFilter, setAssignFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canManage = auth?.permissions.includes("reports:moderate");
  const canManageUsers = auth?.permissions.includes("users:manage");

  const { data: reportsData, isLoading: loadingReports, error: reportsError } = useReports({
    page, limit: 20, search: debouncedSearch, status: statusFilter, assignedTo: assignFilter
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Reports</h1>
      <p className="text-sm text-muted-foreground mb-8">Investigate user reports and take moderation action.</p>

      {reportsError && <ErrorBanner message="Failed to load reports." />}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 flex-wrap sm:flex-nowrap">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="under_review">Under Review</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="escalated">Escalated</option>
          </select>
          <select value={assignFilter} onChange={e => { setAssignFilter(e.target.value); setPage(1); }} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">All Assignments</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <input type="text" placeholder="Search usernames..." value={search} onChange={e => setSearch(e.target.value)} className="w-full sm:flex-1 bg-card border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold w-full sm:w-auto">Search</button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1.5fr_1.5fr_1fr_120px_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>REPORTER</span><span>REPORTED USER</span><span>REASON</span><span>DATE</span><span>STATUS</span>
        </div>

        {loadingReports ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col sm:grid sm:grid-cols-[1.5fr_1.5fr_1fr_120px_120px] gap-4 px-5 py-4 border-b border-border animate-pulse">
              {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-full" />)}
            </div>
          ))
        ) : reportsData?.reports?.length === 0 ? (
          <div className="py-16 text-center">
            <Flag size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No reports match your filters.</p>
          </div>
        ) : (
          reportsData?.reports?.map((r: any) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className="w-full flex flex-col sm:grid sm:grid-cols-[1.5fr_1.5fr_1fr_120px_120px] gap-2 sm:gap-4 px-5 py-4 sm:py-3.5 border-b border-border hover:bg-background transition-colors text-left sm:items-center">
              <div className="text-sm font-medium truncate">
                <span className="sm:hidden font-bold text-muted-foreground text-xs mr-2 uppercase">Reporter:</span>
                {r.reporterDisplayName ?? r.reporterUserId.slice(0, 8)}
                {r.reporterUsername && <span className="text-muted-foreground ml-1">@{r.reporterUsername}</span>}
              </div>
              <div className="text-sm font-medium truncate">
                <span className="sm:hidden font-bold text-muted-foreground text-xs mr-2 uppercase">Reported:</span>
                {r.reportedDisplayName ?? r.reportedUserId.slice(0, 8)}
                {r.reportedUsername && <span className="text-muted-foreground ml-1">@{r.reportedUsername}</span>}
              </div>
              <div className="text-sm text-muted-foreground capitalize truncate">
                <span className="sm:hidden font-bold text-muted-foreground text-xs mr-2 uppercase">Reason:</span>
                {r.reason}
              </div>
              <div className="text-sm text-muted-foreground tabular-nums">
                <span className="sm:hidden font-bold text-muted-foreground text-xs mr-2 uppercase">Date:</span>
                {fmtDate(r.createdAt)}
              </div>
              <div className="flex items-center gap-2 mt-2 sm:mt-0">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase truncate ${
                  r.status === 'new' ? 'bg-primary/20 text-primary border border-primary/30' :
                  r.status === 'actioned' ? 'bg-positive/20 text-positive border border-positive/30' :
                  r.status === 'escalated' ? 'bg-negative/20 text-negative border border-negative/30' :
                  'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                }`}>
                  {r.status}
                </span>
                {r.assignedAdminId === auth?.admin.id && <span className="w-2 h-2 rounded-full bg-primary" title="Assigned to you" />}
              </div>
            </button>
          ))
        )}
        <div className="p-4 bg-background flex justify-between">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold disabled:opacity-50">PREV</button>
          <button onClick={() => setPage(p => p + 1)} disabled={reportsData?.reports?.length < 20} className="text-xs font-bold disabled:opacity-50">NEXT</button>
        </div>
      </div>

      {selectedId && <ReportDetailModal reportId={selectedId} onClose={() => setSelectedId(null)} currentAdminId={auth?.admin.id!} canManage={!!canManage} canManageUsers={!!canManageUsers} />}
    </div>
  );
}

function ReportDetailModal({ reportId, onClose, currentAdminId, canManage, canManageUsers }: { reportId: string, onClose: () => void, currentAdminId: string, canManage: boolean, canManageUsers: boolean }) {
  const { data, isLoading } = useReport(reportId);
  const assign = useAssignReport();
  const notes = useReportNotes();
  const outcome = useReportOutcome();
  const suspend = useSuspendUser();
  const { toast } = useToast();

  const [newNote, setNewNote] = useState("");
  const [noteReason, setNoteReason] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");

  const [outcomeReason, setOutcomeReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendConfirm, setSuspendConfirm] = useState("");
  const [showSuspend, setShowSuspend] = useState(false);

  if (isLoading || !data) return null;

  const { report, notes: existingNotes, previousReportCount, relatedBlocks, statusHistory = [] } = data;
  const isAssignedToMe = report.assignedAdminId === currentAdminId;

  const handleAssign = () => {
    const reason = assignmentReason.trim();
    if (!reason) return;

    assign.mutate({ id: report.id, assignTo: isAssignedToMe ? null : 'me', reason }, {
      onSuccess: () => {
        setAssignmentReason("");
        toast({ title: isAssignedToMe ? "Unassigned report" : "Assigned to you" });
      },
      onError: (err: any) => toast({ title: "Failed to update assignment", description: err.message, variant: "destructive" })
    });
  };

  const handleNote = () => {
    notes.mutate({ id: report.id, note: newNote, reason: noteReason }, {
      onSuccess: () => {
        toast({ title: "Note added" });
        setNewNote("");
        setNoteReason("");
      },
      onError: (err: any) => toast({ title: "Failed to add note", description: err.message, variant: "destructive" })
    });
  };

  const handleOutcome = (status: string) => {
    outcome.mutate({ id: report.id, status, reason: outcomeReason }, {
      onSuccess: () => {
        toast({ title: "Report updated" });
        setOutcomeReason("");
      },
      onError: (err: any) => toast({ title: "Failed to update report", description: err.message, variant: "destructive" })
    });
  };

  const handleSuspend = () => {
    suspend.mutate({ id: report.id, reason: suspendReason, confirmation: suspendConfirm }, {
      onSuccess: () => {
        toast({ title: "User suspended and report actioned" });
        setShowSuspend(false);
        setSuspendReason("");
        setSuspendConfirm("");
      },
      onError: (err: any) => toast({ title: "Failed to suspend user", description: err.message, variant: "destructive" })
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-5 shrink-0 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-muted-foreground tracking-wider">REPORT DETAIL</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${report.status === 'actioned' ? 'bg-positive/20 text-positive' : 'bg-primary/20 text-primary'}`}>{report.status}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto pr-2 space-y-6 flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Reporter</div>
              <div className="font-mono text-xs">{report.reporterUserId}</div>
            </div>
            <div className="bg-card border border-negative/30 rounded-xl p-4">
              <div className="text-[10px] font-bold text-negative uppercase mb-2">Reported User</div>
              <div className="font-mono text-xs text-negative mb-2">{report.reportedUserId}</div>
              <div className="flex gap-2">
                <span className="text-[10px] font-bold bg-background border border-border px-2 py-1 rounded-md">{previousReportCount} previous reports</span>
                <span className="text-[10px] font-bold bg-background border border-border px-2 py-1 rounded-md">{relatedBlocks.length} related blocks</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Report Context</div>
            <div className="text-sm font-bold uppercase mb-2 inline-flex bg-background px-2 py-1 rounded border border-border">{report.reason}</div>
            {report.note && <div className="text-sm bg-background p-3 rounded-md border border-border mt-2">{report.note}</div>}
            {report.evidenceRefs?.length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Evidence References</div>
                <div className="space-y-2">
                  {report.evidenceRefs.map((reference: string, index: number) => {
                    const isUrl = /^https?:\/\//i.test(reference);
                    return isUrl ? (
                      <a
                        key={`${reference}-${index}`}
                        href={reference}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all rounded-md border border-border bg-background px-3 py-2 text-xs text-primary hover:underline"
                      >
                        {reference}
                      </a>
                    ) : (
                      <div key={`${reference}-${index}`} className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                        {reference}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground tracking-wider">MODERATION WORKFLOW</h4>

            <div className="flex flex-col gap-4 bg-card border border-border p-4 rounded-xl">
              <div>
                <div className="text-sm font-bold">Assignment</div>
                <div className="text-xs text-muted-foreground">{report.assignedAdminId ? (isAssignedToMe ? "Assigned to you" : `Assigned to ${report.assignedAdminId}`) : "Unassigned"}</div>
              </div>
              {canManage && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={assignmentReason}
                    onChange={e => setAssignmentReason(e.target.value)}
                    placeholder={`Business reason to ${isAssignedToMe ? "unassign" : "take ownership"}`}
                    className="min-w-0 flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleAssign}
                    disabled={!assignmentReason.trim() || assign.isPending}
                    className={`px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50 ${isAssignedToMe ? 'border border-border hover:bg-muted' : 'bg-primary text-white'}`}
                  >
                    {isAssignedToMe ? "Unassign" : "Assign to me"}
                  </button>
                </div>
              )}
            </div>

            {canManage && (
              <div className="bg-card border border-border p-4 rounded-xl space-y-4">
                <div className="text-sm font-bold">Notes & History</div>
                {statusHistory.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-bold mb-2">Status History</div>
                    <div className="space-y-2">
                      {statusHistory.map((h: any) => (
                        <div key={h.id} className="text-xs flex gap-2">
                          <span className="text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(h.createdAt).split(',')[0]}</span>
                          <span>
                            <span className="font-bold uppercase">{h.fromStatus || 'none'} → {h.toStatus}</span>
                            {h.reason && <span className="text-muted-foreground ml-1">({h.reason})</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {existingNotes.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {existingNotes.map((n: any) => (
                      <div key={n.id} className="text-xs bg-background border border-border p-2 rounded-md">
                        <span className="font-mono text-muted-foreground mr-2">{n.adminId.slice(0,8)}</span> {n.note}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a private note..." className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                  <input type="text" value={noteReason} onChange={e => setNoteReason(e.target.value)} placeholder="Business reason for note" className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                  <button onClick={handleNote} disabled={!newNote || !noteReason || notes.isPending} className="self-end px-4 py-2 bg-secondary text-secondary-foreground text-xs font-bold rounded-lg disabled:opacity-50">Save Note</button>
                </div>
              </div>
            )}

            {canManage && (
              <div className="bg-card border border-border p-4 rounded-xl space-y-4">
                <div className="text-sm font-bold">Resolution</div>
                <textarea
                  value={outcomeReason}
                  onChange={e => setOutcomeReason(e.target.value)}
                  placeholder="Reason for decision..."
                  className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none min-h-[60px]"
                />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleOutcome('dismissed')} disabled={!outcomeReason || outcome.isPending} className="px-4 py-2 border border-border text-xs font-bold rounded-lg hover:bg-muted disabled:opacity-50">Dismiss</button>
                  <button onClick={() => handleOutcome('actioned')} disabled={!outcomeReason || outcome.isPending} className="px-4 py-2 bg-positive text-white text-xs font-bold rounded-lg disabled:opacity-50">Mark Actioned</button>
                  <button onClick={() => handleOutcome('escalated')} disabled={!outcomeReason || outcome.isPending} className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg disabled:opacity-50">Escalate</button>
                </div>
              </div>
            )}

            {canManage && canManageUsers && (
              <div className="border border-negative/30 bg-negative/5 p-4 rounded-xl">
                <button onClick={() => setShowSuspend(!showSuspend)} className="text-sm font-bold text-negative flex items-center gap-2">
                  <ShieldAlert size={16} /> Suspend Reported User
                </button>
                {showSuspend && (
                  <div className="mt-4 space-y-3">
                    <input type="text" value={suspendReason} onChange={e => setSuspendReason(e.target.value)} placeholder="Reason for suspension..." className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                    <input type="text" value={suspendConfirm} onChange={e => setSuspendConfirm(e.target.value)} placeholder="Type SUSPEND to confirm" className="w-full text-sm bg-background border border-negative/50 rounded-lg px-3 py-2 outline-none focus:border-negative" />
                    <button
                      onClick={handleSuspend}
                      disabled={suspend.isPending || !suspendReason || suspendConfirm !== 'SUSPEND'}
                      className="w-full py-2 bg-negative text-white text-xs font-bold rounded-lg disabled:opacity-50"
                    >
                      Suspend User & Close Report
                    </button>
                    <p className="text-[10px] text-muted-foreground text-center">Requires recent password confirmation.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
