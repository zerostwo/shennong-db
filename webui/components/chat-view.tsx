"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Settings2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  createChatThread,
  getChatThread,
  getPublicConfig,
  getSession,
  listAiProviders,
  sendChatMessage,
  uploadFile,
  type AiProviderRecord,
  type ChatMessageRecord,
  type ChatThreadRecord,
} from "@/lib/api/adapter";
import { AppShell } from "@/components/app-shell";

type UploadItem = {
  key: string;
  file: File;
  uploadId?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
};

export function ChatView({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<{ authenticated: boolean; user_id: string; role: string } | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [thread, setThread] = useState<ChatThreadRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [providers, setProviders] = useState<AiProviderRecord[]>([]);
  const [providerId, setProviderId] = useState("");
  const [content, setContent] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [allowDataWrite, setAllowDataWrite] = useState(false);
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

  useEffect(() => {
    setAllowDataWrite(window.localStorage.getItem("shennong.agent-data-write") === "true");
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
    if (!threadId || !session?.authenticated) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    void getChatThread(threadId)
      .then((value) => {
        if (cancelled) return;
        setThread(value);
        setMessages(value.messages);
        if (value.providerId) setProviderId(value.providerId);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Chat could not be loaded"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session?.authenticated, threadId]);

  useEffect(() => { scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (!session?.authenticated) { router.push(`/auth/sign-in?returnTo=${encodeURIComponent(threadId ? `/chat/${threadId}` : "/")}`); return; }
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
    if (!session?.authenticated) { router.push(`/auth/sign-in?returnTo=${encodeURIComponent(threadId ? `/chat/${threadId}` : "/")}`); return; }
    if (!providerId) { setError("Connect and select a model before starting an agent run."); return; }
    if (uploads.some((item) => item.status === "uploading")) { setError("Wait for the attachments to finish uploading."); return; }
    const failed = uploads.find((item) => item.status === "error");
    if (failed) { setError(failed.error ?? `${failed.file.name} could not be uploaded`); return; }
    setSending(true);
    setError("");
    let activeThread = thread;
    try {
      if (!activeThread) {
        activeThread = await createChatThread({ title: prompt.slice(0, 72), provider_id: providerId });
        setThread(activeThread);
        router.replace(`/chat/${encodeURIComponent(activeThread.id)}`);
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

  const provider = providers.find((row) => row.id === providerId);
  const hasConversation = messages.length > 0 || loading || Boolean(threadId);
  return (
    <AppShell active="chat">
      <div className={`chat-workspace ${hasConversation ? "has-conversation" : "empty-conversation"}`}>
        <header className="chat-header">
          <button className="chat-model-button" onClick={() => window.dispatchEvent(new CustomEvent("shennong:open-settings", { detail: "models" }))}>
            <span>{provider?.name ?? "Shennong Agent"}</span><ChevronDown />
          </button>
          {thread?.title ? <span className="chat-thread-title">{thread.title}</span> : null}
        </header>
        <div className="chat-main">
          {!hasConversation ? (
            <div className="chat-empty">
              <div className="chat-empty-mark"><Sparkles /></div>
              <h1>What can I help you analyze?</h1>
              <p>Ask about governed Resources, or attach biomedical data for the agent to inspect.</p>
              {!session?.authenticated ? <div className="chat-auth-actions"><Link href="/auth/sign-in" className="chat-primary-action">Sign in</Link>{registrationOpen ? <Link href="/auth/sign-in?mode=register" className="chat-secondary-action">Create account</Link> : null}</div> : null}
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
              <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask ShennongDB" rows={1} aria-label="Message ShennongDB agent" />
              <div className="chat-composer-toolbar">
                <button type="button" className="chat-tool-button" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Plus /></button>
                <input ref={fileInput} type="file" multiple hidden onChange={(event) => void chooseFiles(event)} />
                {uploads.length > 0 ? <label className="chat-write-control"><input type="checkbox" checked={allowDataWrite} onChange={(event) => { setAllowDataWrite(event.target.checked); window.localStorage.setItem("shennong.agent-data-write", String(event.target.checked)); }} />Allow registration as a private raw Resource</label> : null}
                <div className="chat-toolbar-spacer" />
                <label className="chat-provider-select"><Bot /><select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label="Agent model"><option value="">Select model</option>{providers.map((row) => <option value={row.id} key={row.id}>{row.name} · {row.model}</option>)}</select></label>
                <button className="chat-send" aria-label="Send message" disabled={!content.trim() || sending || uploads.some((item) => item.status === "uploading")}><ArrowUp /></button>
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
        {message.content ? <div className="assistant-copy">{message.content}</div> : null}
        {message.citations.length > 0 ? <div className="chat-citations"><strong>Sources</strong><div>{message.citations.map((citation) => citation.resourceId ? <Link href={`/resources?resource=${encodeURIComponent(citation.resourceId)}`} key={citation.id}><Database />{citation.label}</Link> : <span key={citation.id}><FileText />{citation.label}{citation.locator ? ` · ${citation.locator}` : ""}</span>)}</div></div> : null}
      </div>
    </article>
  );
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
