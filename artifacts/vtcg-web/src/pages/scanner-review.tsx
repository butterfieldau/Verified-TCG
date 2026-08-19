import { FormEvent, useCallback, useEffect, useState } from "react";
import { EyeOff, ScanSearch, ShieldCheck } from "lucide-react";
import { apiFetch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";
import { ErrorBanner, SkeletonCard, StatCard } from "@/components/admin-ui";

interface ScannerOverview {
  attempts: number;
  successful: number;
  successRate: number | null;
  failed: number;
  lowConfidence: number;
  unmatched: number;
  unreadable: number;
  averageConfidence: number | null;
  averageDurationMs: number | null;
  uniqueUsers: number;
  pendingReview: number;
  confidenceBuckets: { bucket: string; count: number }[];
  imageRetention: string;
}

interface ScanAttempt {
  id: string;
  status: string;
  extractedName: string | null;
  extractedSet: string | null;
  extractedNumber: string | null;
  topMatchCardId: string | null;
  topMatchName: string | null;
  topMatchConfidence: number | null;
  candidateSummary: unknown;
  model: string | null;
  durationMs: number;
  errorCode: string | null;
  reviewStatus: string;
  createdAt: string;
}

const OUTCOMES = [
  ["confirmed_match", "Confirmed match"],
  ["false_positive", "False positive"],
  ["unreadable", "Unreadable image"],
  ["catalogue_gap", "Catalogue gap"],
  ["dismissed", "Dismiss"],
] as const;

export default function ScannerReviewPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canReview = auth?.permissions.includes("scanner:review") ?? false;
  const [overview, setOverview] = useState<ScannerOverview | null>(null);
  const [attempts, setAttempts] = useState<ScanAttempt[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScanAttempt | null>(null);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number][0]>("confirmed_match");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ reviewStatus: "pending", limit: "50" });
      if (status) params.set("status", status);
      const [summary, queue] = await Promise.all([
        apiFetch<ScannerOverview>("/admin/scanner/overview?days=30"),
        apiFetch<{ attempts: ScanAttempt[] }>(`/admin/scanner/attempts?${params.toString()}`),
      ]);
      setOverview(summary);
      setAttempts(queue.attempts);
    } catch (err) {
      if (err instanceof UnauthorizedError) void logout();
      else setError(err instanceof Error ? err.message : "Scanner operations failed to load.");
    } finally {
      setLoading(false);
    }
  }, [logout, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await apiPost(`/admin/scanner/attempts/${selected.id}/review`, {
        outcome,
        reason,
        confirmed: true,
        confirmation,
      });
      toast({
        title: "Scan review recorded",
        description: "The outcome is durable and audit-compatible.",
      });
      setSelected(null);
      setReason("");
      setConfirmation("");
      await load();
    } catch (err) {
      toast({
        title: "Review failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Scanner & matching</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Persisted recognition quality and a privacy-aware review queue.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="mb-5 flex gap-3 rounded-xl border border-border bg-card p-4">
        <EyeOff className="mt-0.5 shrink-0 text-positive" size={18} />
        <div>
          <div className="text-sm font-bold">Source images are not retained</div>
          <p className="mt-1 text-sm text-muted-foreground">
            The queue stores extracted fields, candidate identifiers, confidence, timing, and errors only.
            Reprocessing is intentionally unavailable without the original photo.
          </p>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !overview ? (
          Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)
        ) : (
          <>
            <StatCard
              label="ATTEMPTS · 30D"
              value={overview.attempts}
              sub={`${overview.uniqueUsers} unique collectors`}
            />
            <StatCard
              label="SUCCESS RATE"
              value={overview.successRate == null ? "No data" : `${overview.successRate}%`}
            />
            <StatCard
              label="AVERAGE CONFIDENCE"
              value={overview.averageConfidence == null ? "No data" : `${overview.averageConfidence}%`}
              sub={overview.averageDurationMs == null ? undefined : `${overview.averageDurationMs} ms average`}
            />
            <StatCard
              label="PENDING REVIEW"
              value={overview.pendingReview}
              accent={overview.pendingReview > 0}
              sub={`${overview.lowConfidence} low confidence · ${overview.failed} failed`}
            />
          </>
        )}
      </div>

      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-xs font-bold tracking-wider text-muted-foreground">QUALITY REVIEW QUEUE</h2>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs"
        >
          <option value="">All attention states</option>
          <option value="low_confidence">Low confidence</option>
          <option value="unmatched">Unmatched</option>
          <option value="unreadable">Unreadable</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading review queue…</div>
        ) : attempts.length === 0 ? (
          <div className="p-12 text-center">
            <ShieldCheck className="mx-auto mb-3 text-positive" size={28} />
            <p className="text-sm text-muted-foreground">No persisted attempts need review.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="p-4">
                <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_170px] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ScanStatus status={attempt.status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(attempt.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-bold">
                      {attempt.extractedName || "No card name extracted"}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[attempt.extractedSet, attempt.extractedNumber].filter(Boolean).join(" · ") ||
                        "No set or number extracted"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Top candidate
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {attempt.topMatchName ?? "No provider candidate"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {attempt.topMatchConfidence == null
                        ? "No confidence"
                        : `${attempt.topMatchConfidence}% confidence`}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {attempt.durationMs} ms · {attempt.model ?? "Model unavailable"}
                    </div>
                  </div>
                  <button
                    disabled={!canReview}
                    onClick={() => {
                      setSelected(attempt);
                      setReason("");
                      setConfirmation("");
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
                  >
                    Record outcome
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          <button className="fixed inset-0 z-40 bg-black/70" onClick={() => setSelected(null)} aria-label="Close review" />
          <div role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-5 shadow-2xl">
            <h2 className="font-display text-xl font-bold">Review scan outcome</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {selected.extractedName || "Unreadable attempt"} · {selected.topMatchName || "No match"}
            </p>
            <form onSubmit={submitReview} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-muted-foreground">
                OUTCOME
                <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground">
                  {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-muted-foreground">
                REVIEW REASON
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary" placeholder="Explain the outcome (minimum 10 characters)" />
              </label>
              <label className="block text-xs font-bold text-muted-foreground">
                TYPE REVIEW SCAN
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary" />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected(null)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-bold">Cancel</button>
                <button disabled={submitting || reason.trim().length < 10 || confirmation !== "REVIEW SCAN"} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                  {submitting ? "Saving…" : "Save review"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function ScanStatus({ status }: { status: string }) {
  const negative = status === "failed" || status === "unmatched";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
      negative
        ? "border-negative/30 bg-negative/10 text-negative"
        : "border-amber-500/30 bg-amber-500/10 text-amber-400"
    }`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}