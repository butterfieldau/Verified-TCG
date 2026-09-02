import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PlugZap,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { apiFetch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";
import { ErrorBanner, SkeletonCard, StatCard } from "@/components/admin-ui";

interface Provider {
  key: string;
  label: string;
  purpose: string;
  configured: boolean;
  status: string;
  lastHealthyAt?: string | null;
  lastErrorAt?: string | null;
  failureCategory?: string | null;
  staleQuoteCards?: number;
  lastResult?: string | null;
}

interface Coverage {
  generatedAt: string;
  totals: CoverageGame;
  byGame: CoverageGame[];
  imports: {
    category: string;
    status: string;
    reconciliationStatus: string;
    rowCount: number;
    ageHours: number;
    lastErrorKind: string | null;
    reconciliationCursor: string | null;
    stats: Record<string, unknown>;
  }[];
  failureReasons: { reason: string; count: number }[];
  latestSchedulerRun: {
    status: string;
    selectedCards: number;
    refreshSucceeded: number;
    refreshFailed: number;
    startedAt: string;
  } | null;
}

interface CoverageGame {
  game: string;
  supportedCards: number;
  matchedCards: number;
  rawQuoteCards: number;
  gradedOnlyCards: number;
  ambiguousCards: number;
  unmatchedCards: number;
  unprocessedCards: number;
  staleQuoteCards: number;
}

interface Overview {
  mappings: { total: number; matched: number; reviewRequired: number; unmatched: number };
  quotes: {
    pricedCards: number;
    staleCards: number;
    latestQuoteAt: string | null;
    staleAfterHours: number;
  };
  refreshWork: { queued: number; running: number; failed: number };
  activeOverrides: number;
  anomalies: {
    cardId: string;
    gradeKey: string;
    currentPriceCents: number;
    previousPriceCents: number;
    currency: string;
    changePercent: number;
  }[];
}

interface Mapping {
  id: string;
  cardId: string;
  providerKey: string;
  providerProductId: string | null;
  providerProductName: string | null;
  status: string;
  confidenceScore: number | null;
  confidenceLevel: string | null;
  matchedName: string | null;
  matchedSet: string | null;
  matchedNumber: string | null;
  updatedAt: string;
}

interface RefreshJob {
  id: string;
  cardId: string;
  status: string;
  reason: string;
  errorMessage: string | null;
  createdAt: string;
}

type ActionKind = "mapping" | "refresh" | "override";

export default function PricingOperationsPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canManage = auth?.permissions.includes("pricing:manage") ?? false;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [jobs, setJobs] = useState<RefreshJob[]>([]);
  const initialParams = new URLSearchParams(window.location.search);
  const initialMappingId = initialParams.get("mappingId");
  const [query, setQuery] = useState(initialParams.get("q") || "");
  const [status, setStatus] = useState(initialParams.get("status") || "review_required");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [selected, setSelected] = useState<Mapping | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [outcome, setOutcome] = useState<"approve" | "reject">("approve");
  const [dryRunComplete, setDryRunComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [overrideCardId, setOverrideCardId] = useState("");
  const [overrideGrade, setOverrideGrade] = useState("raw");
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideCurrency, setOverrideCurrency] = useState("USD");
  const [overrideExpiry, setOverrideExpiry] = useState("");
  const [overridePreview, setOverridePreview] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      const [providerData, overviewData, coverageData, mappingData, jobData] = await Promise.all([
        apiFetch<{ providers: Provider[] }>("/admin/pricing/providers"),
        apiFetch<Overview>("/admin/pricing/overview"),
        apiFetch<Coverage>("/admin/pricing/coverage"),
        apiFetch<{ mappings: Mapping[] }>(`/admin/pricing/mappings?${params.toString()}`),
        apiFetch<{ jobs: RefreshJob[] }>("/admin/pricing/refresh-jobs?limit=30"),
      ]);
      setProviders(providerData.providers);
      setOverview(overviewData);
      setCoverage(coverageData);
      setMappings(mappingData.mappings);
      if (initialMappingId) {
        const linkedMapping = mappingData.mappings.find((mapping) => mapping.id === initialMappingId);
        if (linkedMapping) setSelected(linkedMapping);
      }
      setJobs(jobData.jobs);
    } catch (err) {
      if (err instanceof UnauthorizedError) void logout();
      else setError(err instanceof Error ? err.message : "Pricing operations failed to load.");
    } finally {
      setLoading(false);
    }
  }, [logout, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const priceChartingConnected = useMemo(
    () => providers.find((provider) => provider.key === "pricecharting")?.configured ?? false,
    [providers],
  );

  function openAction(kind: ActionKind, mapping?: Mapping) {
    setActionKind(kind);
    setSelected(mapping ?? null);
    setReason("");
    setConfirmation("");
    setDryRunComplete(false);
    setOverridePreview(null);
    if (mapping) setOverrideCardId(mapping.cardId);
  }

  function closeAction() {
    setActionKind(null);
    setSelected(null);
    setSubmitting(false);
  }

  async function submitMappingReview(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await apiPost(`/admin/pricing/mappings/${selected.id}/review`, {
        outcome,
        reason,
        confirmed: true,
        confirmation,
      });
      toast({ title: "Mapping review saved", description: "The decision was recorded in the audit log." });
      closeAction();
      await load();
    } catch (err) {
      toast({ title: "Mapping review failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function previewRefresh() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const preview = await apiPost<{ eligible: string[] }>(
        "/admin/pricing/refresh-jobs",
        { cardIds: [selected.cardId], reason, dryRun: true },
      );
      setDryRunComplete(preview.eligible.includes(selected.cardId));
      toast({
        title: preview.eligible.includes(selected.cardId) ? "Refresh is eligible" : "Refresh cannot be queued",
        description: preview.eligible.includes(selected.cardId)
          ? "Confirm to send it through the production provider queue."
          : "This card needs a matched provider product first.",
      });
    } catch (err) {
      toast({ title: "Dry run failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function queueRefresh() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await apiPost("/admin/pricing/refresh-jobs", {
        cardIds: [selected.cardId],
        reason,
        dryRun: false,
        confirmed: true,
        confirmation,
      });
      toast({ title: "Refresh queued", description: "Provider rate limits and provenance are preserved." });
      closeAction();
      await load();
    } catch (err) {
      toast({ title: "Could not queue refresh", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function previewOverride() {
    setSubmitting(true);
    try {
      const preview = await apiPost<Record<string, unknown>>("/admin/pricing/overrides", {
        cardId: overrideCardId,
        gradeKey: overrideGrade,
        priceCents: Math.round(Number(overridePrice) * 100),
        currency: overrideCurrency,
        expiresAt: overrideExpiry || undefined,
        reason,
        dryRun: true,
      });
      setOverridePreview(preview);
      setDryRunComplete(true);
    } catch (err) {
      toast({ title: "Override validation failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function applyOverride() {
    setSubmitting(true);
    try {
      await apiPost("/admin/pricing/overrides", {
        cardId: overrideCardId,
        gradeKey: overrideGrade,
        priceCents: Math.round(Number(overridePrice) * 100),
        currency: overrideCurrency,
        expiresAt: overrideExpiry || undefined,
        reason,
        dryRun: false,
        confirmed: true,
        confirmation,
      });
      toast({
        title: "Override applied",
        description: "Provider quotes remain visible and the temporary Verified Market value is audited.",
      });
      closeAction();
      await load();
    } catch (err) {
      toast({ title: "Override failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-display text-2xl font-bold">Pricing command centre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider health, mapping review, anomalies, overrides, and real refresh work.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => openAction("override")}
            className="rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-card"
          >
            Create override
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !overview ? (
          Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)
        ) : (
          <>
            <StatCard label="PRICED CARDS" value={overview.quotes.pricedCards} />
            <StatCard label="STALE CARDS" value={overview.quotes.staleCards} accent={overview.quotes.staleCards > 0} />
            <StatCard label="MAPPING REVIEW" value={overview.mappings.reviewRequired} accent={overview.mappings.reviewRequired > 0} />
            <StatCard
              label="REFRESH WORK"
              value={overview.refreshWork.queued + overview.refreshWork.running}
              sub={`${overview.refreshWork.failed} failed · ${overview.activeOverrides} overrides`}
            />
          </>
        )}
      </div>

      <SectionTitle>PROVIDERS</SectionTitle>
      <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {providers.map((provider) => (
          <div key={provider.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold">{provider.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{provider.purpose}</div>
              </div>
              <ProviderBadge status={provider.status} />
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Credential: {provider.configured ? "Configured" : "Not configured"}
            </div>
            {provider.lastHealthyAt && (
              <div className="mt-1 text-xs text-muted-foreground">
                Healthy {new Date(provider.lastHealthyAt).toLocaleString()}
              </div>
            )}
            {provider.lastResult && <p className="mt-2 text-xs text-negative">{provider.lastResult}</p>}
            {provider.failureCategory && (
              <div className="mt-1 text-xs text-muted-foreground">
                Latest failure: {provider.failureCategory}
              </div>
            )}
          </div>
        ))}
      </div>

      <SectionTitle>PRICECHARTING COVERAGE &amp; RECOVERY</SectionTitle>
      <div className="mb-8 rounded-xl border border-border bg-card p-4">
        {!coverage ? (
          <div className="text-sm text-muted-foreground">Coverage evidence is loading.</div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {coverage.byGame.map((game) => (
                <div key={game.game} className="rounded-lg border border-border bg-background p-3">
                  <div className="text-xs font-bold uppercase">{game.game.replaceAll("_", " ")}</div>
                  <div className="mt-2 text-xl font-bold">{game.rawQuoteCards}/{game.supportedCards}</div>
                  <div className="text-xs text-muted-foreground">
                    raw quotes · {game.unprocessedCards} unprocessed · {game.ambiguousCards} ambiguous
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2">Guide</th><th className="pb-2">Import</th>
                    <th className="pb-2">Reconciliation</th><th className="pb-2">Rows</th>
                    <th className="pb-2">Age</th><th className="pb-2">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {coverage.imports.map((guide) => (
                    <tr key={guide.category}>
                      <td className="py-2 font-bold">{guide.category.replaceAll("_", " ")}</td>
                      <td className="py-2">{guide.status}</td>
                      <td className="py-2">{guide.reconciliationStatus}</td>
                      <td className="py-2">{guide.rowCount.toLocaleString()}</td>
                      <td className="py-2">{guide.ageHours}h</td>
                      <td className="py-2 text-muted-foreground">
                        {guide.lastErrorKind
                          ? `blocked: ${guide.lastErrorKind}`
                          : guide.reconciliationCursor
                            ? "bounded work remains"
                            : "no current failure"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-muted-foreground">
              {coverage.latestSchedulerRun
                ? `Latest scheduler: ${coverage.latestSchedulerRun.status} · ${coverage.latestSchedulerRun.refreshSucceeded} succeeded · ${coverage.latestSchedulerRun.refreshFailed} failed · ${new Date(coverage.latestSchedulerRun.startedAt).toLocaleString()}`
                : "No scheduler run has been recorded yet."}
            </div>
          </div>
        )}
      </div>

      <div className="mb-8 grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <section>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle>MAPPING QUEUE</SectionTitle>
            <form
              onSubmit={(event) => { event.preventDefault(); setLoading(true); void load(); }}
              className="flex gap-2"
            >
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs"
              >
                <option value="review_required">Review required</option>
                <option value="unmatched">Unmatched</option>
                <option value="matched">Matched</option>
              </select>
              <div className="flex rounded-lg border border-border bg-card">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Card or provider"
                  className="w-36 bg-transparent px-3 text-xs outline-none sm:w-48"
                />
                <button className="p-2 text-muted-foreground" aria-label="Search mappings">
                  <Search size={15} />
                </button>
              </div>
            </form>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {mappings.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No mappings match this filter.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {mappings.map((mapping) => (
                  <div key={mapping.id} className="p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">
                          {mapping.matchedName ?? mapping.cardId}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {mapping.cardId}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {mapping.providerProductName ?? "No provider candidate"} ·{" "}
                          {mapping.providerProductId ?? "No product ID"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={mapping.status} />
                        {mapping.confidenceScore != null && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {Math.round(mapping.confidenceScore * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {mapping.status === "review_required" && (
                          <button
                            onClick={() => openAction("mapping", mapping)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-bold hover:bg-background"
                          >
                            Review mapping
                          </button>
                        )}
                        <button
                          disabled={!priceChartingConnected}
                          onClick={() => openAction("refresh", mapping)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-bold hover:bg-background disabled:opacity-40"
                        >
                          Queue refresh
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <SectionTitle>ANOMALY FLAGS</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {!overview || overview.anomalies.length === 0 ? (
              <div className="p-10 text-center">
                <CheckCircle2 className="mx-auto mb-3 text-positive" size={25} />
                <p className="text-sm text-muted-foreground">No threshold anomalies in retained history.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {overview.anomalies.map((anomaly) => (
                  <div key={`${anomaly.cardId}-${anomaly.gradeKey}`} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{anomaly.cardId}</div>
                        <div className="text-xs text-muted-foreground">{anomaly.gradeKey}</div>
                      </div>
                      <span className="font-mono text-sm font-bold text-negative">
                        {anomaly.changePercent > 0 ? "+" : ""}{anomaly.changePercent}%
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {(anomaly.previousPriceCents / 100).toFixed(2)} →{" "}
                      {(anomaly.currentPriceCents / 100).toFixed(2)} {anomaly.currency}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <SectionTitle>RECENT REFRESH WORK</SectionTitle>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No operator refresh work yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {jobs.map((job) => (
              <div key={job.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_120px_180px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{job.cardId}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{job.reason}</div>
                  {job.errorMessage && <div className="mt-1 text-xs text-negative">{job.errorMessage}</div>}
                </div>
                <StatusBadge status={job.status} />
                <div className="text-xs text-muted-foreground sm:text-right">
                  {new Date(job.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {actionKind && (
        <ActionDialog title={
          actionKind === "mapping"
            ? "Review provider mapping"
            : actionKind === "refresh"
              ? "Queue provider refresh"
              : "Create manual override"
        } onClose={closeAction}>
          {actionKind === "mapping" && selected && (
            <form onSubmit={submitMappingReview} className="space-y-4">
              <ImpactNotice>
                Approving enables provider pricing for {selected.cardId}. Rejecting keeps prices unavailable.
              </ImpactNotice>
              <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
                <option value="approve">Approve existing provider product</option>
                <option value="reject">Reject as incorrect</option>
              </select>
              <ReasonField reason={reason} setReason={setReason} />
              <ConfirmField value={confirmation} setValue={setConfirmation} phrase="REVIEW MAPPING" />
              <SubmitButton disabled={submitting || reason.trim().length < 10 || confirmation !== "REVIEW MAPPING"}>
                {submitting ? "Saving…" : "Save audited review"}
              </SubmitButton>
            </form>
          )}

          {actionKind === "refresh" && selected && (
            <div className="space-y-4">
              <ImpactNotice>
                This uses the existing production provider queue and does not bypass rate limits.
              </ImpactNotice>
              <ReasonField reason={reason} setReason={(value) => { setReason(value); setDryRunComplete(false); }} />
              {!dryRunComplete ? (
                <SubmitButton disabled={submitting || reason.trim().length < 10} onClick={() => void previewRefresh()}>
                  {submitting ? "Checking…" : "Run dry run"}
                </SubmitButton>
              ) : (
                <>
                  <div className="rounded-lg border border-positive/30 bg-positive/10 p-3 text-sm text-positive">
                    Eligible. Confirm to queue one refresh.
                  </div>
                  <ConfirmField value={confirmation} setValue={setConfirmation} phrase="QUEUE REFRESH" />
                  <SubmitButton disabled={submitting || confirmation !== "QUEUE REFRESH"} onClick={() => void queueRefresh()}>
                    {submitting ? "Queueing…" : "Queue refresh"}
                  </SubmitButton>
                </>
              )}
            </div>
          )}

          {actionKind === "override" && (
            <div className="space-y-4">
              <ImpactNotice>
                The override changes Verified Market temporarily. Original provider quotes remain visible and are never deleted.
              </ImpactNotice>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Card ID" value={overrideCardId} setValue={(value) => { setOverrideCardId(value); setDryRunComplete(false); }} />
                <label className="text-xs font-bold text-muted-foreground">
                  GRADE
                  <select value={overrideGrade} onChange={(event) => { setOverrideGrade(event.target.value); setDryRunComplete(false); }} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground">
                    {[
                      { key: "raw", label: "Ungraded (Raw)" },
                      { key: "graded", label: "Graded (unspecified)" },
                      { key: "bgs_10", label: "BGS 10" },
                      { key: "cgc_10", label: "CGC 10" },
                      { key: "sgc_10", label: "SGC 10" },
                    ].map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <Field label="Price" type="number" value={overridePrice} setValue={(value) => { setOverridePrice(value); setDryRunComplete(false); }} />
                <Field label="Currency" value={overrideCurrency} setValue={(value) => { setOverrideCurrency(value.toUpperCase()); setDryRunComplete(false); }} />
                <Field label="Expiry (optional)" type="datetime-local" value={overrideExpiry} setValue={(value) => { setOverrideExpiry(value); setDryRunComplete(false); }} />
              </div>
              <ReasonField reason={reason} setReason={(value) => { setReason(value); setDryRunComplete(false); }} />
              {!dryRunComplete ? (
                <SubmitButton disabled={submitting || reason.trim().length < 10 || !overrideCardId || !overridePrice} onClick={() => void previewOverride()}>
                  {submitting ? "Validating…" : "Preview override"}
                </SubmitButton>
              ) : (
                <>
                  <pre className="max-h-36 overflow-auto rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">
                    {JSON.stringify(overridePreview, null, 2)}
                  </pre>
                  <ConfirmField value={confirmation} setValue={setConfirmation} phrase="APPLY OVERRIDE" />
                  <SubmitButton disabled={submitting || confirmation !== "APPLY OVERRIDE"} onClick={() => void applyOverride()}>
                    {submitting ? "Applying…" : "Apply audited override"}
                  </SubmitButton>
                </>
              )}
            </div>
          )}
        </ActionDialog>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-bold tracking-wider text-muted-foreground">{children}</h2>;
}

function ProviderBadge({ status }: { status: string }) {
  const good = status === "HEALTHY" || status === "LIVE";
  const warning = status === "HEALTHY BUT STALE" || status === "DEGRADED" || status === "RATE LIMITED" || status === "MISCONFIGURED";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
      good
        ? "border-positive/30 bg-positive/10 text-positive"
        : warning
          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
          : "border-border bg-background text-muted-foreground"
    }`}>{status}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const positive = ["matched", "succeeded"].includes(status);
  const negative = ["failed", "unmatched"].includes(status);
  return (
    <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
      positive
        ? "border-positive/30 bg-positive/10 text-positive"
        : negative
          ? "border-negative/30 bg-negative/10 text-negative"
          : "border-amber-500/30 bg-amber-500/10 text-amber-400"
    }`}>{status.replaceAll("_", " ")}</span>
  );
}

function ActionDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <button className="fixed inset-0 z-40 bg-black/70" onClick={onClose} aria-label="Close action" />
      <div role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-muted-foreground">Close</button>
        </div>
        {children}
      </div>
    </>
  );
}

function ImpactNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
      <ShieldAlert size={17} className="mt-0.5 shrink-0" /> {children}
    </div>
  );
}

function ReasonField({ reason, setReason }: { reason: string; setReason: (value: string) => void }) {
  return (
    <label className="block text-xs font-bold text-muted-foreground">
      OPERATOR REASON
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Explain why this action is necessary (minimum 10 characters)" className="mt-1.5 w-full rounded-lg border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary" />
    </label>
  );
}

function ConfirmField({ value, setValue, phrase }: { value: string; setValue: (value: string) => void; phrase: string }) {
  return (
    <label className="block text-xs font-bold text-muted-foreground">
      TYPE {phrase}
      <input value={value} onChange={(event) => setValue(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary" />
    </label>
  );
}

function Field({ label, value, setValue, type = "text" }: { label: string; value: string; setValue: (value: string) => void; type?: string }) {
  return (
    <label className="text-xs font-bold text-muted-foreground">
      {label.toUpperCase()}
      <input type={type} value={value} onChange={(event) => setValue(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary" />
    </label>
  );
}

function SubmitButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick?: () => void;
}) {
  return (
    <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
      {children}
    </button>
  );
}