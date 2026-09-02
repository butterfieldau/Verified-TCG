import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { apiFetch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { StatCard, SkeletonCard, ErrorBanner } from "@/components/admin-ui";
import { Activity, AlertTriangle, CheckCircle2, RotateCcw, XCircle, RefreshCw, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { canReadPricingJobs, isLatestPanelRequest } from "@/lib/polling";

interface HealthData {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  process: { startedAt: string; uptimeSeconds: number; label: string };
  database: { status: string; latencyMs: number | null };
  api: {
    status: string;
    requests24h: number | null;
    errors24h: number | null;
    errorRate: number | null;
    recentErrors: { path: string; statusCode: number | null; recordedAt: string }[];
  };
  providers: any[];
  jobs: {
    queued: number | null;
    running: number | null;
    failed: number | null;
    cancelled: number | null;
    recovery: RecoveryAction[];
  };
  queue: { status: string; depth: number | null };
  recoveryActions: RecoveryAction[];
}

interface RecoveryAction {
  label: string;
  description?: string;
  evidence?: string;
  observedAt?: string;
}

interface Integration {
  key: string;
  label: string;
  purpose: string;
  configured: boolean;
  status: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  recentErrors: string[];
  usage: { events7d: number } | null;
  observabilityNote: string;
}

interface Job {
  id: string;
  cardId?: string;
  providerKey: string;
  status: string;
  attemptCount: number;
  errorMessage: string | null;
  reason: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface PanelState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastSuccessAt: string | null;
}

function panelState<T>(): PanelState<T> {
  return { data: null, loading: true, error: null, lastSuccessAt: null };
}

function PanelNotice({
  title,
  error,
  loading,
  onRetry,
}: {
  title: string;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 text-sm">
      <div>
        <div className="font-bold">{loading ? "Loading…" : title}</div>
        {!loading && error && <div className="mt-1 text-muted-foreground">{error}</div>}
      </div>
      {!loading && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default function SystemPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canReadJobs = canReadPricingJobs(auth?.permissions);
  const canManagePricing = auth?.permissions.includes("pricing:manage") || false;
  const initialJobId = new URLSearchParams(window.location.search).get("job") || "";

  const [healthPanel, setHealthPanel] = useState<PanelState<HealthData>>(panelState);
  const [integrationsPanel, setIntegrationsPanel] = useState<PanelState<Integration[]>>(panelState);
  const [jobsPanel, setJobsPanel] = useState<PanelState<{ jobs: Job[]; total: number; page: number; limit: number }>>(panelState);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [jobPage, setJobPage] = useState(1);
  const requestIds = useRef({ health: 0, integrations: 0, jobs: 0 });

  // Dialog state
  const [actionJob, setActionJob] = useState<{ job: Job; action: "retry" | "cancel" } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadHealth = useCallback(async () => {
    const requestId = ++requestIds.current.health;
    setHealthPanel((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch<HealthData>("/admin/intelligence/health");
      if (isLatestPanelRequest(requestId, requestIds.current.health)) {
        setHealthPanel({ data, loading: false, error: null, lastSuccessAt: new Date().toISOString() });
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else if (isLatestPanelRequest(requestId, requestIds.current.health)) {
        setHealthPanel((current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Health data unavailable." }));
      }
    }
  }, [logout]);

  const loadIntegrations = useCallback(async () => {
    const requestId = ++requestIds.current.integrations;
    setIntegrationsPanel((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch<{ integrations: Integration[] }>("/admin/intelligence/integrations");
      if (isLatestPanelRequest(requestId, requestIds.current.integrations)) {
        setIntegrationsPanel({ data: data.integrations, loading: false, error: null, lastSuccessAt: new Date().toISOString() });
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else if (isLatestPanelRequest(requestId, requestIds.current.integrations)) {
        setIntegrationsPanel((current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Integration data unavailable." }));
      }
    }
  }, [logout]);

  const loadJobs = useCallback(async () => {
    if (!canReadJobs) return;
    const requestId = ++requestIds.current.jobs;
    setJobsPanel((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch<{ jobs: Job[]; total: number; page: number; limit: number }>(
        `/admin/intelligence/jobs?page=${jobPage}&limit=50&status=${encodeURIComponent(jobStatus)}&jobId=${encodeURIComponent(initialJobId)}`
      );
      if (isLatestPanelRequest(requestId, requestIds.current.jobs)) {
        setJobsPanel({ data, loading: false, error: null, lastSuccessAt: new Date().toISOString() });
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else if (isLatestPanelRequest(requestId, requestIds.current.jobs)) {
        setJobsPanel((current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Job data unavailable." }));
      }
    }
  }, [canReadJobs, logout, jobPage, jobStatus, initialJobId]);

  useEffect(() => {
    void loadHealth();
    void loadIntegrations();
    if (canReadJobs) void loadJobs();
    const interval = setInterval(() => {
      void loadHealth();
      void loadIntegrations();
      if (canReadJobs) void loadJobs();
    }, 15_000);
    return () => clearInterval(interval);
  }, [canReadJobs, loadHealth, loadIntegrations, loadJobs]);

  useEffect(() => {
    if (!actionJob) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setActionJob(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionJob, submitting]);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionJob) return;
    
    setSubmitting(true);
    try {
      const endpoint = `/admin/intelligence/jobs/${actionJob.job.id}/${actionJob.action}`;
      await apiPost(endpoint, {
        reason,
        confirmed: true,
        confirmation
      });
      
      toast({ title: `Job ${actionJob.action}ed successfully` });
      setActionJob(null);
      setReason("");
      setConfirmation("");
       void loadJobs();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const health = healthPanel.data;
  const integrations = integrationsPanel.data ?? [];
  const jobs = jobsPanel.data ?? { jobs: [], total: 0, page: jobPage, limit: 50 };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold mb-1">System Health & Operations</h1>
        <p className="text-sm text-muted-foreground">Real-time health, integrations, and background job queues.</p>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Platform Health</h2>
          {healthPanel.lastSuccessAt && (
            <span className="text-[11px] text-muted-foreground">
              Last successful refresh {new Date(healthPanel.lastSuccessAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        {healthPanel.error && health && (
          <ErrorBanner message={`Health refresh failed. Showing stale data from ${new Date(healthPanel.lastSuccessAt!).toLocaleTimeString()}. ${healthPanel.error}`} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {healthPanel.loading && !health ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : health ? (
            <>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-xs font-bold text-muted-foreground tracking-wider mb-2">STATUS</div>
                <div className="flex items-center gap-2">
                  {health.status === "healthy" ? <CheckCircle2 className="text-positive" /> : <AlertTriangle className="text-negative" />}
                  <span className={`font-display text-2xl font-bold capitalize ${health.status === "healthy" ? "text-positive" : "text-negative"}`}>
                    {health.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-2">Checked {new Date(health.checkedAt).toLocaleTimeString()}</div>
              </div>
              <StatCard label="UPTIME" value={formatUptime(health.process.uptimeSeconds)} sub={health.process.label} />
              <StatCard
                label="DB LATENCY"
                value={health.database.latencyMs === null ? "Unavailable" : `${health.database.latencyMs}ms`}
                sub={`Status: ${health.database.status}`}
                accent={health.database.status !== "healthy"}
              />
              <StatCard
                label="API ERROR RATE"
                value={health.api.status === "unobserved" ? "Unobserved" : health.api.errorRate === null ? "Unavailable" : `${(health.api.errorRate * 100).toFixed(2)}%`}
                sub={health.api.status === "unobserved" ? "No retained API requests in 24h" : health.api.errors24h === null ? "Telemetry query unavailable" : `${health.api.errors24h} server errors / ${health.api.requests24h} observed requests`}
                accent={health.api.status !== "healthy"}
              />
              <StatCard
                label="QUEUE DEPTH"
                value={health.queue.depth === null ? "Unavailable" : health.queue.depth}
                sub={`Status: ${health.queue.status}`}
                accent={health.queue.status !== "healthy"}
              />
            </>
          ) : (
            <div className="col-span-full">
              <PanelNotice title="Platform health is unavailable" error={healthPanel.error} loading={false} onRetry={() => void loadHealth()} />
            </div>
          )}
        </div>
      </section>

      {health?.recoveryActions && health.recoveryActions.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 uppercase">Recovery Actions Needed</h2>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col gap-3">
            {health.recoveryActions.map((action, i) => (
              <div key={i} className="flex gap-3 text-amber-500 text-sm">
                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                <div>
                  <div className="font-bold">{action.label || "Action required"}</div>
                  {action.description && <div>{action.description}</div>}
                  {action.evidence && <div className="mt-1 font-mono text-xs opacity-80">{action.evidence}</div>}
                  {action.observedAt && <div className="mt-1 text-[11px] opacity-70">Observed {new Date(action.observedAt).toLocaleString()}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {health?.api?.recentErrors && health.api.recentErrors.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 uppercase">Recent API Errors</h2>
          <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Path</th>
                  <th className="pb-2 pr-4 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {health.api.recentErrors.map((err, i) => (
                  <tr key={i}>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{new Date(err.recordedAt).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{err.path}</td>
                    <td className="py-2.5 pr-4 text-negative">{err.statusCode ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Integrations</h2>
          {integrationsPanel.lastSuccessAt && (
            <span className="text-[11px] text-muted-foreground">
              Last successful refresh {new Date(integrationsPanel.lastSuccessAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        {integrationsPanel.error && integrationsPanel.data && (
          <ErrorBanner message={`Integration refresh failed. Showing stale data from ${new Date(integrationsPanel.lastSuccessAt!).toLocaleTimeString()}. ${integrationsPanel.error}`} />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {integrationsPanel.loading && !integrationsPanel.data ? (
             Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : !integrationsPanel.data ? (
             <div className="col-span-full">
               <PanelNotice title="Integration data is unavailable" error={integrationsPanel.error} loading={false} onRetry={() => void loadIntegrations()} />
             </div>
          ) : integrations.length === 0 ? (
             <div className="col-span-full p-8 text-center bg-card border border-border rounded-xl text-sm text-muted-foreground">No integrations configured.</div>
          ) : integrations.map((int) => (
            <div key={int.key} className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-sm">{int.label}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    int.status === "healthy" ? "bg-positive/10 border-positive/30 text-positive" : 
                    int.status === "degraded" ? "bg-negative/10 border-negative/30 text-negative" :
                    int.status === "missing" ? "bg-amber-500/10 border-amber-500/30 text-amber-500" :
                    "bg-background border-border text-muted-foreground"
                  }`}>
                    {int.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{int.purpose}</p>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Configured:</span>
                    <span>{int.configured ? "Yes" : "No"}</span>
                  </div>
                  {int.lastSuccessAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Success:</span>
                      <span>{new Date(int.lastSuccessAt).toLocaleString()}</span>
                    </div>
                  )}
                  {int.lastFailureAt && (
                    <div className="flex justify-between text-negative">
                      <span>Last Failure:</span>
                      <span>{new Date(int.lastFailureAt).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Observed calls (7d):</span>
                    <span>{int.usage?.events7d ?? "Unobserved"}</span>
                  </div>
                </div>
              </div>
              {int.recentErrors.length > 0 && (
                <div className="mt-3 rounded-lg border border-negative/20 bg-negative/5 p-2 text-[11px] text-negative">
                  Recent errors: {int.recentErrors.join(", ")}
                </div>
              )}
              {int.observabilityNote && (
                <div className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground/80">
                  {int.observabilityNote}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {canReadJobs && <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
          <div>
            <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">Background Jobs</h2>
            {jobsPanel.lastSuccessAt && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Last successful refresh {new Date(jobsPanel.lastSuccessAt).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {canManagePricing && (
              <Link href="/pricing" className="px-3 py-1.5 text-xs font-bold text-primary border border-primary/20 bg-primary/10 rounded-lg">
                Queue refresh
              </Link>
            )}
            <select
              value={jobStatus}
              onChange={(e) => { setJobStatus(e.target.value); setJobPage(1); }}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary transition-colors"
            >
              <option value="">All Statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button 
              onClick={() => void loadJobs()}
              className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded-lg bg-card"
              title="Refresh background jobs"
              aria-label="Refresh background jobs"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {jobsPanel.error && jobsPanel.data && (
          <ErrorBanner message={`Job refresh failed. Showing stale data from ${new Date(jobsPanel.lastSuccessAt!).toLocaleTimeString()}. ${jobsPanel.error}`} />
        )}
        {!jobsPanel.data && !jobsPanel.loading && (
          <PanelNotice
            title="Background jobs are unavailable"
            error={jobsPanel.error}
            loading={false}
            onRetry={() => void loadJobs()}
          />
        )}

        {(jobsPanel.data || jobsPanel.loading) && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="p-4 font-bold">ID / Provider</th>
                  <th className="p-4 font-bold">Status</th>
                  <th className="p-4 font-bold">Reason</th>
                  <th className="p-4 font-bold">Created</th>
                  <th className="p-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobsPanel.loading && jobs.jobs.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground animate-pulse">Loading jobs...</td></tr>
                ) : jobs.jobs.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No jobs found.</td></tr>
                ) : (
                  jobs.jobs.map(job => (
                    <tr key={job.id} className={job.id === initialJobId ? "bg-primary/5 outline outline-1 outline-primary/30" : "hover:bg-background/50"}>
                      <td className="p-4">
                        <div className="font-mono text-xs truncate max-w-[150px]">{job.id}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{job.providerKey}</div>
                      </td>
                      <td className="p-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          job.status === 'succeeded' ? 'bg-positive/10 border-positive/30 text-positive' :
                          job.status === 'failed' ? 'bg-negative/10 border-negative/30 text-negative' :
                          job.status === 'running' ? 'bg-primary/10 border-primary/30 text-primary' :
                          job.status === 'cancelled' ? 'bg-muted border-border text-muted-foreground' :
                          'bg-amber-500/10 border-amber-500/30 text-amber-500'
                        }`}>
                          {job.status.toUpperCase()}
                        </span>
                        {job.attemptCount > 1 && <div className="text-[10px] text-muted-foreground mt-1">Attempts: {job.attemptCount}</div>}
                      </td>
                      <td className="p-4">
                        <div className="truncate max-w-xs">{job.reason}</div>
                        {job.errorMessage && <div className="text-[10px] text-negative truncate max-w-xs mt-0.5">{job.errorMessage}</div>}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          {['failed', 'cancelled'].includes(job.status) && canManagePricing && (
                            <button
                              onClick={() => setActionJob({ job, action: 'retry' })}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-md transition-colors"
                              title="Retry Job"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {job.status === 'queued' && canManagePricing && (
                            <button
                              onClick={() => setActionJob({ job, action: 'cancel' })}
                              className="p-1.5 text-negative hover:bg-negative/10 rounded-md transition-colors"
                              title="Cancel Job"
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-border">
            {jobsPanel.loading && jobs.jobs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">Loading jobs...</div>
            ) : jobs.jobs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No jobs found.</div>
            ) : (
              jobs.jobs.map(job => (
                <div key={job.id} className={`p-4 space-y-3 ${job.id === initialJobId ? "bg-primary/5" : ""}`}>
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 pr-2">
                      <div className="font-mono text-xs truncate text-foreground">{job.id}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{job.providerKey}</div>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      job.status === 'succeeded' ? 'bg-positive/10 border-positive/30 text-positive' :
                      job.status === 'failed' ? 'bg-negative/10 border-negative/30 text-negative' :
                      job.status === 'running' ? 'bg-primary/10 border-primary/30 text-primary' :
                      job.status === 'cancelled' ? 'bg-muted border-border text-muted-foreground' :
                      'bg-amber-500/10 border-amber-500/30 text-amber-500'
                    }`}>
                      {job.status.toUpperCase()}
                    </span>
                  </div>
                  
                  <div>
                    <div className="text-sm">{job.reason}</div>
                    {job.errorMessage && <div className="text-xs text-negative mt-0.5">{job.errorMessage}</div>}
                  </div>

                  <div className="flex justify-between items-end pt-2">
                    <div className="text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                      {job.attemptCount > 1 && <span className="block mt-0.5">Attempts: {job.attemptCount}</span>}
                    </div>
                    <div className="flex gap-2">
                      {['failed', 'cancelled'].includes(job.status) && canManagePricing && (
                        <button
                          onClick={() => setActionJob({ job, action: 'retry' })}
                          className="px-3 py-1.5 text-xs font-medium text-foreground bg-background border border-border rounded-md"
                        >
                          Retry
                        </button>
                      )}
                      {job.status === 'queued' && canManagePricing && (
                        <button
                          onClick={() => setActionJob({ job, action: 'cancel' })}
                          className="px-3 py-1.5 text-xs font-medium text-negative bg-negative/10 border border-negative/20 rounded-md"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {jobs.total > jobs.limit && (
            <div className="p-4 border-t border-border flex justify-between items-center bg-background/30 text-sm">
              <span className="text-muted-foreground">Showing {(jobs.page - 1) * jobs.limit + 1} to {Math.min(jobs.page * jobs.limit, jobs.total)} of {jobs.total}</span>
              <div className="flex gap-2">
                <button 
                  disabled={jobs.page === 1}
                  onClick={() => setJobPage(p => p - 1)}
                  className="px-3 py-1 border border-border rounded-lg disabled:opacity-50"
                >
                  Prev
                </button>
                <button 
                  disabled={jobs.page * jobs.limit >= jobs.total}
                  onClick={() => setJobPage(p => p + 1)}
                  className="px-3 py-1 border border-border rounded-lg disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </section>}

      {/* Action Dialog */}
      {actionJob && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/70"
            onClick={() => setActionJob(null)}
            aria-label="Close job action"
          />
          <div role="dialog" aria-modal="true" aria-labelledby="job-action-title" className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 id="job-action-title" className="font-display text-xl font-bold capitalize">{actionJob.action} Job</h2>
              <button aria-label="Close job action" onClick={() => setActionJob(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            
            <div className="mb-4 text-sm text-muted-foreground">
              You are about to {actionJob.action} job <span className="font-mono text-foreground">{actionJob.job.id}</span>.
            </div>

            <form onSubmit={handleAction} className="space-y-4">
              <label className="block text-xs font-bold text-muted-foreground">
                OPERATOR REASON
                <textarea 
                  value={reason} 
                  onChange={(e) => setReason(e.target.value)} 
                  rows={3} 
                  className="mt-1.5 w-full rounded-lg border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
                  placeholder="Explain why this action is necessary"
                  autoFocus
                  required
                />
              </label>

              <label className="block text-xs font-bold text-muted-foreground">
                TYPE {actionJob.action === "retry" ? "RETRY JOB" : "CANCEL JOB"} TO CONFIRM
                <input 
                  type="text"
                  value={confirmation} 
                  onChange={(e) => setConfirmation(e.target.value)} 
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                  required
                />
              </label>

              <button 
                type="submit" 
                disabled={submitting || reason.trim().length < 10 || confirmation !== (actionJob.action === "retry" ? "RETRY JOB" : "CANCEL JOB")}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Processing..." : `Confirm ${actionJob.action}`}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
