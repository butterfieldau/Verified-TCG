import { useState, useEffect } from "react";
import { Calendar, Plus, X, Users, MapPin, Clock, ShieldAlert } from "lucide-react";
import { useEvents, useCreateEvent, useEditEvent, useEventLifecycle, useEventParticipants, useEventParticipantRemove, useEventParticipantRestore } from "@/hooks/use-events";
import { ErrorBanner, fmtDate } from "@/components/admin-ui";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatEventDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
}

export default function EventsPage() {
  const { auth } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const canManage = auth?.permissions.includes("events:manage");

  const { data: eventsData, isLoading, error } = useEvents({ page, limit: 20, search: debouncedSearch, status: statusFilter });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Events</h1>
          <p className="text-sm text-muted-foreground">Manage official events and monitor participation.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
            <Plus size={16} /> New Event
          </button>
        )}
      </div>

      {error && <ErrorBanner message="Failed to load events." />}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="text" placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-card border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" className="bg-card border border-border text-foreground hover:bg-muted px-4 py-2 rounded-lg text-sm font-bold transition-colors">Search</button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card border border-border h-48 rounded-xl animate-pulse" />)
        ) : eventsData?.events?.length === 0 ? (
          <div className="col-span-full py-16 text-center bg-card border border-border rounded-xl">
            <Calendar size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No events found.</p>
          </div>
        ) : (
          eventsData?.events?.map((e: any) => (
            <button key={e.id} onClick={() => setSelectedEventId(e.id)} className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary/50 transition-colors flex flex-col justify-between min-h-[200px]">
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${e.status === 'live' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
                    {e.status}
                  </span>
                  {e.featured && <span className="text-[10px] font-bold bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full">FEATURED</span>}
                </div>
                <h3 className="font-bold text-lg leading-tight mb-1">{e.name}</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <MapPin size={12} /> {e.venue}, {e.city}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock size={12} /> {formatEventDate(e.eventDate)}
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground font-bold">
                VIEW EVENT &rarr;
              </div>
            </button>
          ))
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold disabled:opacity-50">PREV</button>
        <button onClick={() => setPage(p => p + 1)} disabled={eventsData?.events?.length < 20} className="text-xs font-bold disabled:opacity-50">NEXT</button>
      </div>

      {showCreate && <CreateEventModal onClose={() => setShowCreate(false)} />}
      {selectedEventId && <EventDetailModal eventId={selectedEventId} onClose={() => setSelectedEventId(null)} canManage={!!canManage} />}
    </div>
  );
}

function CreateEventModal({ onClose }: { onClose: () => void }) {
  const create = useCreateEvent();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    venue: "",
    city: "",
    eventDate: "",
    description: "",
    address: "",
    timezone: "UTC",
    capacity: "",
    startsAt: "",
    endsAt: "",
    featured: false,
    reason: ""
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      capacity: formData.capacity ? parseInt(formData.capacity) : null,
      startsAt: formData.startsAt ? new Date(formData.startsAt).toISOString() : null,
      endsAt: formData.endsAt ? new Date(formData.endsAt).toISOString() : null,
    };
    create.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Event created" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Failed to create", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-display text-lg font-bold">Create Event</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Name</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Description</label>
            <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Venue Name</label>
              <input required type="text" value={formData.venue} onChange={e => setFormData({...formData, venue: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">City</label>
              <input required type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Full Address</label>
            <input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Event Date (Legacy)</label>
              <input required type="date" value={formData.eventDate} onChange={e => setFormData({...formData, eventDate: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Timezone</label>
              <input type="text" value={formData.timezone} onChange={e => setFormData({...formData, timezone: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
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
          <div className="grid grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Capacity</label>
              <input type="number" min="1" value={formData.capacity} onChange={e => setFormData({...formData, capacity: e.target.value})} placeholder="Unlimited" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <label className="flex items-center gap-2 text-sm mt-4">
              <input type="checkbox" checked={formData.featured} onChange={e => setFormData({...formData, featured: e.target.checked})} className="accent-primary" />
              Featured Event
            </label>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Business Reason</label>
            <input required type="text" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <button type="submit" disabled={create.isPending} className="w-full bg-primary text-white font-bold py-2.5 rounded-lg mt-2 disabled:opacity-50">
            {create.isPending ? "Creating..." : "Create Event"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EventDetailModal({ eventId, onClose, canManage }: { eventId: string, onClose: () => void, canManage: boolean }) {
  const { data: eventsData } = useEvents({ page: 1, limit: 100 });
  const event = eventsData?.events?.find((e: any) => e.id === eventId);
  const [participantPage, setParticipantPage] = useState(1);
  const { data: participantsData } = useEventParticipants(eventId, { page: participantPage, limit: 25 });

  const edit = useEditEvent();
  const lifecycle = useEventLifecycle();
  const removePart = useEventParticipantRemove();
  const restorePart = useEventParticipantRestore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"details"|"participants">("details");
  const [transitionStatus, setTransitionStatus] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [transitionConfirm, setTransitionConfirm] = useState("");

  const [editFormData, setEditFormData] = useState({
    name: "",
    venue: "",
    city: "",
    eventDate: "",
    description: "",
    address: "",
    timezone: "UTC",
    capacity: "",
    startsAt: "",
    endsAt: "",
    featured: false
  });
  const [editReason, setEditReason] = useState("");

  const [partModal, setPartModal] = useState<{ type: 'remove'|'restore', participant: any } | null>(null);
  const [partReason, setPartReason] = useState("");

  useEffect(() => {
    if (event) {
      setEditFormData({
        name: event.name || "",
        venue: event.venue || "",
        city: event.city || "",
        eventDate: event.eventDate ? event.eventDate.split('T')[0] : "",
        description: event.description || "",
        address: event.address || "",
        timezone: event.timezone || "UTC",
        capacity: event.capacity?.toString() || "",
        startsAt: toDateTimeLocal(event.startsAt),
        endsAt: toDateTimeLocal(event.endsAt),
        featured: event.featured || false
      });
    }
  }, [event]);

  if (!event) return null;

  const handleTransition = () => {
    lifecycle.mutate({ id: event.id, toStatus: transitionStatus, reason: transitionReason, confirmation: transitionConfirm }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        setTransitionStatus("");
        setTransitionReason("");
        setTransitionConfirm("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleEdit = () => {
    const payload = {
      ...editFormData,
      capacity: editFormData.capacity ? parseInt(editFormData.capacity) : null,
      startsAt: editFormData.startsAt ? new Date(editFormData.startsAt).toISOString() : null,
      endsAt: editFormData.endsAt ? new Date(editFormData.endsAt).toISOString() : null,
      reason: editReason
    };
    edit.mutate({ id: event.id, ...payload }, {
      onSuccess: () => {
        toast({ title: "Event updated" });
        setEditReason("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to update", description: err.message, variant: "destructive" });
      }
    });
  };

  const handlePartAction = () => {
    if (!partModal || !partReason) return;
    const mutation = partModal.type === 'remove' ? removePart : restorePart;
    mutation.mutate({ eventId, participantId: partModal.participant.id, reason: partReason }, {
      onSuccess: () => {
        toast({ title: `Participant ${partModal.type}d` });
        setPartModal(null);
        setPartReason("");
      },
      onError: (err: any) => {
        toast({ title: `Failed to ${partModal.type}`, description: err.message, variant: "destructive" });
      }
    });
  };

  const getAvailableTransitions = (currentStatus: string) => {
    switch (currentStatus) {
      case "draft": return ["upcoming", "cancelled"];
      case "upcoming": return ["live", "cancelled"];
      case "live": return ["completed", "paused", "cancelled"];
      case "paused": return ["live", "cancelled"];
      case "completed": return ["archived"];
      default: return [];
    }
  };

  const allowedTransitions = getAvailableTransitions(event.status);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-card border border-border rounded-2xl w-full max-w-4xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
          <div className="flex justify-between items-center mb-5 shrink-0 border-b border-border pb-4">
            <div>
              <h2 className="font-display text-xl font-bold flex items-center gap-3">
                {event.name}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${event.status === 'live' ? 'bg-positive/20 text-positive border border-positive/30' : 'bg-muted text-muted-foreground border border-border'}`}>
                  {event.status}
                </span>
              </h2>
              <div className="text-xs text-muted-foreground mt-1">{event.venue}, {event.city} • {formatEventDate(event.eventDate)}</div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={24} /></button>
          </div>

          <div className="flex gap-2 mb-4 shrink-0">
            <button onClick={() => setActiveTab("details")} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "details" ? "bg-primary text-white" : "bg-background text-muted-foreground"}`}>Lifecycle</button>
            <button onClick={() => setActiveTab("participants")} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${activeTab === "participants" ? "bg-primary text-white" : "bg-background text-muted-foreground"}`}>Participants</button>
          </div>

          <div className="overflow-y-auto flex-1 pr-2">
            {activeTab === "details" && (
              <div className="space-y-6">
                {canManage && (
                  <>
                    <div className="bg-background border border-border p-4 rounded-xl">
                      <h4 className="text-sm font-bold mb-4">Edit Event Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Name</label>
                          <input type="text" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Description</label>
                          <textarea value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary min-h-[60px]" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Venue Name</label>
                          <input type="text" value={editFormData.venue} onChange={e => setEditFormData({...editFormData, venue: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">City</label>
                          <input type="text" value={editFormData.city} onChange={e => setEditFormData({...editFormData, city: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Full Address</label>
                          <input type="text" value={editFormData.address} onChange={e => setEditFormData({...editFormData, address: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Starts At</label>
                          <input type="datetime-local" value={editFormData.startsAt} onChange={e => setEditFormData({...editFormData, startsAt: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Ends At</label>
                          <input type="datetime-local" value={editFormData.endsAt} onChange={e => setEditFormData({...editFormData, endsAt: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Event Date (Legacy)</label>
                          <input type="date" value={editFormData.eventDate} onChange={e => setEditFormData({...editFormData, eventDate: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted-foreground mb-1">Timezone</label>
                          <input type="text" value={editFormData.timezone} onChange={e => setEditFormData({...editFormData, timezone: e.target.value})} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                        </div>
                        <div className="flex items-center gap-4 md:col-span-2">
                          <div className="flex-1">
                            <label className="block text-xs font-bold text-muted-foreground mb-1">Capacity</label>
                            <input type="number" min="1" value={editFormData.capacity} onChange={e => setEditFormData({...editFormData, capacity: e.target.value})} placeholder="Unlimited" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                          </div>
                          <label className="flex items-center gap-2 text-sm mt-4">
                            <input type="checkbox" checked={editFormData.featured} onChange={e => setEditFormData({...editFormData, featured: e.target.checked})} className="accent-primary" />
                            Featured Event
                          </label>
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-muted-foreground mb-1">Reason for Edit</label>
                        <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Required business reason" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                      </div>
                      <button
                        onClick={handleEdit}
                        disabled={!editReason || edit.isPending}
                        className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                      >
                        Save Changes
                      </button>
                    </div>

                    <div className="bg-background border border-border p-4 rounded-xl">
                      <h4 className="text-sm font-bold mb-4">Change Event Status</h4>
                      {allowedTransitions.length > 0 ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <select value={transitionStatus} onChange={e => setTransitionStatus(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none">
                              <option value="">Select transition...</option>
                              {allowedTransitions.map(t => (
                                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                              ))}
                            </select>
                            <input type="text" value={transitionReason} onChange={e => setTransitionReason(e.target.value)} placeholder="Reason for change" className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
                          </div>
                          {['upcoming', 'live'].includes(transitionStatus) && (
                            <div className="mt-4">
                              <input type="text" value={transitionConfirm} onChange={e => setTransitionConfirm(e.target.value)} placeholder="Type CONFIRM" className="w-full bg-card border border-amber-500/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500" />
                              <p className="text-[10px] text-muted-foreground mt-1">This transition requires recent password confirmation.</p>
                            </div>
                          )}
                          <button
                            onClick={handleTransition}
                            disabled={!transitionStatus || !transitionReason || (['upcoming', 'live'].includes(transitionStatus) && transitionConfirm !== 'CONFIRM') || lifecycle.isPending}
                            className="mt-4 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                          >
                            Apply Status Change
                          </button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">No lifecycle transitions available from '{event.status}'.</p>
                      )}
                    </div>
                  </>
                )}

                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex gap-3">
                  <ShieldAlert className="text-amber-500 shrink-0" size={20} />
                  <div>
                    <h5 className="font-bold text-amber-500 text-sm mb-1">Attendance Verification Unavailable</h5>
                    <p className="text-xs text-amber-500/80">QR-based check-in and real-time attendance scanning are not yet built. Event participation is currently self-reported by users via the join API.</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "participants" && (
              <div className="space-y-4">
                {participantsData?.analytics && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Participation Records</div>
                      <div className="text-xl font-bold">{participantsData.analytics.totalRecords}</div>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Active</div>
                      <div className="text-xl font-bold">{participantsData.analytics.activeParticipants}</div>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Left</div>
                      <div className="text-xl font-bold">{participantsData.analytics.leftParticipants}</div>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Removed</div>
                      <div className="text-xl font-bold">{participantsData.analytics.removedParticipants}</div>
                    </div>
                  </div>
                )}
                {participantsData?.analytics?.attendanceVerification?.available === false && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
                    <span className="font-bold">Attendance verification unavailable. </span>
                    {participantsData.analytics.attendanceVerification.reason}
                  </div>
                )}
                <div className="divide-y divide-border border border-border rounded-xl bg-background">
                  {participantsData?.participants?.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">No participants registered yet.</div>
                  ) : (
                    participantsData?.participants?.map((p: any) => (
                      <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="font-bold text-sm">{p.userDisplayName || p.userId.slice(0,8)}</div>
                          <div className="text-xs text-muted-foreground">@{p.userUsername || 'unknown'}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">Joined {fmtDate(p.joinedAt)}</div>
                          {p.participationStatus === 'removed' && (
                            <div className="text-[10px] font-bold text-negative mt-1">REMOVED: {p.removalReason}</div>
                          )}
                          {p.participationStatus === 'left' && (
                            <div className="text-[10px] font-bold text-amber-500 mt-1">LEFT EVENT</div>
                          )}
                        </div>
                        {canManage && p.participationStatus !== 'removed' && (
                          <button
                            onClick={() => setPartModal({ type: 'remove', participant: p })}
                            className="shrink-0 text-xs font-bold text-negative border border-negative/30 bg-negative/10 px-3 py-1.5 rounded-lg hover:bg-negative/20 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                        {canManage && p.participationStatus === 'removed' && (
                          <button
                            onClick={() => setPartModal({ type: 'restore', participant: p })}
                            className="shrink-0 text-xs font-bold text-positive border border-positive/30 bg-positive/10 px-3 py-1.5 rounded-lg hover:bg-positive/20 transition-colors"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {participantsData && participantsData.total > participantsData.limit && (
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setParticipantPage(page => Math.max(1, page - 1))}
                      disabled={participantPage === 1}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Page {participantPage} of {Math.ceil(participantsData.total / participantsData.limit)}
                    </span>
                    <button
                      onClick={() => setParticipantPage(page => page + 1)}
                      disabled={participantPage >= Math.ceil(participantsData.total / participantsData.limit)}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {partModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold mb-2 capitalize">{partModal.type} Participant</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You are about to {partModal.type} participant {partModal.participant.userDisplayName || partModal.participant.userId.slice(0,8)}.
            </p>
            <input
              type="text"
              value={partReason}
              onChange={e => setPartReason(e.target.value)}
              placeholder="Reason (Required)"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setPartModal(null); setPartReason(""); }} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Cancel</button>
              <button
                onClick={handlePartAction}
                disabled={!partReason || removePart.isPending || restorePart.isPending}
                className={`px-4 py-2 text-white rounded-lg text-sm font-bold disabled:opacity-50 ${partModal.type === 'remove' ? 'bg-negative' : 'bg-positive'}`}
              >
                Confirm {partModal.type}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
