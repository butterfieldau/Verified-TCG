import { useState } from "react";
import { Activity, ShieldAlert, Zap, AlertTriangle, Info, Shield, CheckCircle, Clock } from "lucide-react";
import { useOperationsSummary, useActivity } from "@/hooks/use-operations";
import { StatCard, SkeletonCard, ErrorBanner, fmtDate } from "@/components/admin-ui";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth";

export default function OperationsPage() {
  const { auth } = useAuth();
  const { data: summary, isLoading: loadingSummary, error: summaryError } = useOperationsSummary();
  const [page, setPage] = useState(1);
  const { data: activityData, isLoading: loadingActivity } = useActivity({ page, limit: 20 });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Operations</h1>
          <p className="text-sm text-muted-foreground">Live platform monitoring and operator activity.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full border">
          {loadingSummary ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="text-amber-500">LOADING SUMMARY</span>
            </>
          ) : summaryError ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-negative"></span>
              </span>
              <span className="text-negative">SUMMARY UNAVAILABLE</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-positive"></span>
              </span>
              <span className="text-positive">OPERATIONS DATA LOADED</span>
            </>
          )}
        </div>
      </div>

      {summaryError && <ErrorBanner message="Failed to load operations summary." />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
              <ShieldAlert size={14} /> ATTENTION REQUIRED
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {loadingSummary ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
              ) : summary ? (
                <>
                  {auth?.permissions.includes('reports:read') ? (
                    <Link href="/reports" className="block">
                      <StatCard label="UNRESOLVED REPORTS" value={summary.counts.unresolvedReports} accent={summary.counts.unresolvedReports > 0} />
                    </Link>
                  ) : (
                    <StatCard label="UNRESOLVED REPORTS" value={summary.counts.unresolvedReports} accent={summary.counts.unresolvedReports > 0} />
                  )}

                  {auth?.permissions.includes('community:read') ? (
                    <Link href="/community" className="block">
                      <StatCard label="HIDDEN POSTS" value={summary.counts.hiddenPosts} accent={summary.counts.hiddenPosts > 0} />
                    </Link>
                  ) : (
                    <StatCard label="HIDDEN POSTS" value={summary.counts.hiddenPosts} accent={summary.counts.hiddenPosts > 0} />
                  )}

                  {auth?.permissions.includes('trust:read') ? (
                    <Link href="/trust?tab=certifications" className="block">
                      <StatCard label="PENDING CERTS" value={summary.counts.pendingCertifications} accent={summary.counts.pendingCertifications > 0} />
                    </Link>
                  ) : (
                    <StatCard label="PENDING CERTS" value={summary.counts.pendingCertifications} accent={summary.counts.pendingCertifications > 0} />
                  )}

                  {auth?.permissions.includes('vendors:read') ? (
                    <Link href="/vendors" className="block">
                      <StatCard label="PENDING VENDORS" value={summary.counts.pendingVendors} accent={summary.counts.pendingVendors > 0} />
                    </Link>
                  ) : (
                    <StatCard label="PENDING VENDORS" value={summary.counts.pendingVendors} accent={summary.counts.pendingVendors > 0} />
                  )}

                  {auth?.permissions.includes('events:read') ? (
                    <Link href="/events" className="block">
                      <StatCard label="LIVE EVENTS" value={summary.counts.liveEvents} />
                    </Link>
                  ) : (
                    <StatCard label="LIVE EVENTS" value={summary.counts.liveEvents} />
                  )}

                  {auth?.permissions.includes('events:read') ? (
                    <Link href="/events" className="block">
                      <StatCard label="PAUSED EVENTS" value={summary.counts.pausedEvents} accent={summary.counts.pausedEvents > 0} />
                    </Link>
                  ) : (
                    <StatCard label="PAUSED EVENTS" value={summary.counts.pausedEvents} accent={summary.counts.pausedEvents > 0} />
                  )}

                  {auth?.permissions.includes('community:read') ? (
                    <Link href="/community" className="block">
                      <StatCard label="REMOVED POSTS" value={summary.counts.removedPosts} />
                    </Link>
                  ) : (
                    <StatCard label="REMOVED POSTS" value={summary.counts.removedPosts} />
                  )}

                  {auth?.permissions.includes('drops:read') ? (
                    <Link href="/trust?tab=drops" className="block">
                      <StatCard label="DRAFT DROPS" value={summary.counts.draftDrops} />
                    </Link>
                  ) : (
                    <StatCard label="DRAFT DROPS" value={summary.counts.draftDrops} />
                  )}
                </>
              ) : null}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
              <Info size={14} /> CAPABILITY DISCLOSURES
            </h2>
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {loadingSummary ? (
                <div className="p-5 animate-pulse h-32" />
              ) : summary?.capabilities ? (
                Object.entries(summary.capabilities).map(([key, cap]: [string, any]) => (
                  <div key={key} className="p-4 flex gap-4 items-start">
                    <div className="shrink-0 mt-0.5">
                      {cap.available ? (
                        <CheckCircle size={16} className="text-positive" />
                      ) : (
                        <AlertTriangle size={16} className="text-amber-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-bold capitalize mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{cap.reason}</div>
                    </div>
                  </div>
                ))
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
            <Activity size={14} /> OPERATOR ACTIVITY
          </h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col h-[600px]">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingActivity ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-border mt-1.5" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-border rounded w-3/4" />
                      <div className="h-2 bg-border rounded w-1/4" />
                    </div>
                  </div>
                ))
              ) : activityData?.activity?.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">No recent activity.</div>
              ) : (
                activityData?.activity?.map((log: any) => (
                  <div key={log.id} className="flex gap-3 text-sm">
                    <div className="shrink-0 mt-1">
                      <div className={`w-2 h-2 rounded-full ${log.severity === 'high' ? 'bg-negative' : 'bg-primary'}`} />
                    </div>
                    <div>
                      <div className="font-medium">
                        <span className="font-mono text-xs mr-2 text-muted-foreground">{log.adminId.slice(0, 8)}</span>
                        {log.action}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {log.targetType}: {log.targetId}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                        <Clock size={10} /> {new Date(log.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {activityData?.total > 20 && (
              <div className="p-3 border-t border-border bg-background flex justify-between items-center">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-xs font-bold disabled:opacity-50"
                >
                  PREV
                </button>
                <span className="text-xs text-muted-foreground">Page {page}</span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={activityData.activity.length < 20}
                  className="text-xs font-bold disabled:opacity-50"
                >
                  NEXT
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
