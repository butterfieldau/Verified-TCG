import { useState, useEffect, useCallback } from "react";
import { apiFetch, apiPatch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { ErrorBanner, SkeletonCard } from "@/components/admin-ui";
import { ShieldAlert, RotateCcw, AlertTriangle, Settings, ShieldCheck, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ConfigHistory {
  version: number;
  value: any;
  reason: string;
  createdAt: string | null;
  actorLabel: string | null;
}

interface Control {
  key: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  value: any;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  history: ConfigHistory[];
}

interface ConfigResponse {
  controls: Control[];
  serverEnforced: boolean;
}

export default function SettingsPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  
  const canManage = auth?.permissions.includes("configuration:manage") && auth?.admin.role === "owner";

  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [activeControl, setActiveControl] = useState<Control | null>(null);
  const [actionType, setActionType] = useState<"edit" | "rollback" | null>(null);
  
  // Form states
  const [editValue, setEditValue] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ConfigResponse>("/admin/configuration");
      setData(res);
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else setError(err instanceof Error ? err.message : "Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openAction = (control: Control, type: "edit" | "rollback") => {
    setActiveControl(control);
    setActionType(type);
    setEditValue(typeof control.value === "string" ? control.value : JSON.stringify(control.value));
    setRollbackVersion(null);
    setReason("");
    setConfirmation("");
  };

  const closeAction = () => {
    setActiveControl(null);
    setActionType(null);
    setSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeControl || !actionType) return;
    
    setSubmitting(true);
    try {
      if (actionType === "edit") {
        let parsedValue: any = editValue;
        if (typeof activeControl.value === "boolean") {
          parsedValue = editValue === "true";
        } else if (typeof activeControl.value === "number") {
          parsedValue = Number(editValue);
        }

        await apiPatch(`/admin/configuration/${activeControl.key}`, {
          value: parsedValue,
          reason,
          expectedVersion: activeControl.version,
          confirmed: true,
          confirmation
        });
        toast({ title: "Configuration updated", description: "Changes have been applied and logged." });
      } else if (actionType === "rollback" && rollbackVersion !== null) {
        await apiPost(`/admin/configuration/${activeControl.key}/rollback`, {
          targetVersion: rollbackVersion,
          reason,
          expectedVersion: activeControl.version,
          confirmed: true,
          confirmation: "ROLL BACK CONFIG"
        });
        toast({ title: "Configuration rolled back", description: "Previous version restored." });
      }
      closeAction();
      loadData();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const renderValue = (value: any) => {
    if (typeof value === "boolean") {
      return value ? (
        <span className="text-positive font-bold px-2 py-0.5 border border-positive/30 bg-positive/10 rounded-full text-xs">TRUE</span>
      ) : (
        <span className="text-muted-foreground font-bold px-2 py-0.5 border border-border bg-background rounded-full text-xs">FALSE</span>
      );
    }
    if (typeof value === "number") return <span className="font-mono text-primary font-bold">{value}</span>;
    if (typeof value === "string" && value === "") return <span className="text-muted-foreground italic text-xs">Empty</span>;
    return <span className="font-mono text-sm break-all">{String(value)}</span>;
  };

  const updatePhrase = activeControl ? `UPDATE ${activeControl.key.toUpperCase()}` : "";

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[0_0_15px_rgba(255,30,45,0.2)]">
            <Settings size={20} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold mb-1">Platform Settings</h1>
            <p className="text-sm text-muted-foreground">Owner controls for feature flags, maintenance, and app policy.</p>
          </div>
        </div>
        {data?.serverEnforced && (
           <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-positive/30 bg-positive/10 text-positive text-xs font-bold uppercase tracking-wider">
             <ShieldCheck size={14} /> Server Enforced
           </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {!canManage && !loading && (
        <div className="flex items-center gap-2.5 bg-background border border-border rounded-xl px-4 py-3 text-sm text-muted-foreground">
          <ShieldAlert size={16} className="text-amber-500" />
          You have read-only access. Only administrators with the owner role can modify settings.
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : !data || data.controls.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border border-border rounded-xl bg-card">No configuration controls available.</div>
        ) : (
          data.controls.map(control => {
            const hasHistory = control.history.some(h => h.version !== control.version);
            return (
              <div key={control.key} className="bg-card border border-border rounded-xl p-5 md:p-6 transition-colors">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-lg">{control.label}</h3>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${
                        control.risk === 'critical' ? 'bg-negative/10 border-negative/30 text-negative' :
                        control.risk === 'high' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' :
                        control.risk === 'medium' ? 'bg-primary/10 border-primary/30 text-primary' :
                        'bg-background border-border text-muted-foreground'
                      }`}>
                        {control.risk} RISK
                      </span>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mb-2">{control.key}</div>
                    <p className="text-sm text-foreground/80 max-w-2xl">{control.description}</p>
                  </div>
                  
                  <div className="flex flex-col items-start md:items-end shrink-0 bg-background border border-border rounded-lg p-3 min-w-[200px]">
                    <div className="text-[10px] font-bold text-muted-foreground tracking-wider mb-1">CURRENT VALUE</div>
                    <div className="mb-2">{renderValue(control.value)}</div>
                    <div className="text-[10px] text-muted-foreground text-right w-full pt-2 border-t border-border/50 mt-1">
                      v{control.version} · Updated by {control.updatedBy}
                    </div>
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
                    <button
                      onClick={() => openAction(control, "edit")}
                      className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-sm font-bold transition-colors"
                    >
                      Edit Value
                    </button>
                    {hasHistory && (
                      <button
                        onClick={() => openAction(control, "rollback")}
                        className="px-4 py-2 hover:bg-background text-muted-foreground hover:text-foreground border border-border rounded-lg text-sm font-bold transition-colors flex items-center gap-1.5"
                      >
                        <RotateCcw size={14} /> Rollback
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Action Dialog */}
      {activeControl && actionType && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70" onClick={closeAction} />
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="settings-dialog-title"
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 id="settings-dialog-title" className="font-display text-xl font-bold">
                {actionType === "edit" ? "Edit Setting" : "Rollback Setting"}
              </h2>
              <button onClick={closeAction} aria-label="Close dialog" className="text-muted-foreground hover:text-foreground p-1 rounded-md"><X size={18} /></button>
            </div>

            <div className="mb-6">
              <div className="font-bold text-lg">{activeControl.label}</div>
              <div className="font-mono text-xs text-muted-foreground mb-3">{activeControl.key}</div>
              {activeControl.risk !== "low" && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  This is a {activeControl.risk} risk operation. Cache and application state will be affected.
                </div>
              )}
              <div className="mt-3 flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  Recent authentication is required. If your owner session is no longer recent, this change will be rejected and you must sign in again before retrying.
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {actionType === "edit" && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-muted-foreground tracking-wider">
                    NEW VALUE
                    {typeof activeControl.value === "boolean" ? (
                      <select 
                        value={editValue} 
                        onChange={(e) => setEditValue(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary font-mono"
                      >
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                      </select>
                    ) : (
                      <input 
                        type={typeof activeControl.value === "number" ? "number" : "text"}
                        value={editValue} 
                        onChange={(e) => setEditValue(e.target.value)} 
                        className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary font-mono"
                        required
                      />
                    )}
                  </label>
                </div>
              )}

              {actionType === "rollback" && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-muted-foreground tracking-wider mb-2">SELECT PREVIOUS VERSION</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {activeControl.history.filter(h => h.version !== activeControl.version).map(h => (
                      <label key={h.version} className={`block border rounded-xl p-3 cursor-pointer transition-colors ${rollbackVersion === h.version ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-background'}`}>
                        <div className="flex items-start gap-3">
                          <input 
                            type="radio" 
                            name="rollbackVersion" 
                            value={h.version} 
                            checked={rollbackVersion === h.version}
                            onChange={() => setRollbackVersion(h.version)}
                            className="mt-1 shrink-0"
                            required
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-sm">v{h.version}</span>
                            <span className="text-xs text-muted-foreground">{h.createdAt ? new Date(h.createdAt).toLocaleDateString() : "Unknown date"}</span>
                            </div>
                            <div className="mb-2">{renderValue(h.value)}</div>
                            <div className="text-xs text-muted-foreground border-t border-border/50 pt-2 truncate">
                              "{h.reason}" — {h.actorLabel}
                            </div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="block text-xs font-bold text-muted-foreground tracking-wider">
                OPERATOR REASON
                <textarea 
                  value={reason} 
                  onChange={(e) => setReason(e.target.value)} 
                  rows={2} 
                  className="mt-1.5 w-full rounded-lg border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
                  placeholder="Explain why this change is necessary (min 10 chars)..."
                />
              </label>

              <label className="block text-xs font-bold text-muted-foreground tracking-wider">
                TYPE {actionType === "edit" ? updatePhrase : "ROLL BACK CONFIG"} TO EXECUTE
                <input 
                  type="text"
                  value={confirmation} 
                  onChange={(e) => setConfirmation(e.target.value)} 
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-3 font-mono text-sm text-foreground outline-none focus:border-primary"
                  required
                />
              </label>

              <div className="pt-2">
                <button 
                  type="submit" 
                  disabled={
                    submitting || 
                    reason.trim().length < 10 || 
                    (actionType === "edit" ? confirmation !== updatePhrase : confirmation !== "ROLL BACK CONFIG") ||
                    (actionType === "rollback" && rollbackVersion === null) ||
                    (actionType === "edit" && editValue === String(activeControl.value))
                  }
                  className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50 transition-opacity"
                >
                  {submitting ? "Processing..." : actionType === "edit" ? "Save Configuration" : "Execute Rollback"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
