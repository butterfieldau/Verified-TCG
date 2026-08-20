import { useState, useEffect } from "react";
import { Send, Edit, Plus, X, Calendar, Trash2, History } from "lucide-react";
import { apiFetch, apiPost, apiPatch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner, StatCard } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

interface Template {
  id: string;
  name: string;
  description: string;
  titleTemplate: string;
  bodyTemplate: string;
  defaultVariables: any;
  status: string;
}

interface Campaign {
  id: string;
  name: string;
  templateId: string;
  status: "draft" | "confirmed" | "scheduled" | "sending" | "completed" | "failed" | "cancelled" | "blocked";
  audienceFilter: { tier?: string };
  scheduledAt?: string;
  confirmedAt?: string;
  audienceCount: number;
  providerStatus: string;
  deliveryOutcome?: string;
}

interface Overview {
  providerStatus: "connected" | "not_connected" | "blocked" | "degraded";
  activeCampaigns: number;
  activeTemplates: number;
  publishedAnnouncements: number;
  activeInternalNotes: number;
  openSupportCases: number;
  pendingPrivacyRequests: number;
  activeRetentionPolicies: number;
  registeredPushTokens: number;
  audience: {
    total: number;
    free: number;
    pro: number;
  };
  pushTokenHealth: {
    active: number;
    stale: number;
    invalid: number;
    revoked: number;
    other: number;
    total: number;
    usersWithActiveToken: number;
    usersOptedIn: number;
  };
  deliveryMetrics: {
    totalAttempts: number;
    delivered: number;
    blocked: number;
    failed: number;
  };
  rateLimits: {
    test: { limit: number; windowSeconds: number };
    confirm: { limit: number; windowSeconds: number };
  };
  deliveryBlocked: boolean;
}

interface DeliveryAttempt {
  id: string;
  attemptType: "test" | "confirm" | "schedule";
  status: string;
  provider: string;
  recipientCount: number;
  errorMessage?: string | null;
  createdAt: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  adminEmail: string | null;
  resourceType: string | null;
  outcome: string;
  createdAt: string;
}

interface AttentionItem {
  type: string;
  count: number;
  message: string;
  severity: "info" | "warning" | "error";
}

export default function NotificationsPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canManage = auth?.permissions.includes("notifications:manage") ?? false;
  const canReadAudit = auth?.permissions.includes("audit:read") ?? false;
  const canReadDashboard = auth?.permissions.includes("dashboard:read") ?? false;
  const [activeTab, setActiveTab] = useState<"overview" | "campaigns" | "templates">("overview");
  
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  
  const [composerData, setComposerData] = useState<{
    id?: string;
    name: string;
    templateId: string;
    audienceFilter: { tier?: string };
    scheduledAt: string;
  }>({ name: "", templateId: "", audienceFilter: {}, scheduledAt: "" });
  
  const [previewData, setPreviewData] = useState<{ title: string; body: string; audienceCount: number } | null>(null);
  const [composerStep, setComposerStep] = useState<"setup" | "preview" | "confirm">("setup");
  const [processing, setProcessing] = useState(false);
  const [historyCampaign, setHistoryCampaign] = useState<Campaign | null>(null);
  const [deliveryAttempts, setDeliveryAttempts] = useState<DeliveryAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = () => {
    setLoading(true);
    setError(null);
    
    if (activeTab === "overview") {
      setAttention([]);
      setActivity([]);
      apiFetch<Overview>("/admin/governance/overview")
        .then(setOverview)
        .catch(handleErr)
        .finally(() => setLoading(false));
      if (canReadDashboard) {
        apiFetch<{ items: AttentionItem[] }>("/admin/governance/attention")
          .then((data) => setAttention(data.items || []))
          .catch((err) => {
            if (err instanceof UnauthorizedError) logout();
            else setError(err.message || "Failed to load attention items.");
          });
      }
      if (canReadAudit) {
        apiFetch<{ activity: ActivityEntry[] }>("/admin/governance/activity?limit=15")
          .then((data) => setActivity(data.activity || []))
          .catch((err) => {
            if (err instanceof UnauthorizedError) logout();
            else setError(err.message || "Failed to load governance activity.");
          });
      }
    } else if (activeTab === "campaigns") {
      apiFetch<{ campaigns: Campaign[] }>("/admin/governance/campaigns")
        .then(data => setCampaigns(data.campaigns || []))
        .catch(handleErr)
        .finally(() => setLoading(false));
      apiFetch<{ templates: Template[] }>("/admin/governance/templates")
        .then(data => setTemplates(data.templates || []))
        .catch(handleErr);
    } else if (activeTab === "templates") {
      apiFetch<{ templates: Template[] }>("/admin/governance/templates")
        .then(data => setTemplates(data.templates || []))
        .catch(handleErr)
        .finally(() => setLoading(false));
    }
  };

  const handleErr = (err: any) => {
    if (err instanceof UnauthorizedError) logout();
    else setError(err.message || "Failed to load data.");
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    setProcessing(true);
    try {
      if (editingTemplate.id) {
        await apiPatch(`/admin/governance/templates/${editingTemplate.id}`, editingTemplate);
        toast({ title: "Template updated" });
      } else {
        await apiPost("/admin/governance/templates", editingTemplate);
        toast({ title: "Template created" });
      }
      setEditingTemplate(null);
      loadData();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };
  
  const handleProceedToPreview = async () => {
    setProcessing(true);
    try {
      let draftId = composerData.id;
      if (draftId) {
        // Editing an existing draft: patch it rather than creating a duplicate.
        await apiPatch(`/admin/governance/campaigns/${draftId}`, {
          name: composerData.name,
          audienceFilter: composerData.audienceFilter,
        });
      } else {
        const res = await apiPost<{ campaign: Campaign }>("/admin/governance/campaigns", {
          name: composerData.name,
          templateId: composerData.templateId,
          audienceFilter: composerData.audienceFilter,
        });
        draftId = res.campaign.id;
        setComposerData({ ...composerData, id: draftId });
      }
      
      const previewRes = await apiPost<{ preview: { title: string, body: string }, estimatedAudience: number, deliveryBlocked?: boolean }>(`/admin/governance/campaigns/${draftId}/preview`, {});
      setPreviewData({
        title: previewRes.preview.title,
        body: previewRes.preview.body,
        audienceCount: previewRes.estimatedAudience
      });
      
      setComposerStep("preview");
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const startCampaignTest = async () => {
    if (!composerData.id) return;
    setProcessing(true);
    try {
      const res = await apiPost<{ outcome: string, message: string, providerStatus: string }>(`/admin/governance/campaigns/${composerData.id}/test`, {});
      // The API only reports a real send when the provider is connected AND the
      // outcome explicitly indicates delivery. Otherwise nothing was sent.
      if (res.outcome === "delivered" || res.outcome === "sent") {
        toast({ title: "Test delivered", description: res.message });
      } else {
        toast({ title: "Test not sent", description: res.message || "No push provider is connected; nothing was sent.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const cancelDraft = async (draftId?: string) => {
    const id = draftId ?? composerData.id;
    if (!id) {
      setComposerOpen(false);
      setComposerStep("setup");
      setComposerData({ name: "", templateId: "", audienceFilter: {}, scheduledAt: "" });
      return;
    }
    setProcessing(true);
    try {
      await apiPatch(`/admin/governance/campaigns/${id}`, { status: "cancelled" });
      toast({ title: "Draft cancelled" });
      setComposerOpen(false);
      setComposerStep("setup");
      setComposerData({ name: "", templateId: "", audienceFilter: {}, scheduledAt: "" });
      loadData();
    } catch (err: any) {
      toast({ title: "Could not cancel draft", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const submitCampaign = async () => {
    if (!composerData.id) return;
    setProcessing(true);
    try {
      // deliveryBlocked is authoritative: the confirm/schedule endpoints return
      // it explicitly. We only ever describe a campaign as delivered when the
      // API reports delivery — which it does not while no provider is connected.
      if (composerData.scheduledAt) {
        await apiPost(`/admin/governance/campaigns/${composerData.id}/confirm`, {});
        const res = await apiPost<{ message: string; providerStatus: string; deliveryBlocked?: boolean }>(
          `/admin/governance/campaigns/${composerData.id}/schedule`,
          { scheduledAt: new Date(composerData.scheduledAt).toISOString() },
        );
        if (res.deliveryBlocked) {
          toast({ title: "Scheduled — delivery blocked", description: res.message, variant: "destructive" });
        } else {
          toast({ title: "Campaign scheduled", description: res.message });
        }
      } else {
        const res = await apiPost<{ message: string; providerStatus: string; deliveryBlocked?: boolean }>(
          `/admin/governance/campaigns/${composerData.id}/confirm`,
          {},
        );
        if (res.deliveryBlocked) {
          toast({ title: "Confirmed — delivery blocked", description: res.message, variant: "destructive" });
        } else {
          toast({ title: "Campaign confirmed", description: res.message });
        }
      }
      setComposerOpen(false);
      setComposerStep("setup");
      setComposerData({ name: "", templateId: "", audienceFilter: {}, scheduledAt: "" });
      loadData();
    } catch (err: any) {
      toast({ title: "Campaign action failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const openDraftEditor = (c: Campaign) => {
    setComposerData({
      id: c.id,
      name: c.name,
      templateId: c.templateId || templates[0]?.id || "",
      audienceFilter: c.audienceFilter || {},
      scheduledAt: "",
    });
    setComposerStep("setup");
    setComposerOpen(true);
  };

  const openDeliveryHistory = async (campaign: Campaign) => {
    setHistoryCampaign(campaign);
    setDeliveryAttempts([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const data = await apiFetch<{ attempts: DeliveryAttempt[] }>(
        `/admin/governance/campaigns/${campaign.id}/delivery-attempts`,
      );
      setDeliveryAttempts(data.attempts || []);
    } catch (err: any) {
      if (err instanceof UnauthorizedError) logout();
      else setHistoryError(err.message || "Failed to load delivery history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Communications</h1>
          <p className="text-sm text-muted-foreground">Push notifications and engagement campaigns.</p>
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1 overflow-x-auto">
          {(["overview", "campaigns", "templates"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors capitalize whitespace-nowrap ${
                activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {activeTab === "overview" && (
        <div className="space-y-6">
          {loading ? (
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               {Array.from({length:4}).map((_,i) => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)}
             </div>
          ) : overview ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard 
                  label="PROVIDER STATUS" 
                  value={overview.providerStatus.replace("_", " ")} 
                  sub={overview.providerStatus === "connected" ? "Operational" : "Delivery offline"}
                  accent={overview.providerStatus !== "connected"}
                />
                <StatCard label="STORED TOKENS" value={overview.registeredPushTokens} sub={`${overview.pushTokenHealth.active.toLocaleString()} active`} />
                <StatCard label="ACTIVE CAMPAIGNS" value={overview.activeCampaigns} />
                <StatCard label="ACTIVE TEMPLATES" value={overview.activeTemplates} />
              </div>

              {overview.providerStatus !== "connected" && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-500">
                  <strong>No push provider connected.</strong> Campaigns can be composed, previewed, confirmed and scheduled, but no notifications will be delivered until a provider is configured.
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-bold text-sm mb-3">Audience segments</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                     Distinct, unsuspended collectors with explicit push consent and at least one active token.
                  </p>
                  <ul className="space-y-2 text-sm">
                     <li className="flex justify-between border-b border-border pb-2"><span className="text-muted-foreground">All eligible collectors</span><span className="font-semibold tabular-nums">{overview.audience.total.toLocaleString()}</span></li>
                     <li className="flex justify-between border-b border-border pb-2"><span className="text-muted-foreground">Free tier</span><span className="font-semibold tabular-nums">{overview.audience.free.toLocaleString()}</span></li>
                     <li className="flex justify-between"><span className="text-muted-foreground">Pro tier</span><span className="font-semibold tabular-nums">{overview.audience.pro.toLocaleString()}</span></li>
                  </ul>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                   <h3 className="font-bold text-sm mb-3">Push-token health</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between border-b border-border pb-2">
                       <span className="text-muted-foreground">Active</span>
                       <span className="font-semibold tabular-nums">{overview.pushTokenHealth.active.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2">
                       <span className="text-muted-foreground">Stale</span>
                       <span className="font-semibold tabular-nums">{overview.pushTokenHealth.stale.toLocaleString()}</span>
                    </div>
                     <div className="flex justify-between border-b border-border pb-2">
                       <span className="text-muted-foreground">Invalid or revoked</span>
                       <span className="font-semibold tabular-nums">{(overview.pushTokenHealth.invalid + overview.pushTokenHealth.revoked).toLocaleString()}</span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-muted-foreground">Explicitly opted in</span>
                       <span className="font-semibold tabular-nums">{overview.pushTokenHealth.usersOptedIn.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

               <div className="rounded-xl border border-border bg-card p-5">
                 <h3 className="font-bold text-sm mb-3">Delivery outcomes &amp; guardrails</h3>
                 <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                   <div><div className="text-xs text-muted-foreground">Recorded attempts</div><div className="font-semibold tabular-nums">{overview.deliveryMetrics.totalAttempts.toLocaleString()}</div></div>
                   <div><div className="text-xs text-muted-foreground">Delivered</div><div className="font-semibold tabular-nums">{overview.deliveryMetrics.delivered.toLocaleString()}</div></div>
                   <div><div className="text-xs text-muted-foreground">Provider-blocked</div><div className="font-semibold tabular-nums">{overview.deliveryMetrics.blocked.toLocaleString()}</div></div>
                   <div><div className="text-xs text-muted-foreground">Failed</div><div className="font-semibold tabular-nums">{overview.deliveryMetrics.failed.toLocaleString()}</div></div>
                 </div>
                 <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                   Staff limits: {overview.rateLimits.test.limit} test attempts per {overview.rateLimits.test.windowSeconds / 60} minute; {overview.rateLimits.confirm.limit} confirmations per {overview.rateLimits.confirm.windowSeconds / 3600} hour.
                 </div>
               </div>

              {canReadDashboard && attention.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-bold text-sm mb-3">Needs attention</h3>
                  <ul className="space-y-2">
                    {attention.map((item) => (
                      <li key={item.type} className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${
                          item.severity === "error" ? "bg-negative" :
                          item.severity === "warning" ? "bg-amber-500" : "bg-primary"
                        }`} />
                        <span className="text-muted-foreground">{item.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canReadAudit && activity.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-bold text-sm mb-3">Recent activity</h3>
                  <div className="divide-y divide-border">
                    {activity.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-mono text-xs truncate">{entry.action}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{entry.adminEmail || "system"}</div>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDate(entry.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {activeTab === "campaigns" && (
        <>
          <div className="mb-4 flex justify-between items-center">
            <h2 className="font-bold text-lg">Campaign History</h2>
            {canManage && (
              <button
                onClick={() => {
                  setComposerData({ name: "", templateId: templates[0]?.id || "", audienceFilter: {}, scheduledAt: "" });
                  setComposerStep("setup");
                  setComposerOpen(true);
                }}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> New Campaign
              </button>
            )}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <div>
              <div className="grid grid-cols-[2fr_1fr_1fr_100px_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
                <span>CAMPAIGN</span><span>SEGMENT</span><span>AUDIENCE SIZE</span><span>STATUS</span><span>ACTIONS</span>
              </div>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[2fr_1fr_1fr_100px_120px] gap-4 px-5 py-4 border-b border-border animate-pulse">
                    {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-full max-w-[100px]" />)}
                  </div>
                ))
              ) : campaigns.length === 0 ? (
                <div className="py-16 text-center">
                  <Send size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No campaigns found.</p>
                </div>
              ) : (
                campaigns.map((c) => (
                  <div key={c.id} className="grid grid-cols-[2fr_1fr_1fr_100px_120px] gap-4 px-5 py-3.5 border-b border-border items-center hover:bg-background transition-colors">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.scheduledAt ? `Scheduled: ${fmtDate(c.scheduledAt)}` : c.confirmedAt ? `Confirmed: ${fmtDate(c.confirmedAt)}` : "Draft"}</div>
                    </div>
                    <div>
                      <span className="inline-flex bg-background border border-border px-2 py-0.5 rounded-md text-xs capitalize">{c.audienceFilter?.tier ? `Tier: ${c.audienceFilter.tier}` : "All Users"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.audienceCount != null ? (
                        <div className="font-semibold text-foreground">{c.audienceCount.toLocaleString()} targeted</div>
                      ) : "-"}
                    </div>
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        c.status === "completed" ? "bg-positive/15 text-positive border border-positive/30" :
                        c.status === "blocked" || c.status === "cancelled" || c.status === "failed" ? "bg-negative/15 text-negative border border-negative/30" :
                        "bg-primary/15 text-primary border border-primary/30"
                      }`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                       <button onClick={() => openDeliveryHistory(c)} className="p-1.5 text-muted-foreground hover:text-primary bg-background border border-border rounded-md" title="View delivery history"><History size={14} /></button>
                      {canManage && c.status === "draft" ? (
                        <>
                          <button onClick={() => openDraftEditor(c)} className="p-1.5 text-muted-foreground hover:text-primary bg-background border border-border rounded-md" title="Edit draft"><Edit size={14} /></button>
                          <button
                            onClick={() => cancelDraft(c.id)}
                            className="p-1.5 text-muted-foreground hover:text-negative bg-background border border-border rounded-md"
                            title="Cancel draft"
                          ><Trash2 size={14} /></button>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

           <div className="space-y-3 md:hidden">
             {loading ? (
               Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl border border-border bg-card" />)
             ) : campaigns.length === 0 ? (
               <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">No campaigns found.</div>
             ) : (
               campaigns.map((campaign) => (
                 <div key={campaign.id} className="rounded-xl border border-border bg-card p-4">
                   <div className="flex items-start justify-between gap-3">
                     <div className="min-w-0">
                       <div className="truncate text-sm font-bold">{campaign.name}</div>
                       <div className="mt-1 text-xs text-muted-foreground">{campaign.audienceFilter?.tier ? `${campaign.audienceFilter.tier} tier` : "All opted-in collectors"}</div>
                     </div>
                     <span className="rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{campaign.status.replace("_", " ")}</span>
                   </div>
                   <div className="mt-3 text-xs text-muted-foreground">{campaign.audienceCount != null ? `${campaign.audienceCount.toLocaleString()} targeted` : "Audience counted at confirmation"}</div>
                   <div className="mt-4 flex items-center gap-2">
                     <button onClick={() => openDeliveryHistory(campaign)} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold"><History size={13} /> History</button>
                     {canManage && campaign.status === "draft" && (
                       <>
                         <button onClick={() => openDraftEditor(campaign)} className="rounded-md border border-border bg-background p-1.5 text-muted-foreground" title="Edit draft"><Edit size={14} /></button>
                         <button onClick={() => cancelDraft(campaign.id)} className="rounded-md border border-border bg-background p-1.5 text-muted-foreground" title="Cancel draft"><Trash2 size={14} /></button>
                       </>
                     )}
                   </div>
                 </div>
               ))
             )}
           </div>
        </>
      )}

      {activeTab === "templates" && (
        <>
          <div className="mb-4 flex justify-between items-center">
            <h2 className="font-bold text-lg">Message Templates</h2>
            {canManage && (
              <button
                onClick={() => setEditingTemplate({ id: "", name: "", description: "", titleTemplate: "", bodyTemplate: "", defaultVariables: {}, status: "active" })}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> New Template
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
               Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 bg-card border border-border rounded-xl animate-pulse" />)
            ) : templates.map(t => (
              <div key={t.id} className="bg-card border border-border rounded-xl p-5 flex flex-col">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-sm truncate pr-2">{t.name}</h3>
                  {canManage && (
                    <button onClick={() => setEditingTemplate({...t})} className="text-muted-foreground hover:text-primary"><Edit size={14} /></button>
                  )}
                </div>
                <div className="text-sm font-semibold mb-1 truncate">{t.titleTemplate}</div>
                <div className="text-xs text-muted-foreground line-clamp-3 mb-4 flex-1">{t.bodyTemplate}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* COMPOSER OVERLAY */}
      {composerOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => !processing && setComposerOpen(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl bg-background border border-border rounded-2xl shadow-2xl z-50 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">CAMPAIGN COMPOSER</span>
              <button onClick={() => !processing && setComposerOpen(false)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center gap-2 mb-8">
                {(["setup", "preview", "confirm"] as const).map((step, i) => (
                  <div key={step} className="flex items-center gap-2 flex-1">
                    <div className={`h-1 flex-1 rounded-full ${
                      (composerStep === "setup" && i === 0) || 
                      (composerStep === "preview" && i <= 1) || 
                      (composerStep === "confirm" && i <= 2) 
                        ? "bg-primary" : "bg-border"
                    }`} />
                  </div>
                ))}
              </div>

              {composerStep === "setup" && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">CAMPAIGN NAME</label>
                    <input
                      type="text"
                      value={composerData.name}
                      onChange={e => setComposerData({...composerData, name: e.target.value})}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                      placeholder="Internal name e.g., Spring Promo"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">TEMPLATE</label>
                    <select
                      value={composerData.templateId}
                      onChange={e => setComposerData({...composerData, templateId: e.target.value})}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Select a template...</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">TARGET SEGMENT</label>
                    <select
                      value={composerData.audienceFilter?.tier || ""}
                      onChange={e => setComposerData({...composerData, audienceFilter: e.target.value ? { tier: e.target.value } : {}})}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">All Opted-in Users</option>
                      <option value="free">Free Tier Only</option>
                      <option value="pro">Pro Tier Only</option>
                    </select>
                  </div>
                </div>
              )}

              {composerStep === "preview" && previewData && (
                <div className="space-y-6">
                  <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 text-sm flex flex-col gap-2">
                    <div>
                      <strong>Audience size:</strong> {previewData.audienceCount.toLocaleString()} users
                    </div>
                    <div className="text-xs text-muted-foreground">
                      * This number reflects users who match the audience filter and have active, opted-in push tokens.
                    </div>
                  </div>
                  
                  <div className="mx-auto w-[320px] bg-black border-[6px] border-zinc-800 rounded-[2.5rem] p-4 relative h-[240px] overflow-hidden">
                    <div className="absolute top-0 inset-x-0 h-6 bg-black z-10 flex justify-center"><div className="w-24 h-4 bg-zinc-800 rounded-b-xl" /></div>
                    
                    <div className="mt-8 bg-zinc-900/90 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-white/10">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 bg-primary rounded shadow-[0_0_10px_rgba(255,30,45,0.5)]" />
                        <span className="text-white text-xs font-bold">Verified TCG</span>
                        <span className="text-white/50 text-xs ml-auto">now</span>
                      </div>
                      <div className="text-white font-bold text-sm">
                        {previewData.title}
                      </div>
                      <div className="text-white/80 text-sm mt-1 line-clamp-2">
                        {previewData.body}
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <button
                      onClick={startCampaignTest}
                      disabled={processing}
                      className="px-4 py-2 border border-border rounded-lg text-sm font-bold hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {processing ? "Attempting..." : "Attempt Test Delivery"}
                    </button>
                    <p className="mt-2 text-[10px] text-muted-foreground">No provider is connected, so a test will not be delivered.</p>
                  </div>
                </div>
              )}

              {composerStep === "confirm" && (
                <div className="space-y-5">
                  <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="font-bold mb-4">Confirm Campaign Details</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between border-b border-border pb-2">
                        <span className="text-muted-foreground">Name:</span>
                        <span className="font-bold">{composerData.name}</span>
                      </div>
                      <div className="flex justify-between border-b border-border pb-2">
                        <span className="text-muted-foreground">Segment:</span>
                        <span className="font-bold capitalize">{composerData.audienceFilter?.tier ? `Tier: ${composerData.audienceFilter.tier}` : "All Users"}</span>
                      </div>
                      <div className="flex justify-between border-b border-border pb-2">
                        <span className="text-muted-foreground">Rate limit policy:</span>
                        <span className="font-bold">5 tests/min · 10 confirmations/hour</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">SCHEDULE (OPTIONAL)</label>
                    <input
                      type="datetime-local"
                      value={composerData.scheduledAt}
                      onChange={e => setComposerData({...composerData, scheduledAt: e.target.value})}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Leave blank to confirm without scheduling. Delivery remains blocked while no provider is connected.</p>
                  </div>
                  
                  <div className="bg-negative/10 border border-negative/30 rounded-xl p-4 text-sm text-negative">
                    <strong>Delivery blocked:</strong> No outbound push provider is connected. Confirming {composerData.scheduledAt ? "and scheduling " : ""}this campaign records it as delivery-blocked. No notifications will be sent to any collector.
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-border flex justify-between shrink-0 bg-card rounded-b-2xl">
              {composerStep === "setup" ? (
                <button type="button" onClick={() => cancelDraft()} disabled={processing} className="px-4 py-2 border border-border rounded-lg text-sm font-bold disabled:opacity-50">
                  {composerData.id ? "Cancel draft" : "Cancel"}
                </button>
              ) : (
                <button type="button" onClick={() => setComposerStep(composerStep === "preview" ? "setup" : "preview")} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Back</button>
              )}
              
              {composerStep === "setup" ? (
                <button 
                  onClick={handleProceedToPreview} 
                  disabled={processing || !composerData.name || !composerData.templateId}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  {processing ? "Saving Draft..." : "Continue to Preview"}
                </button>
              ) : composerStep === "preview" ? (
                <button onClick={() => setComposerStep("confirm")} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold">Review</button>
              ) : (
                <button 
                  onClick={submitCampaign}
                  disabled={processing}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {composerData.scheduledAt ? <Calendar size={16} /> : <Send size={16} />}
                  {processing ? "Processing..." : composerData.scheduledAt ? "Schedule Campaign" : "Confirm Campaign"}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {historyCampaign && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setHistoryCampaign(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Delivery history</div>
                <div className="mt-1 text-sm font-semibold">{historyCampaign.name}</div>
              </div>
              <button onClick={() => setHistoryCampaign(null)} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-5">
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
                These are recorded attempts and outcomes. A provider-blocked row means nothing was delivered.
              </div>
              {historyLoading ? (
                <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-card" />)}</div>
              ) : historyError ? (
                <ErrorBanner message={historyError} />
              ) : deliveryAttempts.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No delivery attempts have been recorded.</div>
              ) : (
                <div className="space-y-3">
                  {deliveryAttempts.map((attempt) => (
                    <div key={attempt.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold capitalize">{attempt.attemptType} attempt</div>
                          <div className="mt-1 text-xs text-muted-foreground">{attempt.recipientCount.toLocaleString()} recipient{attempt.recipientCount === 1 ? "" : "s"} · provider: {attempt.provider}</div>
                        </div>
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-500">{attempt.status.replace("_", " ")}</span>
                      </div>
                      {attempt.errorMessage && <p className="mt-3 text-xs text-muted-foreground">{attempt.errorMessage}</p>}
                      <div className="mt-3 text-[10px] text-muted-foreground">{fmtDate(attempt.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* TEMPLATE EDITOR */}
      {editingTemplate && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => !processing && setEditingTemplate(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col">
            <h2 className="text-lg font-bold mb-4">{editingTemplate.id ? "Edit Template" : "New Template"}</h2>
            <form onSubmit={handleSaveTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">TEMPLATE NAME</label>
                <input
                  type="text"
                  value={editingTemplate.name}
                  onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})}
                  className="w-full bg-card border border-border rounded-lg p-2.5 text-sm outline-none focus:border-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">NOTIFICATION SUBJECT</label>
                <input
                  type="text"
                  value={editingTemplate.titleTemplate}
                  onChange={e => setEditingTemplate({...editingTemplate, titleTemplate: e.target.value})}
                  className="w-full bg-card border border-border rounded-lg p-2.5 text-sm outline-none focus:border-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">BODY TEMPLATE</label>
                <textarea
                  value={editingTemplate.bodyTemplate}
                  onChange={e => setEditingTemplate({...editingTemplate, bodyTemplate: e.target.value})}
                  className="w-full bg-card border border-border rounded-lg p-2.5 text-sm min-h-[120px] outline-none focus:border-primary resize-y"
                  required
                />
              </div>
              <div className="mt-6 pt-4 border-t border-border flex justify-end gap-3">
                <button type="button" onClick={() => setEditingTemplate(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Cancel</button>
                <button type="submit" disabled={processing} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50">Save Template</button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}