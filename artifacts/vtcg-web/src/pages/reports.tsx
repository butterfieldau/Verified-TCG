import { useState, useEffect } from "react";
import { Flag, X } from "lucide-react";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";

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

export default function ReportsPage() {
  const { logout } = useAuth();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportRow | null>(null);

  useEffect(() => {
    apiFetch<{ reports: ReportRow[] }>("/admin/reports")
      .then((data) => setReports(data.reports))
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load reports.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Reports</h1>
      <p className="text-sm text-muted-foreground mb-8">All user-submitted reports. {reports.length > 0 ? `${reports.length} total.` : ""}</p>

      {error && <ErrorBanner message={error} />}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div>
          <div className="grid grid-cols-[1.5fr_1.5fr_1fr_120px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>REPORTER</span><span>REPORTED USER</span><span>REASON</span><span>DATE</span><span>STATUS</span>
          </div>

          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_1.5fr_1fr_120px_100px] gap-4 px-5 py-4 border-b border-border animate-pulse">
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
              <button key={r.id} onClick={() => setSelected(r)} className="w-full grid grid-cols-[1.5fr_1.5fr_1fr_120px_100px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
                <div className="text-sm font-medium truncate">
                  {r.reporterDisplayName ?? r.reporterUserId.slice(0, 8)}
                  {r.reporterUsername && <span className="text-muted-foreground ml-1">@{r.reporterUsername}</span>}
                </div>
                <div className="text-sm font-medium truncate">
                  {r.reportedDisplayName ?? r.reportedUserId.slice(0, 8)}
                  {r.reportedUsername && <span className="text-muted-foreground ml-1">@{r.reportedUsername}</span>}
                </div>
                <div className="text-sm text-muted-foreground capitalize truncate">{r.reason}</div>
                <div className="text-sm text-muted-foreground tabular-nums">{fmtDate(r.createdAt)}</div>
                <span className="text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full inline-flex w-fit">PENDING</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl border border-border bg-card" />)
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <Flag size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          </div>
        ) : reports.map((report) => (
          <button key={report.id} onClick={() => setSelected(report)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reported user</div>
                <div className="truncate text-sm font-bold">{report.reportedDisplayName ?? report.reportedUserId.slice(0, 8)}</div>
                {report.reportedUsername && <div className="truncate text-xs text-muted-foreground">@{report.reportedUsername}</div>}
              </div>
              <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">PENDING</span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
              <div>
                <div className="text-xs capitalize">{report.reason}</div>
                <div className="text-xs text-muted-foreground">By {report.reporterDisplayName ?? report.reporterUserId.slice(0, 8)}</div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">{fmtDate(report.createdAt)}</div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">REPORT DETAIL</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="space-y-4 overflow-y-auto shrink">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Reporter</div>
                  <div className="text-sm font-bold truncate">{selected.reporterDisplayName ?? "Unknown"}</div>
                  {selected.reporterUsername && <div className="text-xs text-muted-foreground truncate">@{selected.reporterUsername}</div>}
                  <div className="text-[10px] text-muted-foreground/60 font-mono mt-1 truncate">{selected.reporterUserId}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Reported User</div>
                  <div className="text-sm font-bold truncate">{selected.reportedDisplayName ?? "Unknown"}</div>
                  {selected.reportedUsername && <div className="text-xs text-muted-foreground truncate">@{selected.reportedUsername}</div>}
                  <div className="text-[10px] text-muted-foreground/60 font-mono mt-1 truncate">{selected.reportedUserId}</div>
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Reason</div>
                  <div className="text-sm font-semibold capitalize inline-flex px-2 py-1 bg-background border border-border rounded-md">{selected.reason}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Date</div>
                  <div className="text-sm font-medium">{new Date(selected.createdAt).toLocaleString()}</div>
                </div>
                {selected.note && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Additional Note</div>
                    <div className="text-sm bg-background border border-border rounded-md p-3 whitespace-pre-wrap">{selected.note}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
