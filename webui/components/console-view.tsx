"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Upload } from "lucide-react";
import { getUsage, type JsonRecord } from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";
import { ApiAccessView } from "./api-access-view";
import { AccountView } from "./account-view";
import { DataOpsView } from "./data-ops-view";

const AppLineChart = dynamic(
  () => import("./charts/line-chart").then((module) => module.AppLineChart),
  { ssr: false, loading: () => <div className="chart-skeleton" aria-label="Loading request chart" /> },
);

type Page =
  | "api-access"
  | "usage"
  | "profile"
  | "security"
  | "sessions"
  | "login-history"
  | "uploads"
  | "jobs"
  | "my-data";

const pageFromPath = (path: string): Page =>
  (path.split("/").filter(Boolean).at(-1) as Page) || "api-access";

export function ConsoleView() {
  const page = pageFromPath(usePathname());
  const titles: Record<Page, [string, string]> = {
    "api-access": ["API Access", "Manage personal tokens, usage, limits, SDKs, and examples."],
    usage: ["Usage", "Understand API traffic, transfer, errors, and rate limiting."],
    profile: ["Profile", "Manage your identity and regional preferences."],
    security: ["Security", "Protect your account, credentials, and recovery methods."],
    sessions: ["Active sessions", "Review and revoke devices with access to your account."],
    "login-history": ["Login history", "Review recent authentication activity."],
    uploads: ["Uploads", "Track file transfer and validation progress."],
    jobs: ["Ingestion jobs", "Follow registration, verification, and materialization."],
    "my-data": ["My Data", "Resources you own, use, or have collected."],
  };
  return (
    <AppShell active={page}>
      <TopBar title={titles[page][0]} description={titles[page][1]} search={false} />
      <div className="console-page"><ConsolePage page={page} /></div>
    </AppShell>
  );
}

function ConsolePage({ page }: { page: Page }) {
  if (page === "api-access") return <ApiAccessView />;
  if (page === "usage") return <Usage />;
  if (["profile", "security", "sessions", "login-history"].includes(page)) return <AccountView page={page as "profile" | "security" | "sessions" | "login-history"} />;
  if (["uploads", "jobs", "my-data"].includes(page)) return <DataOpsView page={page as "uploads" | "jobs" | "my-data"} />;
  return null;
}

function Usage() {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<JsonRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void getUsage(days).then(setUsage).catch((reason) => setError(reason instanceof Error ? reason.message : "Usage request failed")); }, [days]);
  const totals = (usage?.totals ?? {}) as JsonRecord;
  const series = Array.isArray(usage?.series) ? usage.series as JsonRecord[] : [];
  const resources = Array.isArray(usage?.resources) ? usage.resources as JsonRecord[] : [];
  const endpoints = Array.isArray(usage?.endpoints) ? usage.endpoints as JsonRecord[] : [];
  return (
    <>
      <div className="workspace-toolbar">
        <select aria-label="Date range" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={30}>Last 30 days</option><option value={7}>Last 7 days</option><option value={90}>Last 90 days</option></select>
        <TinyBadge tone="green">Recorded API traffic</TinyBadge>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="api-metrics">
        {[["Requests", String(totals.requests ?? 0)], ["Response bytes", formatBytes(Number(totals.response_bytes ?? 0))], ["Errors", String(totals.errors ?? 0)], ["Rate limited", String(totals.rate_limited ?? 0)]].map(([label, value]) => <div className="console-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="console-panel">
        <SectionHeader title="Request volume" />
        <AppLineChart label={`Request volume for the last ${days} days`} values={series.map((row) => Number(row.requests ?? 0))} />
      </div>
      <RecordTable headings={["Resource", "Requests", "Transfer", "Errors"]} rows={resources.map((row) => [String(row.resource_id ?? "unscoped"), String(row.requests ?? 0), formatBytes(Number(row.response_bytes ?? 0)), String(row.errors ?? 0)])} />
      <RecordTable headings={["Endpoint", "Requests", "Errors", "Median latency"]} rows={endpoints.map((row) => [String(row.endpoint ?? ""), String(row.requests ?? 0), String(row.errors ?? 0), `${Number(row.median_latency_ms ?? 0).toFixed(1)} ms`])} />
    </>
  );
}

function formatBytes(value: number) { const units = ["B", "KB", "MB", "GB", "TB"]; let size = value; let index = 0; while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; } return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`; }

function RecordTable({ headings, rows }: { headings: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="record-table-wrap">
      <table className="simple-table">
        <thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.join("-")}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <strong>{cell}</strong> : cell.includes("Success") || cell === "Available" || cell === "Active" ? <TinyBadge tone="green"><Check />{cell}</TinyBadge> : cell}</td>)}</tr>)}</tbody>
      </table>
      {rows.length === 0 && <div className="empty-state"><Upload /><h3>No records</h3><p>There is nothing to show yet.</p></div>}
    </div>
  );
}
