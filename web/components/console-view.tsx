"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, LockKeyhole, Upload, UserRound } from "lucide-react";
import { issueUserToken, ShennongApiError } from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";

const tabs = ["API access", "Profile", "Security", "Sessions", "Login history", "Uploads", "Jobs"] as const;
type Tab = (typeof tabs)[number];

export function ConsoleView() {
  const [tab, setTab] = useState<Tab>("API access");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState("Live API actions require a signed-in session.");
  const [copied, setCopied] = useState(false);

  async function createToken() {
    setMessage("Creating token…");
    try {
      const result = await issueUserToken("researcher");
      setToken(result.token);
      setMessage("Token created. It will not be shown again after leaving this page.");
    } catch (error) {
      setMessage(error instanceof ShennongApiError ? `${error.code}: ${error.message}` : "Token creation failed");
    }
  }

  return <AppShell active="tokens">
    <TopBar title="API Access" description="Manage personal tokens, usage, limits, and account security." search={false} />
    <div className="console-page">
      <div className="console-tabs" role="tablist">{tabs.map((value) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value}</button>)}</div>
      {tab === "API access" ? <div className="console-grid">
        <div className="console-panel token-panel"><SectionHeader title="Personal tokens" description="Tokens are issued by the API and shown only once." action={<button className="primary-button" onClick={() => void createToken()}><KeyRound />Create token</button>} /><p className="muted">{message}</p>{token && <div className="secret-token"><code>{token}</code><button className="outline-button" onClick={() => { void navigator.clipboard?.writeText(token); setCopied(true); }}><Copy />{copied ? "Copied" : "Copy"}</button></div>}<table className="simple-table"><thead><tr><th>Token</th><th>Scopes</th><th>Created</th><th>Status</th></tr></thead><tbody><tr><td><code>sn_live_7Yx…</code></td><td>resource.read</td><td>—</td><td><TinyBadge tone="green">API-backed</TinyBadge></td></tr></tbody></table></div>
        <div className="console-panel"><SectionHeader title="Usage" action={<TinyBadge tone="blue">Live data when signed in</TinyBadge>} /><div className="usage-placeholder"><strong>—</strong><span>Usage API is not implemented by the current Rust service.</span></div></div>
      </div> : <ConsolePanel tab={tab} />}
    </div>
  </AppShell>;
}

function ConsolePanel({ tab }: { tab: Exclude<Tab, "API access"> }) {
  const content: Record<Exclude<Tab, "API access">, { title: string; description: string; icon: typeof UserRound }> = {
    Profile: { title: "Account profile", description: "Profile editing will use the authenticated user endpoint.", icon: UserRound },
    Security: { title: "Security controls", description: "Password and two-factor enrollment require the web session API.", icon: LockKeyhole },
    Sessions: { title: "Active sessions", description: "Session revocation will be enabled with the HttpOnly session service.", icon: LockKeyhole },
    "Login history": { title: "Login history", description: "Login history is not exposed by the current Rust API.", icon: LockKeyhole },
    Uploads: { title: "Upload queue", description: "Upload endpoints are not exposed by the current Rust API.", icon: Upload },
    Jobs: { title: "Ingestion jobs", description: "Ingestion job endpoints are not exposed by the current Rust API.", icon: Upload }
  };
  const item = content[tab];
  const Icon = item.icon;
  return <div className="console-panel unsupported-panel"><Icon /><SectionHeader title={item.title} description={item.description} /><TinyBadge tone="amber">not_supported</TinyBadge></div>;
}
