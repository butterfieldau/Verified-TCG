import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { ErrorBanner } from "@/components/admin-ui";
import { ShieldCheck, Search, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";

interface AuditEvent {
  id: string;
  source: string;
  category: string;
  severity: string;
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
  deepLink?: string;
  immutable: boolean;
}

interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
  filters: {
    sources: string[];
    categories: string[];
  };
}

export default function AuditPage() {
  const { logout } = useAuth();
  
  // Read initial state from URL
  const queryParams = new URLSearchParams(window.location.search);
  
  const [q, setQ] = useState(queryParams.get("q") || "");
  const [source, setSource] = useState(queryParams.get("source") || "");
  const [category, setCategory] = useState(queryParams.get("category") || "");
  const [action, setAction] = useState(queryParams.get("action") || "");
  const [actor, setActor] = useState(queryParams.get("actor") || "");
  const [targetType, setTargetType] = useState(queryParams.get("targetType") || "");
  const [start, setStart] = useState(queryParams.get("start") || "");
  const [end, setEnd] = useState(queryParams.get("end") || "");
  const [page, setPage] = useState(parseInt(queryParams.get("page") || "1", 10));
  
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    // Sync URL state
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (source) url.searchParams.set("source", source); else url.searchParams.delete("source");
    if (category) url.searchParams.set("category", category); else url.searchParams.delete("category");
    if (action) url.searchParams.set("action", action); else url.searchParams.delete("action");
    if (actor) url.searchParams.set("actor", actor); else url.searchParams.delete("actor");
    if (targetType) url.searchParams.set("targetType", targetType); else url.searchParams.delete("targetType");
    if (start) url.searchParams.set("start", start); else url.searchParams.delete("start");
    if (end) url.searchParams.set("end", end); else url.searchParams.delete("end");
    url.searchParams.set("page", page.toString());
    window.history.replaceState(null, "", url.toString());

    setLoading(true);
    try {
      const qs = new URLSearchParams({
        q, source, category, action, actor, targetType, start, end, page: page.toString(), limit: "50"
      });
      const res = await apiFetch<AuditResponse>(`/admin/intelligence/audit?${qs.toString()}`);
      setData(res);
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) logout();
      else setError(err instanceof Error ? err.message : "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [logout, q, source, category, action, actor, targetType, start, end, page]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadData();
    }, 300); // debounce search
    return () => clearTimeout(timeoutId);
  }, [loadData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[0_0_15px_rgba(255,30,45,0.2)]">
          <ShieldCheck size={20} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Immutable Audit History</h1>
          <p className="text-sm text-muted-foreground">Database-enforced append-only administrative actions and retained security events.</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="bg-card border border-border rounded-xl p-4">
        <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input 
              value={q} 
              onChange={(e) => { setQ(e.target.value); setPage(1); }} 
              placeholder="Search details..." 
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          
          <select 
            value={source} 
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
          >
            <option value="">All Sources</option>
            {data?.filters.sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          
          <select 
            value={category} 
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
          >
            <option value="">All Categories</option>
            {data?.filters.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <input 
            value={actor} 
            onChange={(e) => { setActor(e.target.value); setPage(1); }} 
            placeholder="Actor (Admin/System)..." 
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
          />
          
          <input 
            value={action} 
            onChange={(e) => { setAction(e.target.value); setPage(1); }} 
            placeholder="Action (e.g. create)..." 
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
          />
          <input
            value={targetType}
            onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
            placeholder="Target type..."
            aria-label="Target type"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
          />
          <label className="text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => { setStart(e.target.value); setPage(1); }}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Through
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => { setEnd(e.target.value); setPage(1); }}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </label>
        </form>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto min-h-[400px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="p-4 font-bold w-[180px]">Timestamp</th>
                <th className="p-4 font-bold">Actor</th>
                <th className="p-4 font-bold">Action & Target</th>
                <th className="p-4 font-bold">Details</th>
                <th className="p-4 font-bold w-[120px] text-right">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && !data ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground animate-pulse">Loading audit logs...</td></tr>
              ) : !data || data.events.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No events found matching your criteria.</td></tr>
              ) : (
                data.events.map(event => (
                  <tr key={event.id} className="hover:bg-background/50 group">
                    <td className="p-4 align-top text-xs">
                      <div className="text-foreground">{new Date(event.createdAt).toLocaleDateString()}</div>
                      <div className="text-muted-foreground mt-0.5">{new Date(event.createdAt).toLocaleTimeString()}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 opacity-50 font-mono truncate w-24" title={event.id}>{event.id.split('-')[0]}</div>
                    </td>
                    <td className="p-4 align-top">
                      <div className="font-medium text-foreground">{event.actorLabel}</div>
                      <div className="text-xs text-muted-foreground mt-1 px-1.5 py-0.5 rounded-sm bg-background border border-border inline-block uppercase tracking-wider text-[9px]">{event.source}</div>
                    </td>
                    <td className="p-4 align-top">
                      <div className="font-mono text-xs text-primary mb-1">{event.action}</div>
                      <div className="text-xs">
                        <span className="text-muted-foreground mr-1">{event.targetType}:</span>
                        {event.deepLink ? (
                          <Link href={event.deepLink} className="font-mono font-medium hover:underline flex items-center gap-1 inline-flex">
                            {event.targetId} <ExternalLink size={10} />
                          </Link>
                        ) : (
                          <span className="font-mono font-medium">{event.targetId}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 align-top whitespace-normal min-w-[200px]">
                      <div className={`text-xs px-2 py-0.5 rounded border inline-block mb-2 font-bold tracking-wider uppercase ${
                        event.severity === 'critical' ? 'bg-negative/10 border-negative/30 text-negative' :
                        event.severity === 'high' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' :
                        event.severity === 'medium' ? 'bg-primary/10 border-primary/30 text-primary' :
                        'bg-background border-border text-muted-foreground'
                      }`}>
                        {event.severity}
                      </div>
                      <div className="text-sm text-foreground/90">{event.reason || "—"}</div>
                      {event.requestId && (
                        <div className="mt-2 text-[10px] font-mono text-muted-foreground break-all">
                          Correlation: {event.requestId}
                        </div>
                      )}
                    </td>
                    <td className="p-4 align-top text-right">
                      {event.immutable ? (
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-positive bg-positive/10 border border-positive/20 px-2 py-1 rounded">
                          <ShieldCheck size={12} /> APPEND-ONLY
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-border">
          {loading && !data ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">Loading audit logs...</div>
          ) : !data || data.events.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No events found matching your criteria.</div>
          ) : (
            data.events.map(event => (
              <div key={event.id} className="p-4 space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-bold tracking-wider uppercase ${
                    event.severity === 'critical' ? 'bg-negative/10 border-negative/30 text-negative' :
                    event.severity === 'high' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' :
                    event.severity === 'medium' ? 'bg-primary/10 border-primary/30 text-primary' :
                    'bg-background border-border text-muted-foreground'
                  }`}>
                    {event.severity}
                  </div>
                  {event.immutable && (
                    <div className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-positive bg-positive/10 border border-positive/20 px-1.5 py-0.5 rounded">
                      <ShieldCheck size={10} /> APPEND-ONLY
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-mono text-xs text-primary mb-1">{event.action}</div>
                  <div className="text-sm text-foreground/90">{event.reason || "—"}</div>
                  <div className="text-xs mt-2">
                    <span className="text-muted-foreground mr-1">{event.targetType ? `${event.targetType}:` : "Target:"}</span>
                    {event.deepLink ? (
                      <Link href={event.deepLink} className="font-mono font-medium hover:underline inline-flex items-center gap-1">
                        {event.targetId} <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="font-mono font-medium">{event.targetId}</span>
                    )}
                  </div>
                </div>
                {event.requestId && (
                  <div className="text-[10px] font-mono text-muted-foreground break-all">
                    Correlation: {event.requestId}
                  </div>
                )}

                <div className="flex justify-between items-end pt-2 border-t border-border/50">
                  <div className="text-xs">
                    <div className="font-medium text-foreground">{event.actorLabel}</div>
                    <div className="text-muted-foreground uppercase text-[9px] tracking-wider mt-0.5">{event.source}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-foreground">{new Date(event.createdAt).toLocaleDateString()}</div>
                    <div className="text-muted-foreground mt-0.5">{new Date(event.createdAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {data && (
          <div className="p-4 border-t border-border flex justify-between items-center bg-background/30 text-sm">
            <span className="text-muted-foreground">Showing {(data.page - 1) * data.limit + 1} to {Math.min(data.page * data.limit, data.total)} of {data.total} records</span>
            <div className="flex gap-2">
              <button 
                disabled={data.page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-50 hover:bg-background transition-colors flex items-center gap-1 text-sm font-medium"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <button 
                disabled={data.page * data.limit >= data.total}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-50 hover:bg-background transition-colors flex items-center gap-1 text-sm font-medium"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
