"use client";

import { useEffect, useState } from "react";
import { Database, FileText, ShieldCheck, Users } from "lucide-react";
import { getHealth, installProvider, listAuditEvents, listProviders, listUsers, type ApiError, ShennongApiError } from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";

type Section = "dashboard" | "users" | "settings" | "grants" | "providers" | "storage" | "monitoring" | "audit" | "backups";
const copy: Record<Section, { title: string; description: string }> = {
  dashboard: { title: "Dashboard", description: "Live backend readiness and governance status." },
  users: { title: "Users", description: "Manage users, roles, sessions, and account state." },
  settings: { title: "System Settings", description: "Instance settings require a dedicated configuration API." },
  grants: { title: "Grants", description: "Review and manage resource access grants." },
  providers: { title: "Providers", description: "Inspect registered provider manifests and versions." },
  storage: { title: "Storage", description: "Review artifact storage backends and lifecycle state." },
  monitoring: { title: "Monitoring", description: "Check service health and operational readiness." },
  audit: { title: "Audit", description: "Review security and governance events." },
  backups: { title: "Backups", description: "Backup orchestration is not exposed by the current API." }
};

export function AdminSectionView({ section }: { section: Section }) {
  const [rows, setRows] = useState<unknown[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    const load = section === "monitoring" || section === "dashboard" ? getHealth() : section === "providers" ? listProviders() : section === "users" ? listUsers() : section === "audit" ? listAuditEvents() : Promise.resolve([]);
    void load.then((value) => { if (section === "monitoring" || section === "dashboard") setHealth(value as Record<string, unknown>); else setRows(value as unknown[]); }).catch((reason: unknown) => setError(reason instanceof ShennongApiError ? reason : { code: "request_failed", message: reason instanceof Error ? reason.message : "Request failed" }));
  }, [section]);
  const heading = copy[section];
  return <AppShell variant="admin" active={section}><TopBar title={heading.title} description={heading.description} search={false} /><div className="admin-page"><div className="admin-panel"><SectionHeader title={heading.title} action={<TinyBadge tone={error ? "amber" : "green"}>{error ? error.code : section === "settings" ? "not_supported" : "API-backed"}</TinyBadge>} />{error ? <div className="empty-state"><ShieldCheck /><h3>{error.message}</h3><p>Internal details are intentionally hidden from the UI.</p></div> : section === "monitoring" || section === "dashboard" ? <HealthPanel health={health} /> : section === "backups" || section === "storage" || section === "settings" ? <div className="empty-state"><Database /><h3>{heading.title} API not supported</h3><p>The Rust API does not expose this operation yet. The UI keeps the boundary explicit.</p></div> : <DataTable rows={rows} section={section} />}</div></div></AppShell>;
}

function HealthPanel({ health }: { health: Record<string, unknown> | null }) { return <div className="health-panel"><TinyBadge tone={health?.status === "ok" ? "green" : "amber"}>{String(health?.status ?? "loading")}</TinyBadge><p>Backend readiness is checked against the live health endpoint.</p><pre>{health ? JSON.stringify(health, null, 2) : "Loading…"}</pre></div>; }

function DataTable({ rows, section }: { rows: unknown[]; section: Section }) {
  const objects = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  return objects.length ? <table className="simple-table"><thead><tr><th>{section === "providers" ? "Provider" : section === "audit" ? "Action" : "User"}</th><th>Details</th>{section === "providers" && <th>Action</th>}</tr></thead><tbody>{objects.map((row, index) => <tr key={String(row.id ?? row.event_id ?? index)}><td>{String(row.name ?? row.action ?? row.display_name ?? row.id ?? row.event_id ?? "—")}</td><td><code>{JSON.stringify(row)}</code></td>{section === "providers" && <td><button className="button primary" onClick={() => void installProvider(String(row.name)).then(() => location.reload())}>Install</button></td>}</tr>)}</tbody></table> : <div className="empty-state"><FileText /><h3>No records returned</h3><p>The API returned an empty collection.</p></div>;
}
