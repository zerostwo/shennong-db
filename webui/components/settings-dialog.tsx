"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  CircleOff,
  Copy,
  Database,
  KeyRound,
  LogOut,
  MonitorCog,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import {
  createAiProvider,
  createAgentSkill,
  deleteAiProvider,
  deleteAgentSkill,
  discoverAiProviderModels,
  issueUserToken,
  generateAgentSkill,
  listAgentSkills,
  listAiProviders,
  listAiProviderModels,
  listUserTokens,
  signOut,
  updateAgentSkill,
  updateAiProvider,
  type AiProviderRecord,
  type AgentSkillRecord,
  type JsonRecord,
} from "@/lib/api/adapter";
import { type SettingsSection } from "@/lib/settings-route";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MemoryManager } from "@/components/memory-manager";

export type { SettingsSection } from "@/lib/settings-route";
type Session = { authenticated: boolean; user_id: string; role: string } | null;

const sections = [
  ["general", "General", MonitorCog],
  ["models", "Models", Bot],
  ["skills", "Skills", Puzzle],
  ["memory", "Memory", Brain],
  ["agent-data", "Agent & Data", Database],
  ["security", "Security", ShieldCheck],
  ["tokens", "API Tokens", KeyRound],
  ["account", "Account", UserRound],
] as const;

const providerDefaults: Record<AiProviderRecord["providerType"], { baseUrl: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  deepseek: { baseUrl: "https://api.deepseek.com" },
  ollama: { baseUrl: "http://host.docker.internal:11434/v1" },
  "openai-compatible": { baseUrl: "" },
};

const providerLabels: Record<AiProviderRecord["providerType"], string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible",
};

export function SettingsDialog({ open, onOpenChange, onSectionChange, session, initialSection = "general" }: { open: boolean; onOpenChange: (open: boolean) => void; onSectionChange?: (section: SettingsSection) => void; session: Session; initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>("general");
  useEffect(() => { if (open) setSection(initialSection); }, [initialSection, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" showCloseButton>
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Configure ShennongDB workspace and account preferences.</DialogDescription>
        <aside className="settings-nav" aria-label="Settings sections">
          <h2>Settings</h2>
          {sections.map(([value, label, Icon]) => (
            <button key={value} className={section === value ? "active" : ""} onClick={() => { setSection(value); onSectionChange?.(value); }}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {section === "general" && <GeneralSettings />}
          {section === "models" && <ModelSettings authenticated={Boolean(session?.authenticated)} />}
          {section === "skills" && <SkillsSettings authenticated={Boolean(session?.authenticated)} />}
          {section === "memory" && <MemorySettings authenticated={Boolean(session?.authenticated)} />}
          {section === "agent-data" && <AgentDataSettings onClose={() => onOpenChange(false)} onModels={() => { setSection("models"); onSectionChange?.("models"); }} />}
          {section === "security" && <SecuritySettings onClose={() => onOpenChange(false)} />}
          {section === "tokens" && <TokenSettings session={session} />}
          {section === "account" && <AccountSettings session={session} onClose={() => onOpenChange(false)} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GeneralSettings() {
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  useEffect(() => {
    const saved = window.localStorage.getItem("shennong.interface-density");
    setDensity(saved === "compact" ? "compact" : "comfortable");
  }, []);
  function update(value: "comfortable" | "compact") {
    setDensity(value);
    window.localStorage.setItem("shennong.interface-density", value);
    document.documentElement.dataset.density = value;
  }
  return (
    <SettingsPanel title="General">
      <SettingRow label="Interface density">
        <div className="settings-segmented" role="group" aria-label="Interface density">
          <button className={density === "comfortable" ? "active" : ""} onClick={() => update("comfortable")}>Comfortable</button>
          <button className={density === "compact" ? "active" : ""} onClick={() => update("compact")}>Compact</button>
        </div>
      </SettingRow>
      <SettingRow label="Search shortcut"><kbd>Ctrl / ⌘ K</kbd></SettingRow>
    </SettingsPanel>
  );
}

function ModelSettings({ authenticated }: { authenticated: boolean }) {
  const [providers, setProviders] = useState<AiProviderRecord[]>([]);
  const [editing, setEditing] = useState<AiProviderRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try { setProviders(await listAiProviders()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model connections could not be loaded"); }
    finally { setLoading(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  async function remove(provider: AiProviderRecord) {
    if (!window.confirm(`Remove ${provider.name}?`)) return;
    setError("");
    try { await deleteAiProvider(provider.id); await load(); window.dispatchEvent(new Event("shennong:providers-updated")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model connection could not be removed"); }
  }
  return (
    <SettingsPanel title="Models" action={authenticated ? <button className="settings-command" onClick={() => { setEditing(null); setShowForm(true); }}><Plus />Add model</button> : undefined}>
      {!authenticated ? <SettingsEmpty title="Sign in to configure model connections." /> : loading ? <SettingsEmpty title="Loading model connections…" /> : (
        <>
          {error && <div className="settings-error" role="alert">{error}</div>}
          <div className="model-list">
            {providers.map((provider) => (
              <div className="model-row" key={provider.id}>
                <span className="model-logo"><Bot /></span>
                <span className="model-copy"><strong>{provider.name}</strong><small>{provider.providerType} · {provider.model || "No model selected"} · {provider.dataPolicy === "allow_private" ? "Private data allowed" : "Public Resources only"}</small></span>
                {provider.isDefault ? <span className="settings-status"><Check />Default</span> : null}
                <button className="settings-icon" aria-label={`Edit ${provider.name}`} onClick={() => { setEditing(provider); setShowForm(true); }}><Pencil /></button>
                <button className="settings-icon danger" aria-label={`Remove ${provider.name}`} onClick={() => void remove(provider)}><Trash2 /></button>
              </div>
            ))}
            {providers.length === 0 && !error ? <SettingsEmpty title="No model connections yet." /> : null}
          </div>
          {showForm ? <ProviderForm provider={editing} onCancel={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); window.dispatchEvent(new Event("shennong:providers-updated")); }} /> : null}
        </>
      )}
    </SettingsPanel>
  );
}

function ProviderForm({ provider, onCancel, onSaved }: { provider: AiProviderRecord | null; onCancel: () => void; onSaved: () => Promise<void> }) {
  const initialType = provider?.providerType ?? "openai";
  const [type, setType] = useState<AiProviderRecord["providerType"]>(initialType);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? providerDefaults[initialType].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>(provider?.model ? [provider.model] : []);
  const [model, setModel] = useState(provider?.model ?? "");
  const [connected, setConnected] = useState(Boolean(provider?.model));
  const [dataPolicy, setDataPolicy] = useState<AiProviderRecord["dataPolicy"]>(provider?.dataPolicy ?? "public_only");
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || !model) { setError("Connect to the provider and select a model first."); return; }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const value = {
      name: `${providerLabels[type]} · ${model}`,
      provider_kind: type,
      base_url: baseUrl.trim(),
      model: model.trim(),
      data_policy: dataPolicy,
      enabled: true,
      is_default: form.get("is_default") === "on",
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    };
    try {
      if (provider) await updateAiProvider(provider.id, value);
      else await createAiProvider(value);
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Model connection could not be saved"); }
    finally { setBusy(false); }
  }
  function changeType(value: AiProviderRecord["providerType"]) {
    setType(value);
    setBaseUrl(providerDefaults[value].baseUrl);
    setApiKey("");
    setModels([]);
    setModel("");
    setConnected(false);
    setError("");
  }
  async function connect() {
    if ((type === "openai" || type === "deepseek") && !apiKey.trim() && !(provider?.hasApiKey && provider.providerType === type && provider.baseUrl === baseUrl)) {
      setError(`Enter your ${providerLabels[type]} API key.`);
      return;
    }
    if (!baseUrl.trim()) { setError("Enter the provider base URL."); return; }
    setDiscovering(true);
    setError("");
    try {
      const canUseSavedCredential = Boolean(provider && !apiKey.trim() && provider.providerType === type && provider.baseUrl === baseUrl);
      const rows = canUseSavedCredential
        ? await listAiProviderModels(provider!.id)
        : await discoverAiProviderModels({ provider_kind: type, base_url: baseUrl.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) });
      if (!rows.length) throw new Error("The provider connected, but did not return any models.");
      setModels(rows);
      setModel((current) => rows.includes(current) ? current : rows[0]);
      setConnected(true);
    } catch (reason) {
      setConnected(false);
      setModels([]);
      setModel("");
      setError(reason instanceof Error ? reason.message : "Model list could not be loaded");
    } finally { setDiscovering(false); }
  }
  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="provider-form-heading"><h3>{provider ? "Edit model connection" : "Add model connection"}</h3><button type="button" className="settings-text-button" onClick={onCancel}>Cancel</button></div>
      <div className="provider-form-grid">
        <label className="wide">Provider<select value={type} onChange={(event) => changeType(event.target.value as AiProviderRecord["providerType"])} autoFocus><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
        {type !== "ollama" ? <label className="wide">API key<input value={apiKey} onChange={(event) => { setApiKey(event.target.value); setConnected(false); }} type="password" autoComplete="off" placeholder={provider?.hasApiKey ? "Leave blank to use the saved key" : "Paste API key"} /></label> : null}
        {type === "openai-compatible" ? <label className="wide">Base URL<input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setConnected(false); }} placeholder="https://provider.example/v1" required /></label> : null}
        <div className="provider-connect-row"><button type="button" className="settings-secondary" onClick={() => void connect()} disabled={discovering}>{discovering ? <RefreshCw className="spin" /> : connected ? <Check /> : <RefreshCw />}{discovering ? "Loading models…" : connected ? "Connected" : "Connect & load models"}</button>{connected ? <small>{models.length} model{models.length === 1 ? "" : "s"} available</small> : null}</div>
        {connected ? <label className="wide">Model<select value={model} onChange={(event) => setModel(event.target.value)} required>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label> : null}
        {connected ? <label className="wide">Data access<select value={dataPolicy} onChange={(event) => setDataPolicy(event.target.value as AiProviderRecord["dataPolicy"])}><option value="public_only">Public Resources only</option><option value="allow_private">Allow private data</option></select></label> : null}
        {connected ? <label className="provider-checkbox"><input name="is_default" type="checkbox" defaultChecked={provider?.isDefault ?? false} />Use by default</label> : null}
      </div>
      {dataPolicy === "allow_private" ? <div className="provider-policy-warning" role="note">Tool results and attachment metadata may be sent to this model provider.</div> : null}
      {error ? <div className="settings-error" role="alert">{error}</div> : null}
      <div className="provider-form-actions"><button type="button" className="settings-secondary" onClick={onCancel}>Cancel</button><button className="settings-primary" disabled={busy || discovering || !connected}>{busy ? "Saving…" : "Save model"}</button></div>
    </form>
  );
}

function SkillsSettings({ authenticated }: { authenticated: boolean }) {
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [mode, setMode] = useState<"list" | "custom" | "generate">("list");
  const [editing, setEditing] = useState<AgentSkillRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try { setSkills(await listAgentSkills()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Skills could not be loaded"); }
    finally { setLoading(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);

  async function saveCustom(event: FormEvent<HTMLFormElement>, skill?: AgentSkillRecord) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    try {
      if (skill) await updateAgentSkill(skill.id, { name, description, content, status: skill.status, change_note: "Updated in WebUI" });
      else await createAgentSkill({ name, description, content, status: "active" });
      setMode("list");
      setEditing(null);
      await load();
      window.dispatchEvent(new Event("shennong:skills-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Skill could not be saved"); }
    finally { setBusy(false); }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const lines = (name: string) => String(form.get(name) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    try {
      const skill = await generateAgentSkill({
        name: String(form.get("name") ?? "").trim() || undefined,
        goal: String(form.get("goal") ?? "").trim(),
        constraints: lines("constraints"),
        workflow: lines("workflow"),
      });
      setEditing(skill);
      setMode("list");
      await load();
      window.dispatchEvent(new Event("shennong:skills-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Skill draft could not be generated"); }
    finally { setBusy(false); }
  }

  async function changeStatus(skill: AgentSkillRecord) {
    setError("");
    try {
      await updateAgentSkill(skill.id, { name: skill.name, description: skill.description, status: skill.status === "active" ? "disabled" : "active" });
      await load();
      window.dispatchEvent(new Event("shennong:skills-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Skill status could not be updated"); }
  }

  async function remove(skill: AgentSkillRecord) {
    if (!window.confirm(`Delete ${skill.name}?`)) return;
    setError("");
    try { await deleteAgentSkill(skill.id); await load(); window.dispatchEvent(new Event("shennong:skills-updated")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Skill could not be deleted"); }
  }

  const actions = authenticated ? <div className="skill-header-actions"><button className="settings-secondary" onClick={() => { setEditing(null); setMode("generate"); }}><WandSparkles />Generate</button><button className="settings-command" onClick={() => { setEditing(null); setMode("custom"); }}><Plus />Add custom</button></div> : undefined;
  return (
    <SettingsPanel title="Skills" action={actions}>
      {!authenticated ? <SettingsEmpty title="Sign in to manage Agent Skills." /> : loading ? <SettingsEmpty title="Loading Skills…" /> : (
        <>
          {error ? <div className="settings-error" role="alert">{error}</div> : null}
          {mode === "custom" ? <SkillEditor busy={busy} onCancel={() => setMode("list")} onSubmit={(event) => void saveCustom(event)} /> : null}
          {mode === "generate" ? <SkillGenerator busy={busy} onCancel={() => setMode("list")} onSubmit={(event) => void generate(event)} /> : null}
          {editing ? <SkillEditor skill={editing} busy={busy} onCancel={() => setEditing(null)} onSubmit={(event) => void saveCustom(event, editing)} /> : null}
          {mode === "list" && !editing ? <div className="skill-list">{skills.map((skill) => <div className="skill-row" key={skill.id}><div className="skill-row-main"><span className="model-logo"><Puzzle /></span><span className="model-copy"><strong>{skill.name}</strong><small>{skill.description || "No description"}</small><small>{skill.sourceKind.replace("_", " ")} · revision {skill.revision}</small></span><span className={`skill-status ${skill.status}`}>{skill.status}</span>{!skill.isBuiltin ? <><button className="settings-icon" aria-label={`Edit ${skill.name}`} title="Edit Skill" onClick={() => setEditing(skill)}><Pencil /></button><button className="settings-icon" aria-label={`${skill.status === "active" ? "Disable" : "Activate"} ${skill.name}`} title={skill.status === "active" ? "Disable Skill" : "Activate Skill"} onClick={() => void changeStatus(skill)}>{skill.status === "active" ? <CircleOff /> : <Check />}</button><button className="settings-icon danger" aria-label={`Delete ${skill.name}`} title="Delete Skill" onClick={() => void remove(skill)}><Trash2 /></button></> : null}</div><details className="skill-instructions"><summary>View instructions</summary><pre>{skill.content}</pre></details></div>)}{skills.length === 0 && !error ? <SettingsEmpty title="No persisted Skills." /> : null}</div> : null}
        </>
      )}
    </SettingsPanel>
  );
}

function SkillEditor({ skill, busy, onCancel, onSubmit }: { skill?: AgentSkillRecord; busy: boolean; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="skill-editor" onSubmit={onSubmit}><div className="provider-form-heading"><h3>{skill ? "Edit Skill" : "Add custom Skill"}</h3><button type="button" className="settings-text-button" onClick={onCancel}>Cancel</button></div><label>Name<input name="name" defaultValue={skill?.name ?? ""} required autoFocus /></label><label>Description<input name="description" defaultValue={skill?.description ?? ""} /></label><label>Instructions (Markdown)<textarea name="content" defaultValue={skill?.content ?? ""} rows={10} required /></label><div className="provider-form-actions"><button type="button" className="settings-secondary" onClick={onCancel}>Cancel</button><button className="settings-primary" disabled={busy}>{busy ? "Saving…" : skill ? "Save revision" : "Add Skill"}</button></div></form>;
}

function SkillGenerator({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="skill-editor" onSubmit={onSubmit}><div className="provider-form-heading"><h3>Generate a Skill draft</h3><button type="button" className="settings-text-button" onClick={onCancel}>Cancel</button></div><label>Name (optional)<input name="name" autoFocus /></label><label>Goal<textarea name="goal" rows={3} required placeholder="What should this Skill help the Agent accomplish?" /></label><label>Constraints, one per line<textarea name="constraints" rows={3} /></label><label>Workflow, one step per line<textarea name="workflow" rows={4} /></label><div className="provider-form-actions"><button type="button" className="settings-secondary" onClick={onCancel}>Cancel</button><button className="settings-primary" disabled={busy}><WandSparkles />{busy ? "Generating…" : "Generate draft"}</button></div></form>;
}

function MemorySettings({ authenticated }: { authenticated: boolean }) {
  return <SettingsPanel title="Memory">{authenticated ? <MemoryManager /> : <SettingsEmpty title="Sign in to manage global memory." />}</SettingsPanel>;
}

function AgentDataSettings({ onClose, onModels }: { onClose: () => void; onModels: () => void }) {
  const [allowWrites, setAllowWrites] = useState(false);
  useEffect(() => { setAllowWrites(window.localStorage.getItem("shennong.agent-data-write") === "true"); }, []);
  function update(value: boolean) {
    setAllowWrites(value);
    window.localStorage.setItem("shennong.agent-data-write", String(value));
  }
  return (
    <SettingsPanel title="Agent & Data">
      <div className="provider-policy-note"><strong>Model data access</strong><p>Each model connection controls access independently. New connections use Public Resources only.</p><button className="settings-secondary" onClick={onModels}>Manage model policies</button></div>
      <SettingRow label="Private raw Resource registration" description="Default approval used only when a chat message includes attachments.">
        <button className={`settings-switch ${allowWrites ? "on" : ""}`} role="switch" aria-checked={allowWrites} onClick={() => update(!allowWrites)}><span /></button>
      </SettingRow>
      <div className="settings-link-list">
        <Link href="/console/uploads/new" onClick={onClose}><span><strong>Upload a dataset</strong><small>Register files with structured biomedical metadata</small></span><span>Open</span></Link>
        <Link href="/console/my-data" onClick={onClose}><span><strong>My Data</strong><small>Review your registered Resources and uploads</small></span><span>Open</span></Link>
      </div>
    </SettingsPanel>
  );
}

function SecuritySettings({ onClose }: { onClose: () => void }) {
  return (
    <SettingsPanel title="Security">
      <div className="settings-link-list">
        <Link href="/console/security" onClick={onClose}><span><strong>Password & two-factor authentication</strong></span><span>Open</span></Link>
        <Link href="/console/sessions" onClick={onClose}><span><strong>Active sessions</strong></span><span>Open</span></Link>
        <Link href="/console/login-history" onClick={onClose}><span><strong>Login history</strong></span><span>Open</span></Link>
      </div>
    </SettingsPanel>
  );
}

function TokenSettings({ session }: { session: Session }) {
  const [tokens, setTokens] = useState<JsonRecord[]>([]);
  const [issued, setIssued] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!session?.authenticated) return;
    try { setTokens((await listUserTokens(session.user_id)) as JsonRecord[]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "API tokens could not be loaded"); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);
  async function issue() {
    if (!session?.authenticated) return;
    setBusy(true);
    setError("");
    try { const result = await issueUserToken(session.user_id); setIssued(result.token); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "API token could not be issued"); }
    finally { setBusy(false); }
  }
  return (
    <SettingsPanel title="API Tokens" action={session?.authenticated ? <button className="settings-command" onClick={() => void issue()} disabled={busy}><Plus />{busy ? "Creating…" : "Create token"}</button> : undefined}>
      {!session?.authenticated ? <SettingsEmpty title="Sign in to manage API tokens." /> : (
        <>
          {issued ? <div className="issued-token"><code>{issued}</code><button className="settings-icon" aria-label="Copy new API token" onClick={() => void navigator.clipboard.writeText(issued)}><Copy /></button></div> : null}
          {error ? <div className="settings-error" role="alert">{error}</div> : null}
          <div className="token-list">{tokens.map((token, index) => <div key={String(token.token_id ?? token.id ?? index)}><span><strong>{String(token.token_id ?? token.id ?? "Token")}</strong><small>{Array.isArray(token.scopes) ? token.scopes.join(", ") : "resource.read"}</small></span><small>{token.revoked_at ? "Revoked" : "Active"}</small></div>)}{tokens.length === 0 && !error ? <SettingsEmpty title="No API tokens." /> : null}</div>
        </>
      )}
    </SettingsPanel>
  );
}

function AccountSettings({ session, onClose }: { session: Session; onClose: () => void }) {
  if (!session?.authenticated) return <SettingsPanel title="Account"><SettingsEmpty title="You are not signed in." /></SettingsPanel>;
  return (
    <SettingsPanel title="Account">
      <div className="settings-account"><span className="settings-account-avatar">{session.user_id.slice(0, 1).toUpperCase()}</span><span><strong>{session.user_id}</strong><small>{session.role}</small></span></div>
      <div className="settings-link-list"><Link href="/console/profile" onClick={onClose}><span><strong>Edit profile</strong></span><span>Open</span></Link></div>
      <button className="settings-signout" onClick={() => void signOut().then(() => { onClose(); location.assign("/"); })}><LogOut />Sign out</button>
    </SettingsPanel>
  );
}

function SettingsPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="settings-panel"><header><h2>{title}</h2>{action}</header><div className="settings-panel-body">{children}</div></section>;
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="settings-setting-row"><span><strong>{label}</strong>{description ? <small>{description}</small> : null}</span>{children}</div>;
}

function SettingsEmpty({ title }: { title: string }) { return <div className="settings-empty">{title}</div>; }
