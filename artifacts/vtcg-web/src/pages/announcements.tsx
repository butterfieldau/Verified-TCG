import { useState, useEffect } from "react";
import { Megaphone, X, FileText, Send, Edit, Plus, Clock } from "lucide-react";
import { apiFetch, apiPost, apiPatch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";

interface Announcement {
  id: string;
  title: string;
  content: string;
  audience: "all_collectors" | "pro_collectors" | "free_collectors" | "internal";
  status: "draft" | "scheduled" | "published" | "archived";
  publishedAt?: string | null;
  scheduledPublishAt?: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  authorAdminId: string;
  visibility: "staff_only" | "owner_only";
  status: "active" | "archived";
  createdAt: string;
}

interface NoteHistory {
  id: string;
  noteId: string;
  editedByAdminId: string | null;
  previousContent: string;
  createdAt: string;
}

export default function AnnouncementsPage() {
  const { auth, logout } = useAuth();
  const { toast } = useToast();
  const canManageAnnouncements = auth?.permissions.includes("announcements:manage") ?? false;
  const canReadNotes = auth?.permissions.includes("notes:read") ?? false;
  const canManageNotes = auth?.permissions.includes("notes:manage") ?? false;
  const isOwner = auth?.admin.role === "owner";
  const [activeTab, setActiveTab] = useState<"announcements" | "notes">("announcements");
  
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string;
    content: string;
    audience: Announcement["audience"];
    status: string;
    scheduledPublishAt: string;
  }>({
    title: "",
    content: "",
    audience: "all_collectors",
    status: "draft",
    scheduledPublishAt: "",
  });
  
  const [newNote, setNewNote] = useState<{
    title: string;
    content: string;
    visibility: Note["visibility"];
  }>({ title: "", content: "", visibility: "staff_only" });
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [submittingNote, setSubmittingNote] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<Note | null>(null);
  const [noteHistory, setNoteHistory] = useState<NoteHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = () => {
    setLoading(true);
    setError(null);
    if (activeTab === "announcements") {
      apiFetch<{ announcements: Announcement[] }>("/admin/governance/announcements")
        .then((data) => setAnnouncements(data.announcements || []))
        .catch((err) => {
          if (err instanceof UnauthorizedError) logout();
          else setError(err.message || "Failed to load announcements.");
        })
        .finally(() => setLoading(false));
    } else {
      apiFetch<{ notes: Note[] }>("/admin/governance/notes")
        .then((data) => setNotes(data.notes || []))
        .catch((err) => {
          if (err instanceof UnauthorizedError) logout();
          else setError(err.message || "Failed to load notes.");
        })
        .finally(() => setLoading(false));
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = !(selectedAnnouncement && selectedAnnouncement.id);
    try {
      if (isNew) {
        // Create only ever produces a draft or a scheduled announcement. Making
        // it live is a separate, explicit publish (PATCH) so nothing is ever
        // published implicitly at creation time.
        const payload: any = {
          title: editForm.title,
          content: editForm.content,
          audience: editForm.audience,
        };
        if (editForm.scheduledPublishAt) {
          payload.scheduledPublishAt = new Date(editForm.scheduledPublishAt).toISOString();
        }
        await apiPost("/admin/governance/announcements", payload);
        toast({
          title: editForm.scheduledPublishAt ? "Announcement scheduled" : "Draft created",
          description: "No push notification or email was sent to collectors.",
        });
      } else {
        const payload: any = {
          title: editForm.title,
          content: editForm.content,
          audience: editForm.audience,
          status: editForm.status,
        };
        if (editForm.scheduledPublishAt) {
          payload.scheduledPublishAt = new Date(editForm.scheduledPublishAt).toISOString();
        }
        await apiPatch(`/admin/governance/announcements/${selectedAnnouncement!.id}`, payload);
        toast({ title: "Announcement updated", description: "No push notification or email was sent to collectors." });
      }
      setSelectedAnnouncement(null);
      setIsEditing(false);
      loadData();
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
        toast({ title: "Error saving announcement", description: err.message, variant: "destructive" });
      }
    }
  };

  const handlePublish = async (id: string, currentStatus: string) => {
    try {
      setPublishingId(id);
      const newStatus = currentStatus === "published" ? "archived" : "published";
      await apiPatch(`/admin/governance/announcements/${id}`, { status: newStatus });
      toast({
        title: newStatus === "published" ? "Announcement published" : "Announcement archived",
        description: newStatus === "published"
          ? "In-app content state updated only. No push notification or email was delivered to collectors."
          : "In-app content archived. No message was delivered to collectors.",
      });
      loadData();
    } catch (err: any) {
      if (err.code !== "RECENT_AUTH_REQUIRED") {
        toast({ title: "Error changing status", description: err.message, variant: "destructive" });
      }
    } finally {
      setPublishingId(null);
    }
  };

  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.title.trim() || !newNote.content.trim()) return;
    setSubmittingNote(true);
    try {
      if (editingNote) {
        await apiPatch(`/admin/governance/notes/${editingNote.id}`, {
          title: newNote.title,
          content: newNote.content,
          visibility: newNote.visibility,
        });
        toast({ title: "Note updated" });
      } else {
        await apiPost("/admin/governance/notes", newNote);
        toast({ title: "Note added" });
      }
      setNewNote({ title: "", content: "", visibility: "staff_only" });
      setEditingNote(null);
      loadData();
    } catch (err: any) {
      toast({ title: "Error adding note", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingNote(false);
    }
  };

  const startEditingNote = (note: Note) => {
    setEditingNote(note);
    setNewNote({
      title: note.title,
      content: note.content,
      visibility: note.visibility,
    });
  };

  const archiveNote = async (note: Note) => {
    try {
      await apiPatch(`/admin/governance/notes/${note.id}`, { status: "archived" });
      toast({ title: "Note archived" });
      if (editingNote?.id === note.id) {
        setEditingNote(null);
        setNewNote({ title: "", content: "", visibility: "staff_only" });
      }
      loadData();
    } catch (err: any) {
      toast({ title: "Could not archive note", description: err.message, variant: "destructive" });
    }
  };

  const openNoteHistory = async (note: Note) => {
    setHistoryNote(note);
    setNoteHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const data = await apiFetch<{ history: NoteHistory[] }>(
        `/admin/governance/notes/${note.id}/history`,
      );
      setNoteHistory(data.history || []);
    } catch (err: any) {
      setHistoryError(err.message || "Could not load note history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1">Announcements & Governance</h1>
          <p className="text-sm text-muted-foreground">Manage public announcements and internal staff notes.</p>
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1">
          <button
            onClick={() => setActiveTab("announcements")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              activeTab === "announcements" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Announcements
          </button>
          {canReadNotes && (
            <button
              onClick={() => setActiveTab("notes")}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                activeTab === "notes" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Staff Notes
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {activeTab === "announcements" && (
        <>
          {canManageAnnouncements && (
            <div className="mb-4 flex justify-end">
              <button
                onClick={() => {
                  setEditForm({ title: "", content: "", audience: "all_collectors", status: "draft", scheduledPublishAt: "" });
                  setSelectedAnnouncement({} as Announcement);
                  setIsEditing(true);
                }}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> New Announcement
              </button>
            </div>
          )}

          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <div>
              <div className="grid grid-cols-[2fr_1fr_120px_100px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
                <span>TITLE</span><span>STATUS</span><span>PUBLISHED</span><span>ACTIONS</span>
              </div>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[2fr_1fr_120px_100px] gap-4 px-5 py-4 border-b border-border animate-pulse">
                    {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-full max-w-[100px]" />)}
                  </div>
                ))
              ) : announcements.length === 0 ? (
                <div className="py-16 text-center">
                  <Megaphone size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No announcements found.</p>
                </div>
              ) : (
                announcements.map((a) => (
                  <div key={a.id} className="grid grid-cols-[2fr_1fr_120px_100px] gap-4 px-5 py-3.5 border-b border-border items-center hover:bg-background transition-colors">
                    <button 
                      onClick={() => { setSelectedAnnouncement(a); setIsEditing(false); }}
                      className="text-left min-w-0"
                    >
                      <div className="text-sm font-bold truncate hover:text-primary">{a.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.content.slice(0, 60)}...</div>
                    </button>
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        a.status === "published" ? "bg-positive/15 text-positive border border-positive/30" :
                        a.status === "archived" ? "bg-zinc-800 text-zinc-400 border border-zinc-700" :
                        a.status === "scheduled" ? "bg-blue-500/15 text-blue-500 border border-blue-500/30" :
                        "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                      }`}>
                        {a.status}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground tabular-nums">{a.publishedAt ? fmtDate(a.publishedAt) : "-"}</div>
                    <div className="flex items-center gap-2">
                      {canManageAnnouncements ? (
                        <>
                          <button
                            onClick={() => { 
                              setSelectedAnnouncement(a); 
                              setEditForm({ 
                                title: a.title, 
                                content: a.content, 
                                 audience: a.audience,
                                status: a.status,
                                scheduledPublishAt: a.scheduledPublishAt ? new Date(a.scheduledPublishAt).toISOString().slice(0, 16) : "" 
                              }); 
                              setIsEditing(true); 
                            }}
                            className="p-1.5 text-muted-foreground hover:text-primary bg-background border border-border rounded-md"
                            title="Edit"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handlePublish(a.id, a.status)}
                            disabled={publishingId === a.id || a.status === "archived"}
                            className="p-1.5 text-muted-foreground hover:text-primary bg-background border border-border rounded-md disabled:opacity-50"
                            title={a.status === "published" ? "Archive" : "Publish (in-app only, no push/email)"}
                          >
                            {a.status === "published" ? <Clock size={14} /> : <Send size={14} />}
                          </button>
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
              Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-card" />)
            ) : announcements.length === 0 ? (
              <div className="rounded-xl border border-border bg-card py-14 text-center">
                <Megaphone size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No announcements found.</p>
              </div>
            ) : (
              announcements.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex justify-between items-start mb-2">
                    <button 
                      onClick={() => { setSelectedAnnouncement(a); setIsEditing(false); }}
                      className="text-left font-bold text-sm"
                    >
                      {a.title}
                    </button>
                    <span className={`shrink-0 ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      a.status === "published" ? "bg-positive/15 text-positive border border-positive/30" :
                      a.status === "archived" ? "bg-zinc-800 text-zinc-400 border border-zinc-700" :
                      a.status === "scheduled" ? "bg-blue-500/15 text-blue-500 border border-blue-500/30" :
                      "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                    }`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <div className="text-xs text-muted-foreground">{a.publishedAt ? fmtDate(a.publishedAt) : "Not published"}</div>
                    {canManageAnnouncements && (
                      <div className="flex gap-2">
                        <button onClick={() => { 
                          setSelectedAnnouncement(a); 
                          setEditForm({ 
                            title: a.title, 
                            content: a.content,
                             audience: a.audience,
                            status: a.status,
                            scheduledPublishAt: a.scheduledPublishAt ? new Date(a.scheduledPublishAt).toISOString().slice(0, 16) : "" 
                          }); 
                          setIsEditing(true); 
                        }} className="p-1.5 bg-background border border-border rounded-md text-muted-foreground"><Edit size={14} /></button>
                        <button disabled={publishingId === a.id || a.status === "archived"} onClick={() => handlePublish(a.id, a.status)} title={a.status === "published" ? "Archive" : "Publish (in-app only, no push/email)"} className="p-1.5 bg-background border border-border rounded-md text-muted-foreground disabled:opacity-50">{a.status === "published" ? <Clock size={14} /> : <Send size={14} />}</button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {activeTab === "notes" && (
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)
            ) : notes.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-10 text-center">
                <FileText size={32} className="mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No staff notes yet.</p>
              </div>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="bg-card border border-border rounded-xl p-4">
                   <div className="mb-2 flex items-start justify-between gap-3">
                     <div>
                       <h3 className="font-bold text-sm">{note.title}</h3>
                       <span className="mt-1 inline-flex rounded-md border border-border bg-background px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                         {note.visibility.replace("_", " ")}
                       </span>
                     </div>
                     <div className="flex gap-2">
                       <button onClick={() => openNoteHistory(note)} className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground">History</button>
                       {canManageNotes && (isOwner || note.authorAdminId === auth?.admin.id) && (
                         <>
                         <button onClick={() => startEditingNote(note)} className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground">Edit</button>
                         <button onClick={() => archiveNote(note)} className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground">Archive</button>
                         </>
                       )}
                     </div>
                   </div>
                  <p className="text-sm whitespace-pre-wrap mb-3 text-muted-foreground">{note.content}</p>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span className="font-mono text-[10px]">{note.authorAdminId}</span>
                    <span>{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {canManageNotes && (
          <div>
            <div className="bg-card border border-border rounded-xl p-4 sticky top-20">
               <div className="mb-3 flex items-center justify-between">
                 <h3 className="font-bold text-sm">{editingNote ? "Edit Note" : "Add Note"}</h3>
                 {editingNote && (
                   <button
                     type="button"
                     onClick={() => {
                       setEditingNote(null);
                       setNewNote({ title: "", content: "", visibility: "staff_only" });
                     }}
                     className="text-[10px] font-semibold text-muted-foreground"
                   >
                     Cancel edit
                   </button>
                 )}
               </div>
              <form onSubmit={handleSubmitNote} className="space-y-3">
                <input
                  type="text"
                  value={newNote.title}
                  onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                  placeholder="Note title..."
                  className="w-full bg-background border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                  required
                />
                <textarea
                  value={newNote.content}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  placeholder="Record an internal governance note..."
                  className="w-full bg-background border border-border rounded-lg p-3 text-sm min-h-[120px] outline-none focus:border-primary resize-none"
                  required
                />
                 {isOwner && (
                   <select
                     value={newNote.visibility}
                     onChange={(event) => setNewNote({ ...newNote, visibility: event.target.value as Note["visibility"] })}
                     className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
                   >
                     <option value="staff_only">Visible to authorised staff</option>
                     <option value="owner_only">Owner only</option>
                   </select>
                 )}
                <button
                  type="submit"
                  disabled={submittingNote || !newNote.title.trim() || !newNote.content.trim()}
                  className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                   {submittingNote ? "Saving..." : editingNote ? "Update Note" : "Save Note"}
                </button>
              </form>
            </div>
          </div>
          )}
        </div>
      )}

      {historyNote && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setHistoryNote(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Revision history</div>
                <h3 className="mt-1 font-bold">{historyNote.title}</h3>
              </div>
              <button onClick={() => setHistoryNote(null)} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-3 overflow-y-auto">
              {historyLoading ? (
                <div className="h-24 animate-pulse rounded-xl bg-card" />
              ) : historyError ? (
                <ErrorBanner message={historyError} />
              ) : noteHistory.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">No content revisions have been recorded.</p>
              ) : (
                noteHistory.map((revision) => (
                  <div key={revision.id} className="rounded-xl border border-border bg-card p-4">
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{revision.previousContent}</p>
                    <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{revision.editedByAdminId || "Deleted administrator"}</span>
                      <span>{fmtDate(revision.createdAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {selectedAnnouncement && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setSelectedAnnouncement(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">
                {isEditing ? (selectedAnnouncement.id ? "EDIT ANNOUNCEMENT" : "NEW ANNOUNCEMENT") : "ANNOUNCEMENT PREVIEW"}
              </span>
              <button onClick={() => setSelectedAnnouncement(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="overflow-y-auto shrink pb-4">
              {isEditing ? (
                <form id="announcement-form" onSubmit={handleSaveAnnouncement} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">TITLE</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                      required
                      placeholder="Announcement title"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1">CONTENT</label>
                    <textarea
                      value={editForm.content}
                      onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                      className="w-full bg-card border border-border rounded-lg p-3 text-sm min-h-[200px] outline-none focus:border-primary resize-y"
                      required
                      placeholder="Markdown supported..."
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">AUDIENCE</label>
                      <select
                        value={editForm.audience}
                        onChange={(e) => setEditForm({ ...editForm, audience: e.target.value as Announcement["audience"] })}
                        className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                      >
                        <option value="all_collectors">All collectors</option>
                        <option value="free_collectors">Free collectors</option>
                        <option value="pro_collectors">Pro collectors</option>
                        <option value="internal">Internal staff</option>
                      </select>
                    </div>
                    {selectedAnnouncement.id ? (
                      <div>
                        <label className="block text-xs font-bold text-muted-foreground mb-1">STATUS</label>
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                          className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                        >
                          <option value="draft">Draft</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="published">Published (in-app)</option>
                          <option value="archived">Archived</option>
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-bold text-muted-foreground mb-1">SAVES AS</label>
                        <div className="w-full bg-card border border-border rounded-lg p-3 text-sm capitalize text-muted-foreground">
                          {editForm.scheduledPublishAt ? "Scheduled" : "Draft"}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1">SCHEDULE (OPTIONAL)</label>
                      <input
                        type="datetime-local"
                        value={editForm.scheduledPublishAt}
                        onChange={(e) => setEditForm({ ...editForm, scheduledPublishAt: e.target.value })}
                        className="w-full bg-card border border-border rounded-lg p-3 text-sm outline-none focus:border-primary"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">Scheduling changes in-app visibility only. No push or email is sent.</p>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-4">{selectedAnnouncement.title}</h2>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {selectedAnnouncement.content}
                  </div>
                  
                  <div className="mt-8 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <div>Status: <strong className="uppercase">{selectedAnnouncement.status}</strong> · Audience: <strong className="uppercase">{selectedAnnouncement.audience.replace(/_/g, " ")}</strong></div>
                    {selectedAnnouncement.publishedAt && <div>Published: {new Date(selectedAnnouncement.publishedAt).toLocaleString()}</div>}
                  </div>
                </div>
              )}
            </div>
            
            {isEditing && (
              <div className="mt-4 pt-4 border-t border-border flex justify-between gap-3 shrink-0">
                <span className="text-xs text-muted-foreground self-center">Publishing updates in-app content only — no push notification or email is sent.</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedAnnouncement(null)} className="px-4 py-2 border border-border rounded-lg text-sm font-bold">Cancel</button>
                  <button type="submit" form="announcement-form" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold">Save Changes</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}