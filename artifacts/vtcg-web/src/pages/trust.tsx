import { useState, useEffect } from "react";
import { Shield, ArrowRightLeft, Gift, FileCheck2, AlertTriangle, X, Info, Plus } from "lucide-react";
import { useTrades, useCertifications, useCertification, useDrops, useDrop, useCreateDrop, useEditDrop, useDropStatus, useCertificationStatus, useCertificationNotes, useCreateCertification } from "@/hooks/use-trust";
import { ErrorBanner, fmtDate, StatCard } from "@/components/admin-ui";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function TrustPage() {
  const { auth } = useAuth();
  const [activeTab, setActiveTab] = useState<"trades"|"certifications"|"drops">("trades");

  const canReadTrades = auth?.permissions.includes("trust:read");
  const canReadDrops = auth?.permissions.includes("drops:read");

  // Read initial tab from URL if present and valid
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam === "certifications" && canReadTrades) {
      setActiveTab("certifications");
    } else if (tabParam === "drops" && canReadDrops) {
      setActiveTab("drops");
    } else if (!canReadTrades && canReadDrops && activeTab === "trades") {
      setActiveTab("drops");
    }
  }, [canReadTrades, canReadDrops]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold mb-1">Trust & Safety</h1>
        <p className="text-sm text-muted-foreground">Manage trade policies, certifications, and verified drops.</p>
      </div>

      <div className="flex bg-card border border-border rounded-lg p-1 gap-1 w-fit mb-6">
        {canReadTrades && (
          <>
            <button onClick={() => setActiveTab("trades")} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "trades" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
              Trade Network
            </button>
            <button onClick={() => setActiveTab("certifications")} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "certifications" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
              Certifications
            </button>
          </>
        )}
        {canReadDrops && (
          <button onClick={() => setActiveTab("drops")} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "drops" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
            Verified Drops
          </button>
        )}
      </div>

      {activeTab === "trades" && canReadTrades && <TradesTab />}
      {activeTab === "certifications" && canReadTrades && <CertificationsTab />}
      {activeTab === "drops" && canReadDrops && <DropsTab />}
    </div>
  );
}

function TradesTab() {
  const { data, isLoading, error } = useTrades();

  if (error) return <ErrorBanner message="Failed to load trade data." />;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
          <ArrowRightLeft size={14} /> TRADE NETWORK AGGREGATES
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)
          ) : data?.aggregates ? (
            <>
              <StatCard label="FOR TRADE ITEMS" value={data.aggregates.forTradeItems} />
              <StatCard label="ACTIVE WISHLISTS" value={data.aggregates.activeWishlistItems} />
              <StatCard label="EVENT PARTICIPANTS" value={data.aggregates.activeEventParticipants} />
              <StatCard label="FRAUD REPORTS" value={data.aggregates.tradeFraudReports} accent={data.aggregates.tradeFraudReports > 0} />
            </>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
          <Info size={14} /> CAPABILITY DISCLOSURES
        </h2>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {isLoading ? (
            <div className="p-5 animate-pulse h-32" />
          ) : data?.unavailableCapabilities ? (
            Object.entries(data.unavailableCapabilities).map(([key, cap]: [string, any]) => (
              <div key={key} className="p-4 flex gap-4 items-start">
                <div className="shrink-0 mt-0.5">
                  <AlertTriangle size={16} className="text-amber-500" />
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
  );
}

function CertificationsTab() {
  const { auth } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useCertifications({ page, limit: 20 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const canManage = auth?.permissions.includes("trust:manage");

  if (error) return <ErrorBanner message="Failed to load certifications." />;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setShowCreate(true)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
            <Plus size={16} /> New Certification
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_1.5fr_1fr_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>CARD</span><span>PROVIDER</span><span>DATE</span><span>STATUS</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading...</div>
        ) : data?.certifications?.length === 0 ? (
          <div className="py-16 text-center">
            <FileCheck2 size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No certifications found.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {data?.certifications?.map((c: any) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)} className="w-full grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_1fr_120px] gap-2 md:gap-4 px-5 py-4 border-b border-border hover:bg-background transition-colors text-left items-start md:items-center">
                <div className="text-sm font-bold w-full break-words">{c.cardName}</div>
                <div className="text-sm text-muted-foreground truncate uppercase w-full before:content-['Provider:'] before:md:hidden before:text-xs before:font-bold before:mr-2">{c.provider}</div>
                <div className="text-sm text-muted-foreground tabular-nums flex items-center gap-2 w-full before:content-['Date:'] before:md:hidden before:text-xs before:font-bold">{fmtDate(c.createdAt)}</div>
                <div className="w-full flex items-center gap-2 before:content-['Status:'] before:md:hidden before:text-xs before:font-bold">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase truncate inline-block ${
                    c.status === 'verified' ? 'bg-positive/20 text-positive border border-positive/30' :
                    c.status === 'rejected' ? 'bg-negative/20 text-negative border border-negative/30' :
                    'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                  }`}>
                    {c.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {data?.certifications?.length > 0 && (
          <div className="p-4 bg-background flex justify-between">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold disabled:opacity-50">PREV</button>
            <button onClick={() => setPage(p => p + 1)} disabled={data?.certifications?.length < 20} className="text-xs font-bold disabled:opacity-50">NEXT</button>
          </div>
        )}
      </div>

      {selectedId && <CertDetailModal id={selectedId} onClose={() => setSelectedId(null)} canManage={!!canManage} />}
      {showCreate && <CreateCertModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateCertModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCertification();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    cardId: "",
    cardName: "",
    provider: "internal",
    certificationId: "",
    evidenceSource: "",
    reason: ""
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(formData, {
      onSuccess: () => {
        toast({ title: "Certification created" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Creation failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-display text-lg font-bold">New Certification Review</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Card ID</label>
            <input required type="text" value={formData.cardId} onChange={e => setFormData({...formData, cardId: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Card Name</label>
            <input required type="text" value={formData.cardName} onChange={e => setFormData({...formData, cardName: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Provider</label>
            <select required value={formData.provider} onChange={e => setFormData({...formData, provider: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary mb-2">
              <option value="internal">Internal</option>
              <option value="psa">PSA</option>
              <option value="bgs">BGS</option>
              <option value="cgc">CGC</option>
            </select>
            {formData.provider !== "internal" && (
              <div className="text-[10px] text-muted-foreground bg-muted p-2 rounded-md">
                External provider fields are for reference and internal evidence tracking only. No provider request or automated write-back will occur.
              </div>
            )}
          </div>
          {formData.provider !== "internal" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">Provider Cert ID</label>
                <input type="text" value={formData.certificationId} onChange={e => setFormData({...formData, certificationId: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">Evidence URL</label>
                <input type="text" value={formData.evidenceSource} onChange={e => setFormData({...formData, evidenceSource: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Business Reason</label>
            <input required type="text" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <button type="submit" disabled={create.isPending} className="w-full bg-primary text-white font-bold py-2.5 rounded-lg mt-2 disabled:opacity-50">
            {create.isPending ? "Creating..." : "Create Review"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CertDetailModal({ id, onClose, canManage }: { id: string, onClose: () => void, canManage: boolean }) {
  const { data, isLoading } = useCertification(id);
  const setStatus = useCertificationStatus();
  const addNote = useCertificationNotes();
  const { toast } = useToast();

  const [statusVal, setStatusVal] = useState("");
  const [reason, setReason] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteReason, setNoteReason] = useState("");

  if (isLoading || !data?.certification) return null;

  const cert = data.certification;
  const notes = data.notes || [];
  const history = data.history || [];

  const handleUpdateStatus = () => {
    setStatus.mutate({ id, status: statusVal, reason }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        setStatusVal("");
        setReason("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to update", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleAddNote = () => {
    addNote.mutate({ id, note: noteText, reason: noteReason }, {
      onSuccess: () => {
        toast({ title: "Note added" });
        setNoteText("");
        setNoteReason("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-5 shrink-0 border-b border-border pb-4">
          <h2 className="font-display text-xl font-bold flex items-center gap-3">
            Certification Review
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cert.status === 'verified' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
              {cert.status}
            </span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={24} /></button>
        </div>

        <div className="space-y-4 overflow-y-auto pr-2">
          <div className="bg-background border border-border p-4 rounded-xl">
            <div className="text-xs text-muted-foreground font-bold uppercase mb-1">Card Reference</div>
            <div className="text-sm font-bold mb-3">{cert.cardName}</div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground font-bold uppercase mb-1">Provider</div>
                <div className="text-sm uppercase">{cert.provider}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-bold uppercase mb-1">Ext. Verification</div>
                <div className="text-sm uppercase">{cert.providerVerificationStatus}</div>
              </div>
            </div>
          </div>

          {canManage && (
            <>
              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Set Status</h4>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <select value={statusVal} onChange={e => setStatusVal(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
                    <option value="">Select status...</option>
                    <option value="under_review">Under Review</option>
                    <option value="internally_reviewed">Internally Reviewed</option>
                    <option value="verified">Verified (External Only)</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>

                {statusVal === "verified" && (cert.providerVerificationStatus !== 'completed' || !cert.externalVerifiedAt) && (
                  <div className="mb-4 text-xs text-negative bg-negative/10 border border-negative/30 p-2 rounded-lg">
                    Cannot set to Verified: Provider verification must be 'completed' and external record present.
                  </div>
                )}

                <button
                  onClick={handleUpdateStatus}
                  disabled={!statusVal || !reason || setStatus.isPending || (statusVal === "verified" && (cert.providerVerificationStatus !== 'completed' || !cert.externalVerifiedAt))}
                  className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  Update Status
                </button>
              </div>

              {history.length > 0 && (
                <div className="bg-background border border-border p-4 rounded-xl">
                  <h4 className="text-sm font-bold mb-3">Status History</h4>
                  <div className="space-y-3">
                    {history.map((h: any) => (
                      <div key={h.id} className="text-sm flex gap-3">
                        <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-0.5">{fmtDate(h.createdAt).split(',')[0]}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs uppercase">{h.fromStatus || 'none'} → {h.toStatus}</span>
                          </div>
                          {h.reason && <div className="text-xs text-muted-foreground mt-0.5">Reason: {h.reason}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Operator Notes</h4>
                {notes.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {notes.map((n: any) => (
                      <div key={n.id} className="text-xs bg-card border border-border p-2 rounded-md">
                        <span className="font-mono text-muted-foreground mr-2">{n.adminId.slice(0,8)}</span> {n.note}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Note content..." className="text-sm bg-card border border-border rounded-lg px-3 py-2 outline-none" />
                  <input type="text" value={noteReason} onChange={e => setNoteReason(e.target.value)} placeholder="Business reason for note" className="text-sm bg-card border border-border rounded-lg px-3 py-2 outline-none" />
                  <button onClick={handleAddNote} disabled={!noteText || !noteReason || addNote.isPending} className="self-end px-4 py-2 bg-secondary text-secondary-foreground text-xs font-bold rounded-lg disabled:opacity-50">Add Note</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DropsTab() {
  const { auth } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useDrops({ page, limit: 20 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const canManage = auth?.permissions.includes("drops:manage");

  if (error) return <ErrorBanner message="Failed to load drops." />;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end mb-4">
          <button onClick={() => setShowCreate(true)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
            <Plus size={16} /> Create Drop
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_1fr_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>DROP TITLE</span><span>DATE</span><span>STATUS</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading...</div>
        ) : data?.drops?.length === 0 ? (
          <div className="py-16 text-center">
            <Gift size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No drops found.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {data?.drops?.map((d: any) => (
              <button key={d.id} onClick={() => setSelectedId(d.id)} className="w-full grid grid-cols-1 md:grid-cols-[2fr_1fr_120px] gap-2 md:gap-4 px-5 py-4 border-b border-border hover:bg-background transition-colors text-left items-start md:items-center">
                <div className="text-sm font-bold w-full break-words">{d.title}</div>
                <div className="text-sm text-muted-foreground tabular-nums flex items-center gap-2 w-full before:content-['Date:'] before:md:hidden before:text-xs before:font-bold">{fmtDate(d.createdAt)}</div>
                <div className="w-full flex items-center gap-2 before:content-['Status:'] before:md:hidden before:text-xs before:font-bold">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase truncate inline-block ${
                    d.status === 'live' ? 'bg-positive/20 text-positive border border-positive/30' :
                    d.status === 'expired' || d.status === 'cancelled' ? 'bg-muted text-muted-foreground border border-border' :
                    'bg-primary/20 text-primary border border-primary/30'
                  }`}>
                    {d.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {data?.drops?.length > 0 && (
          <div className="p-4 bg-background flex justify-between">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold disabled:opacity-50">PREV</button>
            <button onClick={() => setPage(p => p + 1)} disabled={data?.drops?.length < 20} className="text-xs font-bold disabled:opacity-50">NEXT</button>
          </div>
        )}
      </div>

      {selectedId && <DropDetailModal id={selectedId} onClose={() => setSelectedId(null)} canManage={!!canManage} role={auth?.admin.role} />}
      {showCreate && <CreateDropModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateDropModal({ onClose }: { onClose: () => void }) {
  const create = useCreateDrop();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    deepLink: "",
    eligibility: "",
    imageUrl: "",
    proOnly: false,
    featured: false,
    reason: ""
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      startsAt: formData.startsAt ? new Date(formData.startsAt).toISOString() : null,
      endsAt: formData.endsAt ? new Date(formData.endsAt).toISOString() : null,
    };
    create.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Drop created" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Creation failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-display text-lg font-bold">New Verified Drop</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Title</label>
            <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Description</label>
            <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary min-h-[80px]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Starts At</label>
              <input type="datetime-local" value={formData.startsAt} onChange={e => setFormData({...formData, startsAt: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Ends At</label>
              <input type="datetime-local" value={formData.endsAt} onChange={e => setFormData({...formData, endsAt: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Deep Link</label>
              <input type="text" value={formData.deepLink} onChange={e => setFormData({...formData, deepLink: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Eligibility Rule</label>
              <input type="text" value={formData.eligibility} onChange={e => setFormData({...formData, eligibility: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Image URL</label>
            <input type="text" value={formData.imageUrl} onChange={e => setFormData({...formData, imageUrl: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.proOnly} onChange={e => setFormData({...formData, proOnly: e.target.checked})} className="accent-primary" />
              Pro Only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.featured} onChange={e => setFormData({...formData, featured: e.target.checked})} className="accent-primary" />
              Featured
            </label>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Business Reason</label>
            <input required type="text" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <button type="submit" disabled={create.isPending} className="w-full bg-primary text-white font-bold py-2.5 rounded-lg mt-2 disabled:opacity-50">
            {create.isPending ? "Creating..." : "Create Drop"}
          </button>
        </form>
      </div>
    </div>
  );
}

function DropDetailModal({ id, onClose, canManage, role }: { id: string, onClose: () => void, canManage: boolean, role?: string }) {
  const { data: detailData, isLoading } = useDrop(id);
  const drop = detailData?.drop;
  const statusHistory = detailData?.statusHistory || [];

  const setStatus = useDropStatus();
  const editDrop = useEditDrop();
  const { toast } = useToast();

  const [statusVal, setStatusVal] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");

  const [editFormData, setEditFormData] = useState({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    deepLink: "",
    eligibility: "",
    imageUrl: "",
    proOnly: false,
    featured: false
  });
  const [editReason, setEditReason] = useState("");

  useEffect(() => {
    if (drop) {
      setEditFormData({
        title: drop.title || "",
        description: drop.description || "",
        startsAt: toDateTimeLocal(drop.startsAt),
        endsAt: toDateTimeLocal(drop.endsAt),
        deepLink: drop.deepLink || "",
        eligibility: drop.eligibility || "",
        imageUrl: drop.imageUrl || "",
        proOnly: drop.proOnly || false,
        featured: drop.featured || false
      });
    }
  }, [drop]);

  if (isLoading) return <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 backdrop-blur-sm"><div className="bg-card p-6 rounded-2xl animate-pulse w-96 h-64" /></div>;
  if (!drop) return null;

  const handleUpdateStatus = () => {
    setStatus.mutate({ id, status: statusVal, reason, confirmation: confirm }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        setStatusVal("");
        setReason("");
        setConfirm("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleEdit = () => {
    const payload = {
      ...editFormData,
      startsAt: editFormData.startsAt ? new Date(editFormData.startsAt).toISOString() : null,
      endsAt: editFormData.endsAt ? new Date(editFormData.endsAt).toISOString() : null,
      reason: editReason
    };
    editDrop.mutate({ id, ...payload }, {
      onSuccess: () => {
        toast({ title: "Drop updated" });
        setEditReason("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to update", description: err.message, variant: "destructive" });
      }
    });
  };

  const requiresAuth = ["published", "live"].includes(statusVal);
  const isOwner = role === "owner";

  const getAvailableTransitions = (currentStatus: string) => {
    switch (currentStatus) {
      case "draft": return ["published", "cancelled"];
      case "published": return ["live", "cancelled"];
      case "live": return ["expired", "cancelled"];
      default: return [];
    }
  };

  const allowedTransitions = getAvailableTransitions(drop.status);

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-5 shrink-0 border-b border-border pb-4">
          <h2 className="font-display text-xl font-bold flex items-center gap-3">
            Drop Detail
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${drop.status === 'live' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
              {drop.status}
            </span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={24} /></button>
        </div>

        <div className="space-y-4 mb-6 overflow-y-auto pr-2 flex-1">
          <div className="bg-background border border-border p-4 rounded-xl">
            <div className="text-sm font-bold mb-2">{drop.title}</div>
            <div className="text-xs text-muted-foreground">{drop.description}</div>
          </div>

          {statusHistory.length > 0 && (
            <div className="bg-background border border-border p-4 rounded-xl">
              <h4 className="text-sm font-bold mb-3">Status History</h4>
              <div className="space-y-3">
                {statusHistory.map((h: any) => (
                  <div key={h.id} className="text-sm flex gap-3">
                    <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-0.5">{fmtDate(h.createdAt).split(',')[0]}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs uppercase">{h.fromStatus || 'none'} → {h.toStatus}</span>
                      </div>
                      {h.reason && <div className="text-xs text-muted-foreground mt-0.5">Reason: {h.reason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManage && (
            <>
              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Edit Drop Details</h4>
                <div className="space-y-4 mb-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Title</label>
                    <input type="text" value={editFormData.title} onChange={e => setEditFormData({...editFormData, title: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Description</label>
                    <textarea value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary min-h-[60px]" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">Starts At</label>
                      <input type="datetime-local" value={editFormData.startsAt} onChange={e => setEditFormData({...editFormData, startsAt: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">Ends At</label>
                      <input type="datetime-local" value={editFormData.endsAt} onChange={e => setEditFormData({...editFormData, endsAt: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">Deep Link</label>
                      <input type="text" value={editFormData.deepLink} onChange={e => setEditFormData({...editFormData, deepLink: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">Eligibility Rule</label>
                      <input type="text" value={editFormData.eligibility} onChange={e => setEditFormData({...editFormData, eligibility: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Image URL</label>
                    <input type="text" value={editFormData.imageUrl} onChange={e => setEditFormData({...editFormData, imageUrl: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editFormData.proOnly} onChange={e => setEditFormData({...editFormData, proOnly: e.target.checked})} className="accent-primary" />
                      Pro Only
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editFormData.featured} onChange={e => setEditFormData({...editFormData, featured: e.target.checked})} className="accent-primary" />
                      Featured
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Reason for Edit</label>
                    <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Required business reason" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                </div>
                <button
                  onClick={handleEdit}
                  disabled={!editReason || editDrop.isPending}
                  className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>

              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Set Status</h4>
                {allowedTransitions.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <select value={statusVal} onChange={e => setStatusVal(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
                        <option value="">Select transition...</option>
                        {allowedTransitions.map(t => (
                          <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                        ))}
                      </select>
                      <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>

                    {requiresAuth && !isOwner && (
                      <div className="mb-4 text-xs text-negative bg-negative/10 border border-negative/30 p-2 rounded-lg">
                        Owner access is required to publish or go live with a drop.
                      </div>
                    )}

                    {requiresAuth && isOwner && (
                      <div className="mb-4">
                        <input type="text" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type CONFIRM" className="w-full bg-card border border-amber-500/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500" />
                        <p className="text-[10px] text-muted-foreground mt-1">Requires Owner access and recent password confirmation.</p>
                      </div>
                    )}

                    <button
                      onClick={handleUpdateStatus}
                      disabled={!statusVal || !reason || setStatus.isPending || (requiresAuth && (!isOwner || confirm !== 'CONFIRM'))}
                      className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                    >
                      Update Status
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No lifecycle transitions available from '{drop.status}'.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
