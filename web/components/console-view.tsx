"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Check, Upload } from "lucide-react";
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
  return (
    <>
      <div className="workspace-toolbar">
        <select aria-label="Date range"><option>Last 30 days</option><option>Last 7 days</option><option>Last 90 days</option></select>
        <select aria-label="Token"><option>All tokens</option><option>Notebook analysis</option></select>
        <select aria-label="Endpoint"><option>All endpoints</option><option>/api/v1/resources</option></select>
        <select aria-label="Resource"><option>All resources</option><option>Toil RNA-seq</option></select>
        <select aria-label="Status"><option>All status codes</option><option>2xx</option><option>4xx</option><option>5xx</option></select>
      </div>
      <div className="api-metrics">
        {[["Requests", "2.14M"], ["Data transfer", "186.4 GB"], ["Errors", "0.18%"], ["Rate limited", "1,204"]].map(([label, value]) => <div className="console-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="console-panel">
        <SectionHeader title="Request volume" />
        <AppLineChart label="Request volume for the last 30 days" values={[58, 64, 61, 73, 69, 82, 78, 91]} />
      </div>
      <RecordTable headings={["Top resource", "Requests", "Transfer", "Errors"]} rows={[["Toil RNA-seq", "1.12M", "82.4 GB", "0.09%"], ["PBMC 3K", "632K", "61.7 GB", "0.22%"], ["TCGA survival", "388K", "42.3 GB", "0.31%"]]} />
      <div className="usage-grid">
        <RecordTable headings={["Top endpoint", "Requests", "Median latency"]} rows={[["GET /resources", "881K", "82 ms"], ["POST /query", "743K", "241 ms"], ["GET /artifacts", "516K", "116 ms"]]} />
        <RecordTable headings={["Token", "Requests", "Errors"]} rows={[["Notebook analysis", "1.48M", "0.12%"], ["RStudio", "421K", "0.21%"], ["CLI", "239K", "0.43%"]]} />
      </div>
    </>
  );
}

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
