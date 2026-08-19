import { useEffect, useState } from "react";
import { BadgeCheck, Laptop, MonitorSmartphone, XCircle } from "lucide-react";
import { apiDelete, apiFetch, type Session } from "@/lib/api";
import { ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

export default function SessionsPage() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadSessions() {
    setLoading(true);
    setError(null);
    apiFetch<{ sessions: Session[] }>("/admin/sessions")
      .then((data) => setSessions(data.sessions))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load sessions."))
      .finally(() => setLoading(false));
  }

  useEffect(loadSessions, []);

  async function revoke(session: Session) {
    if (!window.confirm(`Revoke ${session.administrator.displayName}'s session immediately?`)) return;
    try {
      const response = await apiDelete<{ message: string }>(`/admin/sessions/${session.id}`);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      toast({ title: "Session revoked", description: response.message });
    } catch (revokeError) {
      toast({ title: "Session not revoked", description: revokeError instanceof Error ? revokeError.message : "Request failed.", variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <h1 className="font-display text-2xl font-bold">Active sessions</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Review active administrator access and revoke any device immediately.</p>
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl border border-border bg-card" />)
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
            <Laptop className="mx-auto mb-3 opacity-50" /> No active sessions.
          </div>
        ) : sessions.map((session) => (
          <article key={session.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                <MonitorSmartphone size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-bold">{session.administrator.displayName}</h2>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{session.administrator.role}</span>
                  {session.current && <span className="inline-flex items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-positive"><BadgeCheck size={11} /> Current</span>}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">{session.administrator.email}</div>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-muted-foreground">Device fingerprint</dt><dd className="mt-0.5 font-mono">{session.deviceFingerprint}</dd></div>
                  <div><dt className="text-muted-foreground">Network fingerprint</dt><dd className="mt-0.5 font-mono">{session.networkFingerprint}</dd></div>
                  <div><dt className="text-muted-foreground">Started</dt><dd className="mt-0.5">{new Date(session.createdAt).toLocaleString()}</dd></div>
                  <div><dt className="text-muted-foreground">Last activity</dt><dd className="mt-0.5">{new Date(session.lastActivityAt).toLocaleString()}</dd></div>
                </dl>
              </div>
              {!session.current && (
                <button type="button" onClick={() => void revoke(session)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2 text-xs font-bold text-negative">
                  <XCircle size={14} /> <span className="hidden sm:inline">Revoke</span>
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}