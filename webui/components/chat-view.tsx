"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  FileText,
  FolderKanban,
  LoaderCircle,
  Paperclip,
  Plus,
  Puzzle,
  Settings2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  createChatThread,
  createProjectChatThread,
  disableThreadSkill,
  enableThreadSkill,
  getChatThread,
  getPublicConfig,
  getProject,
  getSession,
  listAiProviders,
  listAgentSkills,
  listProjectChatThreads,
  listThreadSkills,
  sendChatMessage,
  uploadFile,
  type AiProviderRecord,
  type AgentSkillRecord,
  type ChatMessageRecord,
  type ChatThreadRecord,
  type ChatTokenUsage,
  type ProjectRecord,
  type ReasoningEffort,
} from "@/lib/api/adapter";
import { AppShell } from "@/components/app-shell";
import { ChatMarkdown } from "@/components/chat-markdown";

type UploadItem = {
  key: string;
  file: File;
  uploadId?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
};

export function ChatView({ threadId, projectId }: { threadId?: string; projectId?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<{ authenticated: boolean; user_id: string; role: string } | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [thread, setThread] = useState<ChatThreadRecord | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [projectThreads, setProjectThreads] = useState<ChatThreadRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [providers, setProviders] = useState<AiProviderRecord[]>([]);
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillError, setSkillError] = useState("");
  const [skillSyncing, setSkillSyncing] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [content, setContent] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [allowDataWrite, setAllowDataWrite] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [loading, setLoading] = useState(Boolean(threadId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollAnchor = useRef<HTMLDivElement>(null);

  const loadProviders = useCallback(async () => {
    try {
      const rows = await listAiProviders();
      setProviders(rows.filter((row) => row.enabled));
      setProviderId((current) => current || rows.find((row) => row.isDefault)?.id || rows.find((row) => row.enabled)?.id || "");
    } catch (reason) {
      setProviders([]);
      if (session?.authenticated) setError(reason instanceof Error ? reason.message : "Model connections could not be loaded");
    }
  }, [session?.authenticated]);

  const loadSkills = useCallback(async () => {
    if (!session?.authenticated) return;
    setSkillError("");
    try {
      const [available, selected] = await Promise.all([
        listAgentSkills(),
        threadId ? listThreadSkills(threadId) : Promise.resolve([]),
      ]);
      const active = available.filter((skill) => skill.status === "active");
      const activeIds = new Set(active.map((skill) => skill.id));
      setSkills(active);
      setSelectedSkillIds((current) => threadId ? selected.filter((skill) => skill.enabled && activeIds.has(skill.id)).map((skill) => skill.id) : current.filter((id) => activeIds.has(id)));
    } catch (reason) {
      setSkills([]);
      setSkillError(reason instanceof Error ? reason.message : "Skills could not be loaded");
    }
  }, [session?.authenticated, threadId]);

  useEffect(() => {
    setAllowDataWrite(window.localStorage.getItem("shennong.agent-data-write") === "true");
    const savedEffort = window.localStorage.getItem("shennong.reasoning-effort");
    setReasoningEffort(savedEffort === "low" || savedEffort === "high" ? savedEffort : "medium");
    void getSession().then((value) => setSession(value)).catch(() => setSession({ authenticated: false, user_id: "", role: "" }));
    void getPublicConfig().then((value) => setRegistrationOpen(value.registration_mode === "open" || value.registration_enabled === true)).catch(() => setRegistrationOpen(false));
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    void loadProviders();
    const refresh = () => void loadProviders();
    window.addEventListener("shennong:providers-updated", refresh);
    return () => window.removeEventListener("shennong:providers-updated", refresh);
  }, [loadProviders, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated) return;
    void loadSkills();
    const refresh = () => void loadSkills();
    window.addEventListener("shennong:skills-updated", refresh);
    return () => window.removeEventListener("shennong:skills-updated", refresh);
  }, [loadSkills, session?.authenticated]);

  useEffect(() => {
    if (!projectId || !session?.authenticated) { setProject(null); setProjectThreads([]); return; }
    let cancelled = false;
    void Promise.all([getProject(projectId), listProjectChatThreads(projectId)])
      .then(([projectValue, threadValues]) => { if (!cancelled) { setProject(projectValue); setProjectThreads(threadValues); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Project context could not be loaded"); });
    return () => { cancelled = true; };
  }, [projectId, session?.authenticated]);

  useEffect(() => {
    if (!threadId || !session?.authenticated) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    void getChatThread(threadId)
      .then((value) => {
        if (cancelled) return;
        if (projectId ? value.projectId !== projectId : Boolean(value.projectId)) throw new Error(projectId ? "This chat does not belong to the selected Project." : "This Project chat must be opened from its Project workspace.");
        setThread(value);
        setMessages(value.messages);
        if (value.providerId) setProviderId(value.providerId);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Chat could not be loaded"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, session?.authenticated, threadId]);

  useEffect(() => { scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (!session?.authenticated) { router.push(`/auth/sign-in?returnTo=${encodeURIComponent(chatPath(projectId, threadId))}`); return; }
    const additions = files.map((file) => ({ key: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, status: "uploading" as const }));
    setUploads((current) => [...current, ...additions]);
    await Promise.all(additions.map(async (item) => {
      try {
        const result = await uploadFile(item.file);
        const uploadId = typeof result.id === "string" ? result.id : typeof result.upload_id === "string" ? result.upload_id : "";
        if (!uploadId) throw new Error("Upload completed without an upload ID");
        setUploads((current) => current.map((row) => row.key === item.key ? { ...row, uploadId, status: "ready" } : row));
      } catch (reason) {
        setUploads((current) => current.map((row) => row.key === item.key ? { ...row, status: "error", error: reason instanceof Error ? reason.message : "Upload failed" } : row));
      }
    }));
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = content.trim();
    if (!prompt || sending) return;
    if (!session?.authenticated) { router.push(`/auth/sign-in?returnTo=${encodeURIComponent(chatPath(projectId, threadId))}`); return; }
    if (!providerId) { setError("Connect and select a model before starting an agent run."); return; }
    if (skillSyncing) { setError("Wait for the Skill selection to finish saving."); return; }
    if (uploads.some((item) => item.status === "uploading")) { setError("Wait for the attachments to finish uploading."); return; }
    const failed = uploads.find((item) => item.status === "error");
    if (failed) { setError(failed.error ?? `${failed.file.name} could not be uploaded`); return; }
    setSending(true);
    setError("");
    let activeThread = thread;
    let createdThread = false;
    try {
      if (!activeThread) {
        activeThread = projectId
          ? await createProjectChatThread(projectId, { title: prompt.slice(0, 72), provider_id: providerId })
          : await createChatThread({ title: prompt.slice(0, 72), provider_id: providerId });
        createdThread = true;
        setThread(activeThread);
      }
      if (selectedSkillIds.length) await Promise.all(selectedSkillIds.map((skillId) => enableThreadSkill(activeThread!.id, skillId)));
      if (createdThread) {
        router.replace(chatPath(projectId, activeThread.id));
        window.dispatchEvent(new Event("shennong:threads-updated"));
      }
      const optimistic: ChatMessageRecord = {
        id: `pending-${crypto.randomUUID()}`,
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
        attachments: uploads.map((item) => ({ id: item.uploadId, filename: item.file.name, size: item.file.size })),
        toolEvents: [],
        citations: [],
        reasoning: "",
        usage: null,
        raw: {},
      };
      setMessages((current) => [...current, optimistic]);
      setContent("");
      const uploadIds = uploads.flatMap((item) => item.uploadId ? [item.uploadId] : []);
      setUploads([]);
      const assistant = await sendChatMessage(activeThread.id, {
        content: prompt,
        provider_id: providerId,
        upload_ids: uploadIds,
        allow_data_write: allowDataWrite,
        reasoning_effort: reasoningEffort,
      });
      try {
        const refreshed = await getChatThread(activeThread.id);
        setThread(refreshed);
        setMessages(refreshed.messages.length ? refreshed.messages : (current) => [...current.filter((item) => item.id !== optimistic.id), optimistic, assistant]);
      } catch {
        setMessages((current) => [...current, assistant]);
      }
      window.dispatchEvent(new Event("shennong:threads-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The agent run failed");
      if (activeThread) {
        void getChatThread(activeThread.id).then((value) => { setThread(value); setMessages(value.messages); }).catch(() => undefined);
      }
    } finally { setSending(false); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  }

  async function toggleSkill(skillId: string, enabled: boolean) {
    const previous = selectedSkillIds;
    setSelectedSkillIds((current) => enabled ? Array.from(new Set([...current, skillId])) : current.filter((id) => id !== skillId));
    const activeThreadId = thread?.id ?? threadId;
    if (!activeThreadId) return;
    setSkillSyncing(true);
    setSkillError("");
    try {
      if (enabled) await enableThreadSkill(activeThreadId, skillId);
      else await disableThreadSkill(activeThreadId, skillId);
    } catch (reason) {
      setSelectedSkillIds(previous);
      setSkillError(reason instanceof Error ? reason.message : "Skill selection could not be saved");
    } finally { setSkillSyncing(false); }
  }

  const provider = providers.find((row) => row.id === providerId);
  const hasConversation = messages.length > 0 || loading || Boolean(threadId);
  const conversationUsage = useMemo(() => messages.reduce<ChatTokenUsage>((total, message) => ({
    inputTokens: total.inputTokens + (message.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (message.usage?.outputTokens ?? 0),
    reasoningTokens: total.reasoningTokens + (message.usage?.reasoningTokens ?? 0),
    totalTokens: total.totalTokens + (message.usage?.totalTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }), [messages]);
  return (
    <AppShell active="chat">
      <div className={`chat-workspace ${hasConversation ? "has-conversation" : "empty-conversation"}`}>
        <header className="chat-header">
          <button className="chat-model-button" onClick={() => window.dispatchEvent(new CustomEvent("shennong:open-settings", { detail: "models" }))}>
            <span>{provider?.name ?? "Shennong Agent"}</span><ChevronDown />
          </button>
          {projectId ? <Link className="chat-project-context" href={`/projects/${encodeURIComponent(projectId)}`} title="Back to Project workspace"><FolderKanban /><span>{project?.name ?? "Project"}</span></Link> : null}
          {thread?.title ? <span className="chat-thread-title">{thread.title}</span> : null}
          {conversationUsage.totalTokens > 0 ? <TokenUsage usage={conversationUsage} conversation /> : null}
        </header>
        <div className="chat-main">
          {!hasConversation ? (
            <div className="chat-empty">
              <div className="chat-empty-mark"><Sparkles /></div>
              <h1>{projectId ? `What should we analyze in ${project?.name ?? "this Project"}?` : "What can I help you analyze?"}</h1>
              <p>{projectId ? "This chat uses the Project's data, active Project Memory, and your global Memory." : "Ask about governed Resources, or attach biomedical data for the agent to inspect."}</p>
              {!session?.authenticated ? <div className="chat-auth-actions"><Link href="/auth/sign-in" className="chat-primary-action">Sign in</Link>{registrationOpen ? <Link href="/auth/sign-in?mode=register" className="chat-secondary-action">Create account</Link> : null}</div> : null}
              {projectId && projectThreads.length > 0 ? <div className="project-chat-history"><strong>Recent Project chats</strong>{projectThreads.slice(0, 5).map((item) => <Link href={chatPath(projectId, item.id)} key={item.id}><span>{item.title}</span><small>{formatChatDate(item.updatedAt)}</small></Link>)}</div> : null}
            </div>
          ) : (
            <div className="chat-message-list" aria-live="polite">
              {loading ? <div className="chat-loading"><LoaderCircle />Loading chat…</div> : null}
              {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
              {sending ? <div className="assistant-message agent-working"><span className="assistant-avatar"><Bot /></span><div><LoaderCircle />Agent is working…</div></div> : null}
              <div ref={scrollAnchor} />
            </div>
          )}
          <div className="chat-composer-wrap">
            <form className="chat-composer" onSubmit={(event) => void submit(event)}>
              {uploads.length > 0 ? <div className="chat-attachments">{uploads.map((item) => <div className={`chat-attachment ${item.status}`} key={item.key}><FileText /><span><strong>{item.file.name}</strong><small>{item.status === "uploading" ? "Uploading…" : item.status === "ready" ? formatBytes(item.file.size) : item.error}</small></span><button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => setUploads((current) => current.filter((row) => row.key !== item.key))}><X /></button></div>)}</div> : null}
              <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={handleKeyDown} placeholder={projectId ? `Ask about ${project?.name ?? "this Project"}` : "Ask ShennongDB"} rows={1} aria-label="Message ShennongDB agent" />
              <div className="chat-composer-toolbar">
                <button type="button" className="chat-tool-button" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Plus /></button>
                <input ref={fileInput} type="file" multiple hidden onChange={(event) => void chooseFiles(event)} />
                {uploads.length > 0 ? <label className="chat-write-control"><input type="checkbox" checked={allowDataWrite} onChange={(event) => { setAllowDataWrite(event.target.checked); window.localStorage.setItem("shennong.agent-data-write", String(event.target.checked)); }} />Allow registration as a private raw Resource</label> : null}
                <div className="chat-toolbar-spacer" />
                <details className="chat-skill-selector"><summary aria-label={`${selectedSkillIds.length} Skills selected`}><Puzzle /><span>Skills</span>{selectedSkillIds.length ? <small>{selectedSkillIds.length}</small> : null}<ChevronDown /></summary><div className="chat-skill-menu"><strong>Skills for this chat</strong>{skillError ? <p role="alert">{skillError}</p> : null}{skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={selectedSkillIds.includes(skill.id)} disabled={skillSyncing} onChange={(event) => void toggleSkill(skill.id, event.target.checked)} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></label>)}{skills.length === 0 && !skillError ? <p>No active Skills.</p> : null}<button type="button" onClick={() => window.dispatchEvent(new CustomEvent("shennong:open-settings", { detail: "skills" }))}><Settings2 />Manage Skills</button></div></details>
                <label className="chat-reasoning-select" title="Reasoning effort"><Brain /><select value={reasoningEffort} onChange={(event) => { const value = event.target.value as ReasoningEffort; setReasoningEffort(value); window.localStorage.setItem("shennong.reasoning-effort", value); }} aria-label="Reasoning effort"><option value="low">Low reasoning</option><option value="medium">Medium reasoning</option><option value="high">High reasoning</option></select></label>
                <label className="chat-provider-select"><Bot /><select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label="Agent model"><option value="">Select model</option>{providers.map((row) => <option value={row.id} key={row.id}>{row.name} · {row.model}</option>)}</select></label>
                <button className="chat-send" aria-label="Send message" disabled={!content.trim() || sending || skillSyncing || uploads.some((item) => item.status === "uploading")}><ArrowUp /></button>
              </div>
            </form>
            {error ? <div className="chat-error" role="alert"><CircleAlert />{error}{!providerId ? <button onClick={() => window.dispatchEvent(new CustomEvent("shennong:open-settings", { detail: "models" }))}><Settings2 />Open Settings</button> : null}</div> : null}
            <p className="chat-disclaimer">Agent responses include tool activity and data citations when available.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ChatMessage({ message }: { message: ChatMessageRecord }) {
  if (message.role === "user") return (
    <article className="user-message">
      {message.attachments.length > 0 ? <div className="message-attachment-list">{message.attachments.map((item, index) => <span key={String(item.id ?? index)}><Paperclip />{String(item.filename ?? item.name ?? "Attachment")}</span>)}</div> : null}
      <div>{message.content}</div>
    </article>
  );
  if (message.role === "tool") return <ToolEvents events={message.toolEvents.length ? message.toolEvents : [{ id: message.id, name: "Agent tool", status: "completed", summary: message.content }]} />;
  return (
    <article className="assistant-message">
      <span className="assistant-avatar"><Bot /></span>
      <div className="assistant-body">
        {message.toolEvents.length > 0 ? <ToolEvents events={message.toolEvents} /> : null}
        {message.reasoning ? <ReasoningBlock content={message.reasoning} /> : null}
        {message.content ? <ChatMarkdown className="assistant-copy">{message.content}</ChatMarkdown> : null}
        {message.citations.length > 0 ? <div className="chat-citations"><strong>Sources</strong><div>{message.citations.map((citation) => citation.resourceId ? <Link href={`/resources?resource=${encodeURIComponent(citation.resourceId)}`} key={citation.id}><Database />{citation.label}</Link> : <span key={citation.id}><FileText />{citation.label}{citation.locator ? ` · ${citation.locator}` : ""}</span>)}</div></div> : null}
        {message.usage ? <TokenUsage usage={message.usage} /> : null}
      </div>
    </article>
  );
}

function ReasoningBlock({ content }: { content: string }) {
  return <details className="chat-reasoning"><summary><Brain /><strong>Thinking</strong><span>Show reasoning</span><ChevronDown /></summary><ChatMarkdown>{content}</ChatMarkdown></details>;
}

function TokenUsage({ usage, conversation = false }: { usage: ChatTokenUsage; conversation?: boolean }) {
  const label = `${formatTokens(usage.totalTokens)} tokens`;
  const details = `${formatTokens(usage.inputTokens)} input · ${formatTokens(usage.outputTokens)} output${usage.reasoningTokens ? ` · ${formatTokens(usage.reasoningTokens)} reasoning` : ""}`;
  return <span className={conversation ? "chat-token-usage conversation" : "chat-token-usage"} title={details} aria-label={`${conversation ? "Conversation" : "Message"} usage: ${label}; ${details}`}>{label}{usage.reasoningTokens ? <small>{formatTokens(usage.reasoningTokens)} thinking</small> : null}</span>;
}

function ToolEvents({ events }: { events: ChatMessageRecord["toolEvents"] }) {
  return <div className="tool-event-list">{events.map((event) => <details className="tool-event" key={event.id}><summary><span className={event.status === "failed" ? "failed" : "complete"}>{event.status === "failed" ? <CircleAlert /> : <CheckCircle2 />}</span><Wrench /><strong>{event.name}</strong>{event.summary ? <small>{event.summary}</small> : null}</summary>{event.input !== undefined ? <JsonBlock label="Input" value={event.input} /> : null}{event.output !== undefined ? <JsonBlock label="Result" value={event.output} /> : null}</details>)}</div>;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return <div className="tool-json"><strong>{label}</strong><pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></div>;
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function chatPath(projectId?: string, threadId?: string) {
  if (projectId) {
    const base = `/projects/${encodeURIComponent(projectId)}/chat`;
    return threadId ? `${base}/${encodeURIComponent(threadId)}` : base;
  }
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/";
}

function formatChatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
