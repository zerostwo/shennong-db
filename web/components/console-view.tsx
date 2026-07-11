"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, LockKeyhole, Upload, UserRound } from "lucide-react";
import { getSession, issueUserToken, listUserTokens, ShennongApiError } from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";

const tabs = ["API access", "Profile", "Security", "Sessions", "Login history", "Uploads", "Jobs"] as const;
type Tab = (typeof tabs)[number];

export function ConsoleView() {
  const [tab, setTab] = useState<Tab>("API access");
  const [token, setToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<unknown[]>([]);
  const [message, setMessage] = useState("Live API actions require a signed-in session.");
  const [copied, setCopied] = useState(false);

  useEffect(() => { void getSession().then((session) => session.authenticated ? listUserTokens(session.user_id).then(setTokens) : undefined).catch(() => undefined); }, []);

  async function createToken() {
    setMessage("Creating token…");
    try {
      const session = await getSession();
      if (!session.authenticated) throw new Error("Sign in before creating a token.");
      const issued = await issueUserToken(session.user_id);
      setToken(issued.token);
      setTokens(await listUserTokens(session.user_id));
      setMessage("Token created. It will not be shown again after leaving this page.");
    } catch (reason) {
      setMessage(reason instanceof ShennongApiError || reason instanceof Error ? reason.message : "Token creation failed");
    }
  }

  return <AppShell active="tokens"><TopBar title="API Access" description="Manage personal tokens and account security." search={false} /><div className="console-page">
    <div className="console-tabs" role="tablist">{tabs.map((value) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value}</button>)}</div>
    {tab === "API access" ? <div className="console-grid"><div className="console-panel token-panel"><SectionHeader title="Personal tokens" description="Tokens are issued by the API and shown only once." action={<button className="primary-button" onClick={() => void createToken()}><KeyRound />Create token</button>} /><p className="muted">{message}</p>{token && <div className="secret-token"><code>{token}</code><button className="outline-button" onClick={() => { void navigator.clipboard?.writeText(token); setCopied(true); }}><Copy />{copied ? "Copied" : "Copy"}</button></div>}<table className="simple-table"><thead><tr><th>Token</th><th>Details</th><th>Status</th></tr></thead><tbody>{tokens.map((item, index) => { const value = item as Record<string, unknown>; return <tr key={String(value.id ?? index)}><td><code>{String(value.id ?? "—")}</code></td><td><code>{JSON.stringify(value)}</code></td><td><TinyBadge tone="green">API-backed</TinyBadge></td></tr>; })}</tbody></table>{tokens.length === 0 && <p className="muted">No tokens returned by the API.</p>}</div><div className="console-panel"><SectionHeader title="Usage" action={<TinyBadge tone="amber">not_supported</TinyBadge>} /><div className="usage-placeholder"><strong>—</strong><span>Usage metrics are not exposed by the Rust API.</span></div></div></div> : <ConsolePanel tab={tab} />}
  </div></AppShell>;
}

function ConsolePanel({ tab }: { tab: Exclude<Tab, "API access"> }) {
  const content: Record<Exclude<Tab, "API access">, { title: string; description: string; icon: typeof UserRound }> = {
    Profile: { title: "Account profile", description: "Profile editing is not exposed by the current Rust API.", icon: UserRound },
    Security: { title: "Security controls", description: "Password and 2FA enrollment are not exposed by the current Rust API.", icon: LockKeyhole },
    Sessions: { title: "Active sessions", description: "Session listing is not exposed by the current Rust API.", icon: LockKeyhole },
    "Login history": { title: "Login history", description: "Login history is not exposed by the current Rust API.", icon: LockKeyhole },
    Uploads: { title: "Upload queue", description: "Upload endpoints are not exposed by the current Rust API.", icon: Upload },
    Jobs: { title: "Ingestion jobs", description: "Ingestion job endpoints are not exposed by the current Rust API.", icon: Upload }
  };
  const item = content[tab]; const Icon = item.icon;
  return <div className="console-panel unsupported-panel"><Icon /><SectionHeader title={item.title} description={item.description} /><TinyBadge tone="amber">not_supported</TinyBadge></div>;
}
