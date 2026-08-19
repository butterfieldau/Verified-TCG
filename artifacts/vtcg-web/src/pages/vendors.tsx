import { useState, useEffect } from "react";
import { Store, Plus, X, Link as LinkIcon, AlertCircle } from "lucide-react";
import { useVendors, useVendor, useCreateVendor, useEditVendor, useVendorStatus, useVendorNotes, useVendorEventLink } from "@/hooks/use-vendors";
import { useEvents } from "@/hooks/use-events";
import { ErrorBanner, fmtDate } from "@/components/admin-ui";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";

export default function VendorsPage() {
  const { auth } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<any | null>(null);

  const canManage = auth?.permissions.includes("vendors:manage");

  const { data: vendorsData, isLoading, error } = useVendors({ page, limit: 20, search: debouncedSearch, status: statusFilter });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Vendors</h1>
          <p className="text-sm text-muted-foreground">Manage platform vendors and authorize their event presence.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
            <Plus size={16} /> New Vendor
          </button>
        )}
      </div>

      {error && <ErrorBanner message="Failed to load vendors." />}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
          <input type="text" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-card border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" className="bg-card border border-border text-foreground hover:bg-muted px-4 py-2 rounded-lg text-sm font-bold transition-colors">Search</button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_1fr_120px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
          <span>VENDOR</span><span>LOCATION</span><span>DATE</span><span>STATUS</span>
        </div>

        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_120px_100px] gap-4 px-5 py-4 border-b border-border animate-pulse">
              {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-full" />)}
            </div>
          ))
        ) : vendorsData?.vendors?.length === 0 ? (
          <div className="py-16 text-center">
            <Store size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="font-bold text-lg mb-1">No vendors found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Vendors are never automatically seeded or fabricated. This list only shows genuine vendor applications and authorizations.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {vendorsData?.vendors?.map((v: any) => (
              <button key={v.id} onClick={() => setSelectedVendor(v)} className="w-full grid grid-cols-1 md:grid-cols-[2fr_1fr_120px_100px] gap-2 md:gap-4 px-5 py-4 border-b border-border hover:bg-background transition-colors text-left items-start md:items-center">
                <div className="text-sm font-bold w-full break-words">
                  {v.name}
                  {v.contactEmail && <span className="font-normal text-muted-foreground ml-0 md:ml-2 block md:inline text-xs">{v.contactEmail}</span>}
                </div>
                <div className="text-sm text-muted-foreground truncate w-full">{v.location || '—'}</div>
                <div className="text-sm text-muted-foreground tabular-nums flex items-center gap-2 w-full before:content-['Date:'] before:md:hidden before:text-xs before:font-bold">{fmtDate(v.createdAt)}</div>
                <div className="w-full flex items-center gap-2 before:content-['Status:'] before:md:hidden before:text-xs before:font-bold">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase truncate inline-block ${
                    v.status === 'approved' ? 'bg-positive/20 text-positive border border-positive/30' :
                    v.status === 'suspended' ? 'bg-negative/20 text-negative border border-negative/30' :
                    v.status === 'rejected' ? 'bg-muted text-muted-foreground border border-border' :
                    'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                  }`}>
                    {v.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {vendorsData?.vendors?.length > 0 && (
          <div className="p-4 bg-background flex justify-between">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold disabled:opacity-50">PREV</button>
            <button onClick={() => setPage(p => p + 1)} disabled={vendorsData?.vendors?.length < 20} className="text-xs font-bold disabled:opacity-50">NEXT</button>
          </div>
        )}
      </div>

      {showCreate && <CreateVendorModal onClose={() => setShowCreate(false)} />}
      {selectedVendor && <VendorDetailModal vendor={selectedVendor} onClose={() => setSelectedVendor(null)} canManage={!!canManage} />}
    </div>
  );
}

function CreateVendorModal({ onClose }: { onClose: () => void }) {
  const create = useCreateVendor();
  const { toast } = useToast();
  const [formData, setFormData] = useState({ name: "", location: "", contactEmail: "", reason: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(formData, {
      onSuccess: () => {
        toast({ title: "Vendor created" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Failed to create", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-display text-lg font-bold">New Vendor Record</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Company Name</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Location</label>
            <input type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Contact Email</label>
            <input type="email" value={formData.contactEmail} onChange={e => setFormData({...formData, contactEmail: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Business Reason</label>
            <input required type="text" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} placeholder="Why is this record being created?" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <button type="submit" disabled={create.isPending} className="w-full bg-primary text-white font-bold py-2.5 rounded-lg mt-2 disabled:opacity-50">
            {create.isPending ? "Creating..." : "Create Vendor"}
          </button>
        </form>
      </div>
    </div>
  );
}

function VendorDetailModal({ vendor, onClose, canManage }: { vendor: any, onClose: () => void, canManage: boolean }) {
  const { data: detailData, isLoading } = useVendor(vendor?.id);
  const v = detailData?.vendor ?? vendor;
  const existingNotes = detailData?.notes ?? [];
  const linkedEvents = detailData?.linkedEvents ?? [];
  const statusHistory = detailData?.statusHistory ?? [];

  const setStatus = useVendorStatus();
  const linkEvent = useVendorEventLink();
  const editVendor = useEditVendor();
  const addNote = useVendorNotes();
  const { toast } = useToast();
  const { data: eventsData } = useEvents({ page: 1, limit: 50, status: "" }, { enabled: canManage });

  const [statusVal, setStatusVal] = useState("");
  const [statusReason, setStatusReason] = useState("");

  const [eventId, setEventId] = useState("");
  const [booth, setBooth] = useState("");
  const [linkReason, setLinkReason] = useState("");

  const [editData, setEditData] = useState({ name: "", location: "", contactEmail: "" });
  const [editReason, setEditReason] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteReason, setNoteReason] = useState("");

  useEffect(() => {
    if (v) {
      setEditData({
        name: v.name || "",
        location: v.location || "",
        contactEmail: v.contactEmail || ""
      });
    }
  }, [v]);

  const handleStatus = () => {
    setStatus.mutate({ id: v.id, status: statusVal, reason: statusReason }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        setStatusVal("");
        setStatusReason("");
      },
      onError: (err: any) => toast({ title: "Failed to update status", description: err.message, variant: "destructive" })
    });
  };

  const handleLink = () => {
    linkEvent.mutate({ id: v.id, eventId, booth, reason: linkReason }, {
      onSuccess: () => {
        toast({ title: "Event authorized" });
        setEventId("");
        setBooth("");
        setLinkReason("");
      },
      onError: (err: any) => toast({ title: "Failed to authorize", description: err.message, variant: "destructive" })
    });
  };

  const handleEdit = () => {
    editVendor.mutate({ id: v.id, ...editData, reason: editReason }, {
      onSuccess: () => {
        toast({ title: "Vendor updated" });
        setEditReason("");
      },
      onError: (err: any) => toast({ title: "Failed to update", description: err.message, variant: "destructive" })
    });
  };

  const handleNote = () => {
    addNote.mutate({ id: v.id, note: noteText, reason: noteReason }, {
      onSuccess: () => {
        toast({ title: "Note added" });
        setNoteText("");
        setNoteReason("");
      },
      onError: (err: any) => toast({ title: "Failed to add note", description: err.message, variant: "destructive" })
    });
  };

  const activeEvents = eventsData?.events?.filter((e: any) => e.status === "live" || e.status === "upcoming") || [];

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-5 shrink-0 border-b border-border pb-4">
          <div>
            <h2 className="font-display text-xl font-bold flex items-center gap-3">
              {v.name}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${v.status === 'approved' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
                {v.status}
              </span>
            </h2>
            <div className="text-xs text-muted-foreground mt-1">{v.location || 'No location'} • {v.contactEmail || 'No email'}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={24} /></button>
        </div>

        <div className="overflow-y-auto flex-1 pr-2 space-y-6">
          {isLoading && !detailData && (
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-border rounded-xl"></div>
              <div className="h-32 bg-border rounded-xl"></div>
            </div>
          )}

          {existingNotes.length > 0 && (
            <div className="bg-background border border-border p-4 rounded-xl">
              <h4 className="text-sm font-bold mb-3">Operator Notes</h4>
              <div className="space-y-3">
                {existingNotes.map((n: any) => (
                  <div key={n.id} className="text-sm border-l-2 border-primary pl-3">
                    <div className="text-foreground">{n.note}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      By {n.adminId} • {fmtDate(n.createdAt)} {n.reason && `• Reason: ${n.reason}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {linkedEvents.length > 0 && (
            <div className="bg-background border border-border p-4 rounded-xl">
              <h4 className="text-sm font-bold mb-3">Event Presences</h4>
              <div className="space-y-3">
                {linkedEvents.map((e: any) => (
                  <div key={e.linkId} className="text-sm flex justify-between items-center p-3 bg-card border border-border rounded-lg">
                    <div>
                      <div className="font-bold">{e.eventName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.booth ? `Booth: ${e.booth}` : 'No booth assigned'} • Linked {fmtDate(e.linkedAt)}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${e.linkStatus === 'active' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
                      {e.linkStatus}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <h4 className="text-sm font-bold mb-4">Edit Vendor Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Company Name</label>
                    <input type="text" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Location</label>
                    <input type="text" value={editData.location} onChange={e => setEditData({...editData, location: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-muted-foreground mb-1">Contact Email</label>
                    <input type="email" value={editData.contactEmail} onChange={e => setEditData({...editData, contactEmail: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-bold text-muted-foreground mb-1">Reason for Edit</label>
                  <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Required business reason" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <button
                  onClick={handleEdit}
                  disabled={!editReason || editVendor.isPending}
                  className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>

              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Vendor Status</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <select value={statusVal} onChange={e => setStatusVal(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
                    <option value="">Select status...</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="suspended">Suspended</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <input type="text" value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="Reason for change" className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <button
                  onClick={handleStatus}
                  disabled={!statusVal || !statusReason || setStatus.isPending}
                  className="mt-4 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  Apply Status Change
                </button>
              </div>

              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-1 flex items-center gap-2">
                  <LinkIcon size={16} /> Link to Event
                </h4>
                <p className="text-xs text-muted-foreground mb-4">Authorize vendor presence at a specific event.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <select value={eventId} onChange={e => setEventId(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
                    <option value="">Select event...</option>
                    {activeEvents.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.status})</option>
                    ))}
                  </select>
                  <input type="text" value={booth} onChange={e => setBooth(e.target.value)} placeholder="Booth (Optional)" className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <input type="text" value={linkReason} onChange={e => setLinkReason(e.target.value)} placeholder="Reason for linking" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary mb-4" />

                <button
                  onClick={handleLink}
                  disabled={!eventId || !linkReason || linkEvent.isPending}
                  className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                  Authorize Presence
                </button>
              </div>

              <div className="bg-background border border-border p-4 rounded-xl">
                <h4 className="text-sm font-bold mb-4">Add Note</h4>
                <div className="flex flex-col gap-2">
                  <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Note content..." className="text-sm bg-card border border-border rounded-lg px-3 py-2 outline-none" />
                  <input type="text" value={noteReason} onChange={e => setNoteReason(e.target.value)} placeholder="Business reason for note" className="text-sm bg-card border border-border rounded-lg px-3 py-2 outline-none" />
                  <button onClick={handleNote} disabled={!noteText || !noteReason || addNote.isPending} className="self-end px-4 py-2 bg-secondary text-secondary-foreground text-xs font-bold rounded-lg disabled:opacity-50">Add Note</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
