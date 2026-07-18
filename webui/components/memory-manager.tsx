"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, Brain, Pencil, Plus, RotateCcw } from "lucide-react";
import {
  archiveAgentMemory,
  createGlobalMemory,
  createProjectMemory,
  listGlobalMemories,
  listProjectMemories,
  updateAgentMemory,
  type AgentMemoryRecord,
} from "@/lib/api/adapter";
import { ChatMarkdown } from "@/components/chat-markdown";

export function MemoryManager({ projectId }: { projectId?: string }) {
  const [memories, setMemories] = useState<AgentMemoryRecord[]>([]);
  const [editing, setEditing] = useState<AgentMemoryRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setMemories(projectId ? await listProjectMemories(projectId) : await listGlobalMemories()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Memories could not be loaded"); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, memory?: AgentMemoryRecord) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    try {
      if (memory) await updateAgentMemory(memory.id, { title, status: memory.status, content, change_note: "Updated in WebUI" });
      else if (projectId) await createProjectMemory(projectId, { title, content, source_kind: "manual" });
      else await createGlobalMemory({ title, content, source_kind: "manual" });
      setCreating(false);
      setEditing(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Memory could not be saved"); }
    finally { setBusy(false); }
  }

  async function archive(memory: AgentMemoryRecord) {
    setError("");
    try { await archiveAgentMemory(memory.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Memory could not be archived"); }
  }

  async function restore(memory: AgentMemoryRecord) {
    setError("");
    try { await updateAgentMemory(memory.id, { title: memory.title, status: "active" }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Memory could not be restored"); }
  }

  return (
    <div className="memory-manager">
      <div className="memory-toolbar"><p>{projectId ? "Only chats in this Project receive these active memories." : "Active global memories are available across your chats and Projects."}</p><button className="settings-command" onClick={() => { setEditing(null); setCreating(true); }}><Plus />Add memory</button></div>
      {error ? <div className="settings-error" role="alert">{error}</div> : null}
      {creating ? <MemoryEditor busy={busy} onCancel={() => setCreating(false)} onSubmit={(event) => void save(event)} /> : null}
      {editing ? <MemoryEditor memory={editing} busy={busy} onCancel={() => setEditing(null)} onSubmit={(event) => void save(event, editing)} /> : null}
      {loading ? <div className="settings-empty">Loading memories…</div> : !creating && !editing ? <div className="memory-list">{memories.map((memory) => <article className={`memory-row ${memory.status}`} key={memory.id}><header><span className="memory-icon"><Brain /></span><span><strong>{memory.title}</strong><small>{memory.sourceKind} · revision {memory.revision}</small></span><span className="memory-status">{memory.status}</span><button className="settings-icon" aria-label={`Edit ${memory.title}`} title="Edit memory" onClick={() => setEditing(memory)}><Pencil /></button>{memory.status === "active" ? <button className="settings-icon" aria-label={`Archive ${memory.title}`} title="Archive memory" onClick={() => void archive(memory)}><Archive /></button> : <button className="settings-icon" aria-label={`Restore ${memory.title}`} title="Restore memory" onClick={() => void restore(memory)}><RotateCcw /></button>}</header><ChatMarkdown>{memory.content}</ChatMarkdown></article>)}{memories.length === 0 && !error ? <div className="settings-empty">No persisted memories in this scope.</div> : null}</div> : null}
    </div>
  );
}

function MemoryEditor({ memory, busy, onCancel, onSubmit }: { memory?: AgentMemoryRecord; busy: boolean; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="skill-editor memory-editor" onSubmit={onSubmit}><div className="provider-form-heading"><h3>{memory ? "Edit memory" : "Add memory"}</h3><button type="button" className="settings-text-button" onClick={onCancel}>Cancel</button></div><label>Title<input name="title" defaultValue={memory?.title ?? ""} required autoFocus /></label><label>Memory (Markdown)<textarea name="content" defaultValue={memory?.content ?? ""} rows={9} required /></label><div className="provider-form-actions"><button type="button" className="settings-secondary" onClick={onCancel}>Cancel</button><button className="settings-primary" disabled={busy}>{busy ? "Saving…" : memory ? "Save revision" : "Add memory"}</button></div></form>;
}
