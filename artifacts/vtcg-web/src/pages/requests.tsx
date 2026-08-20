import { useState, useEffect } from "react";
import { Download, Trash2, X, Shield, History, Activity, CheckCircle, Plus, ThumbsUp } from "lucide-react";
import { apiFetch, apiPost, apiDelete, apiPatch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

interface PrivacyRequest {
  id: string;
  userId: string | null;
  requesterEmail: string;
  requestType: string;
  description: string;
  status: string;
  identityVerified: boolean;
  verifiedAt?: string;
  verifiedByAdminId?: string;
  approvedAt?: string;
  approvedByAdminId?: string;
  createdAt: string;
  exportOutcome?: string;
  errorDetails?: string;
}

interface RetentionRun {
  id: string;
  status: string;
  outcome: string;
  affectedCount: number;
  notes: string;
  isDryRun: boolean;
  completedAt: string;
  createdAt: string;
}

interface RetentionPolicy {
  id: string;
  name: string;
  description: string;
  dataType: string;
  retentionDays: number;
  status: string;
}

interface RequestNote {
  id: string;
  content: string;
  authorAdminId: string;
  createdAt: string;
}

export default function RequestsPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const isOwner = auth?.admin.role === "owner";
  const canManagePrivacy = auth?.permissions.includes("privacy:manage") ?? false;
  const canApprovePrivacy = auth?.permissions.includes("privacy:approve") ?? false;
  const canExportPrivacy = auth?.permissions.includes("privacy:export") ?? false;
  const canDeletePrivacy = (auth?.permissions.includes("privacy:delete") ?? false) && isOwner;
  const canManageRetention = auth?.permissions.includes("retention:manage") ?? false;
  const canRunRetention = canManageRetention && isOwner;
  const [activeTab, setActiveTab] = useState<"privacy" | "retention">("privacy");
  
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [runs, setRuns] = useState<RetentionRun[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedRequest, setSelectedRequest] = useState<PrivacyRequest | null>(null);
  const [requestNotes, setRequestNotes] = useState<RequestNote[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [activePolicyId, setActivePolicyId] = useState<string>("");

  // Intake form (create privacy request)
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intake, setIntake] = useState({ requesterEmail: "", userId: "", requestType: "export_data", description: "" });
  const [submittingIntake, setSubmittingIntake] = useState(false);

  // Retention policy editor
  const [policyEditorOpen, setPolicyEditorOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState({ name: "", description: "", dataType: "audit_log", retentionDays: 90, status: "active" });
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = () => {
    setLoading(true);
    setError(null);
    if (activeTab === "privacy") {
      apiFetch<{ requests: PrivacyRequest[] }>("/admin/governance/privacy")
        .then((data) => setRequests(data.requests || []))
        .catch((err) => {
          if (err instanceof UnauthorizedError) logout();
          else setError(err.message || "Failed to load requests.");
        })
        .finally(() => setLoading(false));
    } else {
      apiFetch<{ runs: RetentionRun[], policies: RetentionPolicy[] }>("/admin/governance/retention")
        .then((data) => {
          setRuns(data.runs || []);
          setPolicies(data.policies || []);
          if (data.policies?.length > 0 && !activePolicyId) {
            setActivePolicyId(data.policies[0].id);
          }
        })
        .catch((err) => {
          if (err instanceof UnauthorizedError) logout();
          else setError(err.message || "Failed to load retention data.");
        })
        .finally(() => setLoading(false));
    }
  };

  const handleRunRetention = async (dryRun: boolean) => {
    if (!activePolicyId) {
      toast({ title: "No policy selected", variant: "destructive" });
      return;
    }
    try {
      setProcessingId("run");
      const res = await apiPost<{ run: RetentionRun, message: string, automatedExecutionAvailable: boolean }>(`/admin/governance/retention/${activePolicyId}/run`, { 
        isDryRun: dryRun,
        confirmText: dryRun ? undefined : "RUN"
      });
      // A real (non-dry) run is always blocked because automated execution is
      // unavailable — the API deletes nothing and reports it explicitly.
      toast({ 
        title: dryRun ? "Dry run complete (no data changed)" : "Real run blocked — nothing deleted",
        description: res.message,
        variant: dryRun ? "default" : "destructive"
      });
      loadData();
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
        toast({ title: "Retention task failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const openRequest = async (r: PrivacyRequest) => {
    setSelectedRequest(r);
    setLoadingDetail(true);
    setDetailError(null);
    setRequestNotes([]);
    setNewNote("");
    try {
      const data = await apiFetch<{ request: PrivacyRequest; notes: RequestNote[] }>(`/admin/governance/privacy/${r.id}`);
      if (data.request) setSelectedRequest(data.request);
      setRequestNotes(data.notes || []);
    } catch (err: any) {
      if (err instanceof UnauthorizedError) { logout(); return; }
      setDetailError(err.message || "Could not load request details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const addRequestNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !newNote.trim()) return;
    try {
      setProcessingId("note-" + selectedRequest.id);
      const res = await apiPost<{ note: RequestNote }>(`/admin/governance/privacy/${selectedRequest.id}/notes`, { content: newNote });
      if (res.note) setRequestNotes((prev) => [res.note, ...prev]);
      setNewNote("");
      toast({ title: "Note added" });
    } catch (err: any) {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intake.requesterEmail.trim()) return;
    setSubmittingIntake(true);
    try {
      const payload: Record<string, unknown> = {
        requesterEmail: intake.requesterEmail.trim(),
        requestType: intake.requestType,
        description: intake.description.trim(),
      };
      if (intake.userId.trim()) payload.userId = intake.userId.trim();
      await apiPost("/admin/governance/privacy", payload);
      toast({ title: "Privacy request created" });
      setIntakeOpen(false);
      setIntake({ requesterEmail: "", userId: "", requestType: "export_data", description: "" });
      loadData();
    } catch (err: any) {
      toast({ title: "Could not create request", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingIntake(false);
    }
  };

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyForm.name.trim() || !policyForm.dataType.trim()) return;
    setSavingPolicy(true);
    try {
      await apiPost("/admin/governance/retention", {
        name: policyForm.name.trim(),
        description: policyForm.description.trim(),
        dataType: policyForm.dataType.trim(),
        retentionDays: Number(policyForm.retentionDays),
        status: policyForm.status,
      });
      toast({ title: "Retention policy saved" });
      setPolicyEditorOpen(false);
      loadData();
    } catch (err: any) {
      // The upsert endpoint requires recent auth; the reauth prompt is triggered
      // globally, so only surface non-reauth failures.
      if (err.code !== "RECENT_AUTH_REQUIRED") {
        toast({ title: "Could not save policy", description: err.message, variant: "destructive" });
      }
    } finally {
      setSavingPolicy(false);
    }
  };

  const editPolicy = (p: RetentionPolicy) => {
    setPolicyForm({ name: p.name, description: p.description, dataType: p.dataType, retentionDays: p.retentionDays, status: p.status });
    setPolicyEditorOpen(true);
  };

  const verifyIdentity = async (id: string) => {
    try {
      setProcessingId("verify-" + id);
      const res = await apiPatch<{ request: PrivacyRequest }>(`/admin/governance/privacy/${id}`, { identityVerified: true });
      setRequests(requests.map(r => r.id === id ? res.request : r));
      setSelectedRequest(res.request);
      toast({ title: "Identity verified" });
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  const approveRequest = async (id: string) => {
    try {
      setProcessingId("approve-" + id);
      const res = await apiPost<{ request: PrivacyRequest }>(`/admin/governance/privacy/${id}/approve`, {});
      setRequests(requests.map(r => r.id === id ? res.request : r));
      setSelectedRequest(res.request);
      toast({ title: "Request approved" });
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
        toast({ title: "Approval failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleExport = async (id: string) => {
    try {
      setProcessingId(id);
      const res = await apiPost<{ export: any, message: string }>(`/admin/governance/privacy/${id}/export`, {});
      toast({ title: "Export generated", description: res.message });
      loadData();
      
      // Allow download if data exists
      if (res.export) {
        const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export-${id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
         toast({ title: "Export failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirmText !== "DELETE") return;
    try {
      setProcessingId(id);
      await apiDelete(`/admin/governance/privacy/${id}/delete-account`, { confirmText: "DELETE" });
      toast({ title: "Deletion confirmed", description: "User data has been purged." });
      setConfirmDeleteOpen(false);
      setSelectedRequest(null);
      loadData();
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
         toast({ title: "Deletion failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setProcessingId(null);
      setDeleteConfirmText("");
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Privacy & Compliance</h1>
          <p className="text-sm text-muted-foreground">Manage data requests and automated retention policies.</p>
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1">
          <button
            onClick={() => setActiveTab("privacy")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              activeTab === "privacy" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            User Requests
          </button>
          <button
            onClick={() => setActiveTab("retention")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              activeTab === "retention" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Retention
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {activeTab === "privacy" && (
        <>
          {canManagePrivacy && (
            <div className="mb-4 flex justify-end">
              <button
                onClick={() => { setIntake({ requesterEmail: "", userId: "", requestType: "export_data", description: "" }); setIntakeOpen(true); }}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> Log Request
              </button>
            </div>
          )}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <div>
              <div className="grid grid-cols-[1fr_2fr_1fr_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
                <span>TYPE</span><span>USER</span><span>STATUS</span><span>DATE</span>
              </div>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[1fr_2fr_1fr_120px] gap-4 px-5 py-4 border-b border-border animate-pulse">
                    {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-24" />)}
                  </div>
                ))
              ) : requests.length === 0 ? (
                <div className="py-16 text-center">
                  <Shield size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No pending privacy requests.</p>
                </div>
              ) : (
                requests.map((r) => (
                  <button key={r.id} onClick={() => openRequest(r)} className="w-full grid grid-cols-[1fr_2fr_1fr_120px] gap-4 px-5 py-3.5 border-b border-border items-center hover:bg-background transition-colors text-left">
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider ${
                        r.requestType.includes('delete') || r.requestType.includes('forget') ? 'bg-negative/15 text-negative border border-negative/30' : 'bg-primary/15 text-primary border border-primary/30'
                      }`}>
                        {r.requestType.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate flex items-center gap-2">
                        {r.requesterEmail} 
                        {r.identityVerified && <CheckCircle size={12} className="text-positive" />}
                      </div>
                      {r.userId && <div className="text-[10px] text-muted-foreground font-mono truncate">{r.userId}</div>}
                    </div>
                    <div>
                      <span className="text-xs font-medium capitalize text-muted-foreground border border-border px-2 py-0.5 rounded-full bg-background">{r.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="text-sm text-muted-foreground tabular-nums">{fmtDate(r.createdAt)}</div>
                  </button>
                ))
              )}
            </div>
          </div>
          
          <div className="space-y-3 md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-card" />)
            ) : requests.length === 0 ? (
              <div className="rounded-xl border border-border bg-card py-14 text-center">
                <Shield size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No pending privacy requests.</p>
              </div>
            ) : (
              requests.map((r) => (
                <button key={r.id} onClick={() => openRequest(r)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      r.requestType.includes('delete') || r.requestType.includes('forget') ? 'bg-negative/15 text-negative border border-negative/30' : 'bg-primary/15 text-primary border border-primary/30'
                    }`}>
                      {r.requestType.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-medium capitalize text-muted-foreground border border-border px-2 py-0.5 rounded-full bg-background">{r.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-sm font-bold truncate mt-2 flex items-center gap-1">
                    {r.requesterEmail}
                    {r.identityVerified && <CheckCircle size={12} className="text-positive" />}
                  </div>
                  {r.userId && <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{r.userId}</div>}
                  <div className="text-xs text-muted-foreground mt-3">{fmtDate(r.createdAt)}</div>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {activeTab === "retention" && (
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h3 className="font-bold text-sm">Execution History</h3>
            </div>
            {loading ? (
              <div className="p-8 text-center animate-pulse">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="p-10 text-center">
                <History size={32} className="mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No retention runs recorded.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {runs.map((run) => (
                  <div key={run.id} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{new Date(run.createdAt).toLocaleString()}</span>
                        {run.isDryRun && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wide border border-amber-500/30">Dry Run</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{run.notes}</div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                      run.outcome === 'blocked' || run.outcome === 'failed' ? 'bg-negative/10 text-negative' : 'bg-positive/10 text-positive'
                    }`}>
                      {run.outcome.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">Policies</h3>
                {canManageRetention && (
                  <button
                    onClick={() => { setPolicyForm({ name: "", description: "", dataType: "audit_log", retentionDays: 90, status: "active" }); setPolicyEditorOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary"
                  >
                    <Plus size={13} /> New
                  </button>
                )}
              </div>
              {policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No retention policies defined.</p>
              ) : (
                <div className="space-y-2">
                  {policies.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{p.dataType} · {p.retentionDays}d · {p.status}</div>
                      </div>
                      {canManageRetention && (
                        <button onClick={() => editPolicy(p)} className="text-xs font-bold text-muted-foreground hover:text-primary shrink-0">Edit</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canRunRetention && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-bold text-sm mb-2">Manual Execution</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  A dry run only simulates and changes nothing. A real run is blocked: automated execution is unavailable, so no data is deleted.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">SELECT POLICY</label>
                    <select 
                      value={activePolicyId} 
                      onChange={e => setActivePolicyId(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2 text-sm"
                    >
                      {policies.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.retentionDays}d)</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <button 
                      onClick={() => handleRunRetention(true)}
                      disabled={processingId === "run" || !activePolicyId}
                      className="w-full py-2 border border-border bg-background hover:bg-muted text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {processingId === "run" ? "Processing..." : "Dry Run (Simulate — no changes)"}
                    </button>
                    <button 
                      onClick={() => handleRunRetention(false)}
                      disabled={processingId === "run" || !activePolicyId}
                      className="w-full py-2 bg-negative text-negative-foreground text-sm font-bold rounded-lg transition-colors hover:bg-negative/90 disabled:opacity-50"
                    >
                      Attempt Real Run (currently blocked)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedRequest && !confirmDeleteOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setSelectedRequest(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">{selectedRequest.requestType.replace(/_/g, " ")} REQUEST</span>
              <button onClick={() => setSelectedRequest(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="space-y-4 overflow-y-auto">
              {detailError && (
                <div className="rounded-xl border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{detailError}</div>
              )}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex justify-between items-start">
                  <div className="text-xs text-muted-foreground mb-1">User</div>
                  {selectedRequest.identityVerified ? (
                    <span className="text-[10px] font-bold text-positive bg-positive/10 px-2 py-0.5 rounded-full flex items-center gap-1 border border-positive/30"><CheckCircle size={10} /> VERIFIED</span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">UNVERIFIED</span>
                  )}
                </div>
                <div className="text-sm font-bold truncate">{selectedRequest.requesterEmail}</div>
                {selectedRequest.userId && <div className="text-[10px] text-muted-foreground font-mono mt-1 break-all">{selectedRequest.userId}</div>}
                
                {!selectedRequest.identityVerified && canManagePrivacy && (
                  <button 
                    onClick={() => verifyIdentity(selectedRequest.id)}
                    disabled={processingId === "verify-" + selectedRequest.id}
                    className="mt-3 w-full py-1.5 border border-border bg-background text-xs font-bold rounded text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Mark Verified
                  </button>
                )}
                {selectedRequest.identityVerified && selectedRequest.status !== "approved" && selectedRequest.status !== "completed" && selectedRequest.status !== "rejected" && canApprovePrivacy && (
                  <button 
                    onClick={() => approveRequest(selectedRequest.id)}
                    disabled={processingId === "approve-" + selectedRequest.id}
                    className="mt-3 w-full py-1.5 border border-primary/50 bg-primary/10 text-xs font-bold rounded text-primary hover:bg-primary/20 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    <ThumbsUp size={11} /> Approve Request
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Status</div>
                  <div className="text-sm font-semibold capitalize">{selectedRequest.status.replace(/_/g, " ")}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">Submitted</div>
                  <div className="text-sm font-semibold">{new Date(selectedRequest.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
              
              {(selectedRequest.exportOutcome || selectedRequest.errorDetails) && (
                <div className="bg-card border border-border rounded-xl p-4 text-sm">
                  <div className="font-bold text-xs text-muted-foreground mb-1">EXECUTION DETAILS</div>
                  {selectedRequest.exportOutcome && <div>Outcome: <strong>{selectedRequest.exportOutcome}</strong></div>}
                  {selectedRequest.errorDetails && <div className="text-negative mt-1">{selectedRequest.errorDetails}</div>}
                </div>
              )}

              <div className="bg-card border border-border rounded-xl p-4">
                <div className="font-bold text-xs text-muted-foreground mb-2 tracking-wider">CASE NOTES &amp; HISTORY</div>
                {loadingDetail ? (
                  <div className="animate-pulse space-y-2"><div className="h-10 rounded bg-border" /><div className="h-10 rounded bg-border" /></div>
                ) : requestNotes.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No notes recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {requestNotes.map((n) => (
                      <div key={n.id} className="rounded-lg border border-border bg-background p-2.5 text-sm">
                        <p className="whitespace-pre-wrap mb-1.5">{n.content}</p>
                        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                          <span>{n.authorAdminId}</span>
                          <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {canManagePrivacy && (
                  <form onSubmit={addRequestNote} className="mt-3 space-y-2">
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a note..."
                      className="w-full bg-background border border-border rounded-lg p-2 text-sm min-h-[60px] outline-none focus:border-primary resize-none"
                      required
                    />
                    <button
                      type="submit"
                      disabled={processingId === "note-" + selectedRequest.id || !newNote.trim()}
                      className="w-full bg-primary text-primary-foreground py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      Add Note
                    </button>
                  </form>
                )}
              </div>
            </div>
            
            <div className="mt-6 pt-5 border-t border-border flex justify-end shrink-0">
              {selectedRequest.requestType === "export_data" ? (
                canExportPrivacy ? (
                  <button 
                    onClick={() => handleExport(selectedRequest.id)}
                    disabled={processingId === selectedRequest.id || !selectedRequest.identityVerified || selectedRequest.status !== "approved"}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    title={!selectedRequest.identityVerified || selectedRequest.status !== "approved" ? "Must be verified and approved first" : ""}
                  >
                    <Download size={16} /> 
                    {processingId === selectedRequest.id ? "Processing..." : "Generate & Download"}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground self-center">Export requires privacy:export permission.</span>
                )
              ) : selectedRequest.requestType === "delete_account" || selectedRequest.requestType === "right_to_forget" ? (
                canDeletePrivacy ? (
                  <button 
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="flex items-center gap-2 bg-negative text-negative-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-negative/90 transition-colors"
                  >
                    <Trash2 size={16} /> Review Deletion
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground self-center">Permanent deletion requires an owner with privacy:delete.</span>
                )
              ) : (
                <span className="text-xs text-muted-foreground self-center">No automated action for this request type.</span>
              )}
            </div>
          </div>
        </>
      )}

      {selectedRequest && confirmDeleteOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm" />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-sm bg-background border border-border rounded-2xl shadow-2xl z-[70] p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-negative/10 text-negative mb-4 mx-auto">
              <Activity size={24} />
            </div>
            <h3 className="text-center font-display text-xl font-bold mb-2">Confirm Data Purge</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              This action is irreversible and will permanently delete all data associated with <strong>{selectedRequest.requesterEmail}</strong>.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1 text-center">
                  TYPE <span className="font-mono bg-muted px-1 py-0.5 rounded text-foreground">DELETE</span> TO CONFIRM
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full text-center bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-negative"
                  placeholder="DELETE"
                />
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="flex-1 border border-border rounded-lg py-2 text-sm font-bold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDelete(selectedRequest.id)}
                  disabled={deleteConfirmText !== "DELETE" || processingId === selectedRequest.id}
                  className="flex-1 bg-negative text-negative-foreground rounded-lg py-2 text-sm font-bold disabled:opacity-50 transition-colors"
                >
                  {processingId === selectedRequest.id ? "Purging..." : "Purge Data"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {intakeOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => !submittingIntake && setIntakeOpen(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md bg-background border border-border rounded-2xl shadow-2xl z-50 p-6">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">LOG PRIVACY REQUEST</span>
              <button onClick={() => !submittingIntake && setIntakeOpen(false)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            <form onSubmit={submitIntake} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">REQUESTER EMAIL</label>
                <input
                  type="email"
                  value={intake.requesterEmail}
                  onChange={(e) => setIntake({ ...intake, requesterEmail: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                  required
                  placeholder="collector@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">USER ID (OPTIONAL)</label>
                <input
                  type="text"
                  value={intake.userId}
                  onChange={(e) => setIntake({ ...intake, userId: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary font-mono"
                  placeholder="Linked account UUID"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">REQUEST TYPE</label>
                <select
                  value={intake.requestType}
                  onChange={(e) => setIntake({ ...intake, requestType: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                >
                  <option value="export_data">Export data</option>
                  <option value="delete_account">Delete account</option>
                  <option value="right_to_forget">Right to be forgotten</option>
                  <option value="data_correction">Data correction</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">DESCRIPTION</label>
                <textarea
                  value={intake.description}
                  onChange={(e) => setIntake({ ...intake, description: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm min-h-[80px] outline-none focus:border-primary resize-y"
                  placeholder="Context for this request..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIntakeOpen(false)} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Cancel</button>
                <button type="submit" disabled={submittingIntake || !intake.requesterEmail.trim()} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50">
                  {submittingIntake ? "Creating..." : "Create Request"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {policyEditorOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => !savingPolicy && setPolicyEditorOpen(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md bg-background border border-border rounded-2xl shadow-2xl z-50 p-6">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">RETENTION POLICY</span>
              <button onClick={() => !savingPolicy && setPolicyEditorOpen(false)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            <form onSubmit={savePolicy} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">NAME</label>
                <input
                  type="text"
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                  required
                  placeholder="e.g. Audit log retention"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Saving an existing name updates that policy.</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">DATA TYPE</label>
                <select
                  value={policyForm.dataType}
                  onChange={(e) => setPolicyForm({ ...policyForm, dataType: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                >
                  <option value="audit_log">Audit log</option>
                  <option value="activity_log">Activity log</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1">RETENTION DAYS</label>
                  <input
                    type="number"
                    min={1}
                    value={policyForm.retentionDays}
                    onChange={(e) => setPolicyForm({ ...policyForm, retentionDays: parseInt(e.target.value) || 0 })}
                    className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1">STATUS</label>
                  <select
                    value={policyForm.status}
                    onChange={(e) => setPolicyForm({ ...policyForm, status: e.target.value })}
                    className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">DESCRIPTION</label>
                <textarea
                  value={policyForm.description}
                  onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg p-3 text-sm min-h-[70px] outline-none focus:border-primary resize-y"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPolicyEditorOpen(false)} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Cancel</button>
                <button type="submit" disabled={savingPolicy || !policyForm.name.trim() || policyForm.retentionDays < 1} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50">
                  {savingPolicy ? "Saving..." : "Save Policy"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}