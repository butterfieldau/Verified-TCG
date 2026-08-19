import { useState } from "react";
import { Search, Shield, UserMinus, X } from "lucide-react";
import { useCommunityPosts, useCommunityBlocks, useModeratePost } from "@/hooks/use-community";
import { ErrorBanner, fmtDate } from "@/components/admin-ui";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";

export default function CommunityPage() {
  const { auth } = useAuth();
  const [activeTab, setActiveTab] = useState<"posts" | "blocks">("posts");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");

  const canManage = auth?.permissions.includes("community:moderate");

  const { data: postsData, isLoading: loadingPosts, error: postsError } = useCommunityPosts({ page, limit: 20, search: debouncedSearch, status: statusFilter });
  const { data: blocksData, isLoading: loadingBlocks } = useCommunityBlocks({ page, limit: 20, search: debouncedSearch });
  const moderate = useModeratePost();
  const { toast } = useToast();

  const [modTarget, setModTarget] = useState<any>(null);
  const [modStatus, setModStatus] = useState("hidden");
  const [modReason, setModReason] = useState("");
  const [modConfirm, setModConfirm] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setPage(1);
  };

  const executeMod = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modTarget) return;
    moderate.mutate({
      id: modTarget.id,
      status: modStatus,
      reason: modReason,
      confirmation: modStatus === "removed" ? modConfirm : undefined
    }, {
      onSuccess: () => {
        toast({ title: "Post moderated successfully" });
        setModTarget(null);
        setModReason("");
        setModConfirm("");
      },
      onError: (err: any) => {
        toast({ title: "Moderation failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Community</h1>
      <p className="text-sm text-muted-foreground mb-8">Moderation queue, user content, and block relationships.</p>

      {postsError && <ErrorBanner message="Failed to load community data." />}

      <div className="flex flex-col sm:flex-row gap-4 justify-between mb-6">
        <div className="flex bg-card border border-border rounded-lg p-1 gap-1 w-fit">
          <button
            onClick={() => { setActiveTab("posts"); setPage(1); }}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "posts" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Posts
          </button>
          <button
            onClick={() => { setActiveTab("blocks"); setPage(1); }}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "blocks" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Blocks
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          {activeTab === "posts" && (
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none"
            >
              <option value="">All Statuses</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="removed">Removed</option>
            </select>
          )}
          <div className="relative flex-1 sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button type="submit" className="hidden" />
        </form>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {activeTab === "posts" && (
          <div className="divide-y divide-border">
            {loadingPosts ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse">Loading posts...</div>
            ) : postsData?.posts?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No posts found.</div>
            ) : (
              postsData?.posts?.map((post: any) => (
                <div key={post.id} className="p-5 flex flex-col sm:flex-row gap-4 justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-sm">{post.userDisplayName || 'Unknown'}</span>
                      <span className="text-xs text-muted-foreground">@{post.userUsername || post.userId.slice(0,8)}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{fmtDate(post.createdAt)}</span>
                      {post.moderationStatus !== 'visible' && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${post.moderationStatus === 'removed' ? 'bg-negative/20 text-negative border border-negative/30' : 'bg-amber-500/20 text-amber-500 border border-amber-500/30'}`}>
                          {post.moderationStatus}
                        </span>
                      )}
                    </div>
                    {post.cardName && (
                      <div className="text-xs font-medium text-primary mb-2">Ref: {post.cardName}</div>
                    )}
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">{post.body}</p>
                    {post.moderationReason && (
                      <div className="mt-3 text-xs bg-background border border-border p-2 rounded-md">
                        <span className="font-bold mr-1">Mod Note:</span> {post.moderationReason}
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <div className="shrink-0 flex sm:flex-col gap-2">
                      <button
                        onClick={() => { setModTarget(post); setModStatus('hidden'); }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-bold transition-colors"
                      >
                        <Shield size={14} /> MODERATE
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "blocks" && (
          <div className="divide-y divide-border">
            {loadingBlocks ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse">Loading blocks...</div>
            ) : blocksData?.blocks?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No blocks found.</div>
            ) : (
              blocksData?.blocks?.map((block: any) => (
                <div key={`${block.blockerUserId}-${block.blockedUserId}`} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="bg-background border border-border rounded-lg p-3 md:w-48 truncate">
                      <div className="text-xs text-muted-foreground">Blocker</div>
                      <div className="font-bold text-sm truncate">{block.blockerUsername || block.blockerUserId.slice(0,8)}</div>
                    </div>
                    <UserMinus size={16} className="text-muted-foreground shrink-0 hidden md:block" />
                    <div className="bg-background border border-negative/30 rounded-lg p-3 md:w-48 truncate">
                      <div className="text-xs text-muted-foreground">Blocked</div>
                      <div className="font-bold text-sm truncate text-negative">{block.blockedUsername || block.blockedUserId.slice(0,8)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtDate(block.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="p-4 border-t border-border bg-background flex justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs font-bold disabled:opacity-50"
          >PREV</button>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(activeTab === 'posts' ? postsData?.posts?.length : blocksData?.blocks?.length) < 20}
            className="text-xs font-bold disabled:opacity-50"
          >NEXT</button>
        </div>
      </div>

      {modTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-display text-lg font-bold">Moderate Post</h3>
              <button onClick={() => setModTarget(null)} className="text-muted-foreground hover:text-foreground"><X size={20}/></button>
            </div>

            <div className="text-sm bg-background border border-border p-3 rounded-lg mb-5 max-h-32 overflow-y-auto">
              {modTarget.body}
            </div>

            <form onSubmit={executeMod} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">Action</label>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => setModStatus('visible')} className={`py-2 text-xs font-bold rounded-lg border ${modStatus === 'visible' ? 'bg-positive/20 border-positive text-positive' : 'border-border bg-background'}`}>Visible</button>
                  <button type="button" onClick={() => setModStatus('hidden')} className={`py-2 text-xs font-bold rounded-lg border ${modStatus === 'hidden' ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'border-border bg-background'}`}>Hidden</button>
                  <button type="button" onClick={() => setModStatus('removed')} className={`py-2 text-xs font-bold rounded-lg border ${modStatus === 'removed' ? 'bg-negative/20 border-negative text-negative' : 'border-border bg-background'}`}>Removed</button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">Reason (Required)</label>
                <textarea
                  value={modReason}
                  onChange={e => setModReason(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg p-3 text-sm outline-none focus:border-primary min-h-[80px]"
                  placeholder="Why is this action being taken?"
                  required
                />
              </div>

              {modStatus === 'removed' && (
                <div>
                  <label className="block text-xs font-bold text-negative mb-1.5">Type REMOVE to confirm</label>
                  <input
                    type="text"
                    value={modConfirm}
                    onChange={e => setModConfirm(e.target.value)}
                    className="w-full bg-background border border-negative/50 rounded-lg p-3 text-sm outline-none focus:border-negative"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">This action requires recent password confirmation.</p>
                </div>
              )}

              <button
                type="submit"
                disabled={moderate.isPending || !modReason || (modStatus === 'removed' && modConfirm !== 'REMOVE')}
                className="w-full bg-primary text-white font-bold py-2.5 rounded-lg disabled:opacity-50"
              >
                {moderate.isPending ? "Applying..." : "Apply Moderation"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
