"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Database,
  KeyRound,
  LogOut,
  MonitorCog,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  createAiProvider,
  deleteAiProvider,
  issueUserToken,
  listAiProviders,
  listUserTokens,
  signOut,
  updateAiProvider,
  type AiProviderRecord,
  type JsonRecord,
} from "@/lib/api/adapter";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type SettingsSection = "general" | "models" | "agent-data" | "security" | "tokens" | "account";
type Session = { authenticated: boolean; user_id: string; role: string } | null;

const sections = [
  ["general", "General", MonitorCog],
  ["models", "Models", Bot],
  ["agent-data", "Agent & Data", Database],
  ["security", "Security", ShieldCheck],
  ["tokens", "API Tokens", KeyRound],
  ["account", "Account", UserRound],
] as const;

const providerDefaults: Record<AiProviderRecord["providerType"], { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "" },
  ollama: { baseUrl: "http://host.docker.internal:11434/v1", model: "" },
  "openai-compatible": { baseUrl: "", model: "" },
};

export function SettingsDialog({ open, onOpenChange, session, initialSection = "general" }: { open: boolean; onOpenChange: (open: boolean) => void; session: Session; initialSection?: SettingsSection }) {
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
            <button key={value} className={section === value ? "active" : ""} onClick={() => setSection(value)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {section === "general" && <GeneralSettings />}
          {section === "models" && <ModelSettings authenticated={Boolean(session?.authenticated)} />}
          {section === "agent-data" && <AgentDataSettings onClose={() => onOpenChange(false)} onModels={() => setSection("models")} />}
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
  const [model, setModel] = useState(provider?.model ?? providerDefaults[initialType].model);
  const [dataPolicy, setDataPolicy] = useState<AiProviderRecord["dataPolicy"]>(provider?.dataPolicy ?? "public_only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get("api_key") ?? "").trim();
    const value = {
      name: String(form.get("name") ?? "").trim(),
      provider_kind: type,
      base_url: baseUrl.trim(),
      model: model.trim(),
      data_policy: dataPolicy,
      enabled: true,
      is_default: form.get("is_default") === "on",
      ...(apiKey ? { api_key: apiKey } : {}),
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
    setModel(providerDefaults[value].model);
  }
  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="provider-form-heading"><h3>{provider ? "Edit model connection" : "Add model connection"}</h3><button type="button" className="settings-text-button" onClick={onCancel}>Cancel</button></div>
      <div className="provider-form-grid">
        <label>Name<input name="name" defaultValue={provider?.name ?? ""} required autoFocus /></label>
        <label>Provider<select value={type} onChange={(event) => changeType(event.target.value as AiProviderRecord["providerType"])}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
        <label className="wide">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model ID from your provider" required /></label>
        <label>API key<input name="api_key" type="password" autoComplete="off" placeholder={provider?.hasApiKey ? "Leave blank to keep current key" : type === "ollama" ? "Optional" : "Required"} /></label>
        <label className="wide">Data access<select value={dataPolicy} onChange={(event) => setDataPolicy(event.target.value as AiProviderRecord["dataPolicy"])}><option value="public_only">Public Resources only</option><option value="allow_private">Allow private data</option></select></label>
        <label className="provider-checkbox"><input name="is_default" type="checkbox" defaultChecked={provider?.isDefault ?? false} />Use by default</label>
      </div>
      {dataPolicy === "allow_private" ? <div className="provider-policy-warning" role="note">Tool results and attachment metadata may be sent to this model provider.</div> : null}
      {error ? <div className="settings-error" role="alert">{error}</div> : null}
      <div className="provider-form-actions"><button type="button" className="settings-secondary" onClick={onCancel}>Cancel</button><button className="settings-primary" disabled={busy}>{busy ? "Saving…" : "Save model"}</button></div>
    </form>
  );
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
