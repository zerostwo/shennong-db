"use client";

import { FormEvent, useEffect, useState } from "react";
import { Database, Plus, RefreshCw, X } from "lucide-react";
import {
  getHealth,
  listAuditEvents,
  listProviders,
  listUsers,
} from "@/lib/api/adapter";
import { audit, grants, jobs, users } from "@/lib/mock-data";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";
import dynamic from "next/dynamic";

const AppLineChart = dynamic(
  () => import("./charts/line-chart").then((module) => module.AppLineChart),
  { ssr: false, loading: () => <div className="chart-skeleton" /> },
);

export type Section =
  | "dashboard"
  | "users"
  | "settings"
  | "grants"
  | "tokens"
  | "providers"
  | "ingestion"
  | "storage"
  | "monitoring"
  | "audit"
  | "security"
  | "backups";
const copy: Record<Section, [string, string]> = {
  dashboard: ["Dashboard", "Overview of system health, usage, and activity."],
  users: ["Users", "Manage identities, roles, sessions, and account state."],
  grants: ["Grants", "Control resource scopes and expirations."],
  tokens: ["Tokens", "Review and revoke personal API credentials."],
  providers: [
    "Providers",
    "Validate manifests, versions, and installation history.",
  ],
  ingestion: ["Ingestion jobs", "Monitor provider and upload materialization."],
  storage: [
    "Storage",
    "Review backend capacity, health, and lifecycle policy.",
  ],
  monitoring: ["Monitoring", "Inspect API and storage service health."],
  audit: ["Audit log", "Review security and governance events."],
  security: ["Security", "Configure instance authentication policies."],
  backups: ["Backups", "Protect and restore ShennongDB metadata."],
  settings: ["System Settings", "Configure this ShennongDB instance."],
};

export function AdminSectionView({ section }: { section: Section }) {
  const [live, setLive] = useState<unknown[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [updated, setUpdated] = useState("30s ago");
  useEffect(() => {
    const call =
      section === "users"
        ? listUsers()
        : section === "providers"
          ? listProviders()
          : section === "audit"
            ? listAuditEvents()
            : section === "dashboard" || section === "monitoring"
              ? getHealth()
              : Promise.resolve([]);
    void call
      .then((v) =>
        Array.isArray(v) ? setLive(v) : setHealth(v as Record<string, unknown>),
      )
      .catch(() => undefined);
  }, [section]);
  const [title, description] = copy[section];
  return (
    <AppShell variant="admin" active={section}>
      <TopBar
        title={title}
        description={description}
        search={false}
        action={
          <div className="admin-refresh">
            <span className="green-text">● All Systems Operational</span>
            <span>Updated {updated}</span>
            <button className="outline-button" onClick={() => { setUpdated("just now"); if (section === "dashboard" || section === "monitoring") void getHealth().then(setHealth).catch(() => undefined); }}>
              <RefreshCw />
              Refresh
            </button>
          </div>
        }
      />
      <div className="admin-page">
        <AdminContent section={section} live={live} health={health} />
      </div>
    </AppShell>
  );
}

function AdminContent({
  section,
  live,
  health,
}: {
  section: Section;
  live: unknown[];
  health: Record<string, unknown> | null;
}) {
  if (section === "dashboard") return <Dashboard health={health} />;
  if (section === "settings") return <Settings />;
  if (section === "monitoring") return <Monitoring />;
  if (section === "storage") return <Storage />;
  if (section === "security") return <Security />;
  if (section === "backups") return <Backups />;
  const configs: Record<
    Exclude<
      Section,
      | "dashboard"
      | "settings"
      | "monitoring"
      | "storage"
      | "security"
      | "backups"
    >,
    { head: string[]; rows: readonly (readonly string[])[]; action: string }
  > = {
    users: {
      head: [
        "User",
        "Email",
        "Role",
        "Status",
        "Resources",
        "Tokens",
        "Last active",
      ],
      rows: users,
      action: "Create user",
    },
    grants: {
      head: [
        "User",
        "Resource",
        "Scopes",
        "Granted by",
        "Granted at",
        "Expires",
      ],
      rows: grants,
      action: "Create grant",
    },
    tokens: {
      head: [
        "Owner",
        "Prefix",
        "Scopes",
        "Created",
        "Last used",
        "Expires",
        "Status",
      ],
      rows: [
        [
          "Elias Morgan",
          "sndb_7f2a••••",
          "resource.read",
          "Jun 18",
          "2 min ago",
          "Sep 18",
          "Active",
        ],
        [
          "Priya Raman",
          "sndb_5b19••••",
          "artifact.download",
          "Jul 1",
          "Yesterday",
          "Oct 1",
          "Active",
        ],
      ],
      action: "Review policy",
    },
    providers: {
      head: [
        "Name",
        "Version",
        "Source",
        "Installed",
        "Resources",
        "Last sync",
        "Status",
      ],
      rows: [
        [
          "TCGA",
          "2026.06",
          "provider registry",
          "Jun 14",
          "22",
          "Today",
          "Healthy",
        ],
        [
          "GENCODE",
          "44",
          "gencodegenes.org",
          "May 8",
          "8",
          "Yesterday",
          "Healthy",
        ],
        [
          "Cell Ranger",
          "9.0.1",
          "10x Genomics",
          "Apr 21",
          "4",
          "Jul 8",
          "Update available",
        ],
      ],
      action: "Install provider",
    },
    ingestion: {
      head: [
        "Job ID",
        "Resource",
        "Provider",
        "State",
        "Progress",
        "Duration",
        "Worker",
      ],
      rows: jobs,
      action: "Register data",
    },
    audit: {
      head: ["Timestamp", "Actor", "Action", "Object ID", "Result", "IP"],
      rows: audit,
      action: "Export",
    },
  };
  const c = configs[section as keyof typeof configs];
  return <AdminDataPanel section={section} config={c} live={live.length > 0} />;
}

function AdminDataPanel({
  section,
  config,
  live,
}: {
  section: Section;
  config: {
    head: string[];
    rows: readonly (readonly string[])[];
    action: string;
  };
  live: boolean;
}) {
  const [rows, setRows] = useState<string[][]>(() =>
    config.rows.map((r) => [...r]),
  );
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [detail, setDetail] = useState<string[] | null>(null);
  const visible = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      row.join(" ").toLowerCase().includes(query.toLowerCase()),
    );
  function primary() {
    if (section === "audit") {
      const csv = [config.head, ...rows]
        .map((r) => r.map((x) => `"${x.replaceAll('"', '""')}"`).join(","))
        .join("\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      link.download = "shennong-audit.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    setDialog(true);
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (section === "grants") {
      setRows((value) => [[String(data.get("user")), String(data.get("resource")), data.getAll("scope").map(String).join(", "), "Dr. Maya Chen", "Just now", String(data.get("expiration") || "Never")], ...value]);
      setDialog(false);
      return;
    }
    const name = String(data.get("name"));
    const detail = String(data.get("detail"));
    const row = config.head.map((_, i) =>
      i === 0
        ? name
        : i === 1
          ? detail
          : i === config.head.length - 1
            ? "Active"
            : "—",
    );
    setRows((v) => [row, ...v]);
    setDialog(false);
  }
  return (
    <div className="admin-panel">
      <SectionHeader
        title={copy[section][0]}
        action={
          <button className="primary-button" onClick={primary}>
            <Plus />
            {config.action}
          </button>
        }
      />
      <div className="workspace-toolbar">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${copy[section][0].toLowerCase()}…`}
        />
        <select>
          <option>All status</option>
          <option>Active</option>
          <option>Disabled</option>
        </select>
        <select>
          <option>Recently updated</option>
          <option>Name</option>
        </select>
        {live && <TinyBadge tone="green">Live API connected</TinyBadge>}
      </div>
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              {config.head.map((x) => (
                <th key={x}>{x}</th>
              ))}
              {section !== "audit" && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, index }) => (
              <tr
                key={`${row[0]}-${index}`}
                className={
                  section === "providers" ||
                  section === "ingestion" ||
                  section === "audit" ||
                  section === "grants"
                    ? "clickable-row"
                    : ""
                }
                onClick={() =>
                  (section === "providers" ||
                    section === "ingestion" ||
                    section === "audit" ||
                    section === "grants") &&
                  setDetail(row)
                }
                tabIndex={
                  section === "providers" ||
                  section === "ingestion" ||
                  section === "audit" ||
                  section === "grants"
                    ? 0
                    : undefined
                }
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" || event.key === " ") &&
                    (section === "providers" ||
                      section === "ingestion" ||
                      section === "audit" ||
                      section === "grants")
                  )
                    setDetail(row);
                }}
              >
                {row.map((x, j) => (
                  <td key={j}>
                    {j === 0 ? (
                      section === "users" ? (
                        <a
                          className="link-cell"
                          href={`/admin/users/${encodeURIComponent(x.toLowerCase().replaceAll(" ", "-"))}`}
                        >
                          <strong>{x}</strong>
                        </a>
                      ) : (
                        <strong>{x}</strong>
                      )
                    ) : x === "Healthy" || x === "Active" ? (
                      <TinyBadge tone="green">{x}</TinyBadge>
                    ) : (
                      x
                    )}
                  </td>
                ))}
                {section !== "audit" && (
                  <td>
                    <button
                      className="danger-button compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirm(index);
                      }}
                    >
                      {section === "users"
                        ? "Disable"
                        : section === "ingestion"
                          ? "Cancel"
                          : "Remove"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && (
        <div className="modal-scrim">
          <form className="simple-dialog" onSubmit={create}>
            <h2>{config.action}</h2>
            {section === "grants" ? <>
              <label>User<input name="user" required autoFocus placeholder="maya.chen@shennong.org" /></label>
              <label>Resource<input name="resource" required placeholder="PBMC 3K TileDB filtered" /></label>
              <fieldset><legend>Scopes</legend>{["resource.read", "artifact.download", "query.execute", "resource.write", "resource.admin"].map((scope, index) => <label className="check-label" key={scope}><input type="checkbox" name="scope" value={scope} defaultChecked={index === 0} />{scope}</label>)}</fieldset>
              <label>Expiration<input name="expiration" type="date" /></label>
              <label>Reason<textarea name="reason" required placeholder="Research collaboration approval" /></label>
            </> : <><label>
              {section === "providers" ? "Provider" : "Name"}
              <input name="name" required autoFocus />
            </label>
            <label>
              Details
              <input name="detail" required />
            </label></>}
            <div className="dialog-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => setDialog(false)}
              >
                Cancel
              </button>
              <button className="primary-button">{config.action}</button>
            </div>
          </form>
        </div>
      )}
      {confirm !== null && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>Confirm destructive action</h2>
            <p>This action changes access or availability immediately.</p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setRows((v) => v.filter((_, i) => i !== confirm));
                  setConfirm(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {detail && (
        <AdminObjectDrawer
          section={section}
          row={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function AdminObjectDrawer({
  section,
  row,
  onClose,
}: {
  section: Section;
  row: string[];
  onClose: () => void;
}) {
  const tabs =
    section === "providers"
      ? ["Manifest", "Files", "Checksums", "Storage", "Permissions", "History"]
      : section === "ingestion"
        ? ["Timeline", "Logs", "Files", "Checksums", "Warnings", "Errors"]
        : section === "audit"
          ? ["Request", "Before / after", "Related resource"]
          : ["Overview", "Reason", "Audit"];
  const [tab, setTab] = useState(tabs[0]);
  const [jobStatus, setJobStatus] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" />
      <aside
        className="resource-drawer admin-object-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${copy[section][0]} details`}
      >
        <div className="drawer-header">
          <div>
            <h2>{row[0]}</h2>
            <p>{row[1]}</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close details"
          >
            <X />
          </button>
        </div>
        <div className="drawer-tabs">
          {tabs.map((item) => (
            <button
              key={item}
              className={item === tab ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="drawer-content">
          <div className="detail-section">
            <h3>{tab}</h3>
            {section === "ingestion" && tab === "Timeline" ? (
              <div className="event-list">
                {[
                  "registered",
                  "downloading",
                  "verifying",
                  "materializing",
                ].map((item, index) => (
                  <div key={item}>
                    <span className="event-dot" />
                    <strong>{item}</strong>
                    <small>{index < 3 ? "Completed" : "Running · 72%"}</small>
                  </div>
                ))}
              </div>
            ) : tab === "Logs" ? (
              <pre className="log-view">
                08:42:11 checksum verified{"\n"}08:42:14 materializing TileDB
                array{"\n"}08:42:18 indexed 2,401 features
              </pre>
            ) : (
              <dl className="detail-list">
                {row.map((value, index) => (
                  <div key={index}>
                    <dt>
                      {index === 0
                        ? "Object"
                        : index === 1
                          ? "Details"
                          : `Field ${index + 1}`}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {section === "providers" && (
            <div className="detail-section">
              <h3>Validation</h3>
              <p>
                <TinyBadge tone="green">Manifest valid</TinyBadge> Checksums and
                permissions verified.
              </p>
            </div>
          )}
          {section === "audit" && (
            <div className="detail-section">
              <h3>Request metadata</h3>
              <p>
                <code>request_id=req_01JZ8A7F</code>
              </p>
              <p>User agent: ShennongData/0.4.0 · Scopes: resource.read</p>
            </div>
          )}
        </div>
        {section === "ingestion" && (
          <div className="auth-callout">
            <button className="outline-button" onClick={() => setJobStatus("Retry queued")}>Retry job</button>
            <button className="danger-button" onClick={() => setCancelOpen(true)}>Cancel job</button>
          </div>
        )}
      </aside>
      {jobStatus && <div className="toast" role="status">{jobStatus}</div>}
      {cancelOpen && <div className="modal-scrim"><div className="simple-dialog" role="alertdialog" aria-modal="true"><h2>Cancel ingestion job?</h2><p>Materialization stops immediately and partial staging data is cleaned up.</p><div className="dialog-actions"><button className="outline-button" onClick={() => setCancelOpen(false)}>Keep running</button><button className="danger-button" onClick={() => { setCancelOpen(false); setJobStatus("Job cancelled"); }}>Cancel job</button></div></div></div>}
    </>
  );
}

function Dashboard({ health }: { health: Record<string, unknown> | null }) {
  return (
    <>
      <div className="metric-grid">
        {[
          ["Total Resources", "48", "48 objects"],
          ["Artifacts", "124", "124 objects"],
          ["Raw Data", "8.4 TB", "22 objects"],
          ["Derived Data", "3.1 TB", "71 objects"],
          ["Cache", "642 GB", "31 objects"],
        ].map(([a, b, c]) => (
          <div className="metric-card" key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
            <small>{c}</small>
          </div>
        ))}
      </div>
      <div className="admin-grid">
        <div className="admin-panel">
          <SectionHeader
            title="System Services"
            action={
              <TinyBadge tone={health?.status === "ok" ? "green" : "amber"}>
                {String(health?.status ?? "Checking")}
              </TinyBadge>
            }
          />
          <Table
            headings={["Service", "Status", "Latency", "Version", "Instance"]}
            rows={[
              ["PostgreSQL", "Healthy", "4 ms", "16.3", "primary"],
              ["ClickHouse", "Healthy", "11 ms", "24.5", "analytics-01"],
              ["TileDB", "Healthy", "18 ms", "2.26", "storage-01"],
              ["S3 Object Storage", "Healthy", "34 ms", "S3", "data-prod"],
            ]}
          />
        </div>
        <div className="admin-panel">
          <SectionHeader title="Ingestion Job Queue" />
          <Table
            headings={["State", "Jobs", "Trend"]}
            rows={[
              ["Queued", "4", "+1"],
              ["Running", "3", "—"],
              ["Failed", "1", "-2"],
              ["Completed 24h", "28", "+14%"],
            ]}
          />
        </div>
      </div>
      <div className="admin-grid three">
        <Chart title="Query Call Volume" />
        <Chart title="Access Events" />
        <div className="admin-panel">
          <SectionHeader title="Top Query Endpoints" />
          <Table
            headings={["Endpoint", "Count", "Share"]}
            rows={[
              ["/query", "1.12M", "52%"],
              ["/resources", "632K", "30%"],
              ["/artifacts", "388K", "18%"],
            ]}
          />
        </div>
      </div>
      <div className="admin-panel">
        <SectionHeader title="Recent Audit Trail" />
        <Table
          headings={[
            "Time UTC",
            "Actor",
            "Action",
            "Resource",
            "Result",
            "IP Address",
          ]}
          rows={audit}
        />
      </div>
    </>
  );
}
function Chart({ title }: { title: string }) {
  return (
    <div className="admin-panel">
      <SectionHeader title={title} />
      <AppLineChart label={`${title} trend over the last 24 hours`} />
    </div>
  );
}
function Monitoring() {
  return (
    <>
      <div className="metric-grid">
        {[
          ["API latency", "42 ms"],
          ["Error rate", "0.18%"],
          ["Request volume", "91K / day"],
          ["Cache hit rate", "86%"],
          ["DB connections", "34 / 120"],
        ].map(([a, b]) => (
          <div className="metric-card" key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
            <small>Within target</small>
          </div>
        ))}
      </div>
      <div className="admin-grid">
        <Chart title="Request volume" />
        <Chart title="Backend latency" />
        <Chart title="Storage utilization" />
        <Chart title="Ingestion queue" />
      </div>
    </>
  );
}
function Storage() {
  const [saved, setSaved] = useState(true);
  return (
    <>
      <div className="metric-grid">
        {[
          ["Raw", "8.4 TB"],
          ["Canonical", "2.8 TB"],
          ["Derived", "3.1 TB"],
          ["Cache", "642 GB"],
          ["Staging", "81 GB"],
        ].map(([a, b]) => (
          <div className="metric-card" key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
            <small>Healthy</small>
          </div>
        ))}
      </div>
      <div className="admin-panel">
        <SectionHeader title="Storage backends" />
        <Table
          headings={[
            "Backend",
            "Type",
            "Endpoint",
            "Health",
            "Capacity",
            "Used",
            "Latency",
            "Default",
          ]}
          rows={[
            [
              "Local Filesystem",
              "POSIX",
              "/data",
              "Healthy",
              "4 TB",
              "1.2 TB",
              "2 ms",
              "Raw",
            ],
            [
              "S3-compatible",
              "Object",
              "s3.internal",
              "Healthy",
              "20 TB",
              "8.4 TB",
              "34 ms",
              "Artifacts",
            ],
            [
              "TileDB",
              "Array",
              "tiledb.internal",
              "Healthy",
              "12 TB",
              "3.1 TB",
              "18 ms",
              "Derived",
            ],
            [
              "ClickHouse",
              "Database",
              "clickhouse:9000",
              "Healthy",
              "6 TB",
              "642 GB",
              "11 ms",
              "Query",
            ],
          ]}
        />
      </div>
      <div className="admin-panel">
        <SectionHeader
          title="Storage policy"
          description="Defaults applied to new artifacts and temporary data."
          action={
            <button className="primary-button" onClick={() => setSaved(true)}>
              Save policy
            </button>
          }
        />
        <div className="form-grid storage-policy">
          {[
            ["Default raw backend", "S3-compatible"],
            ["Default derived backend", "TileDB"],
            ["Staging retention (days)", "7"],
            ["Cache TTL (hours)", "24"],
            ["Checksum policy", "SHA256 required"],
            ["Multipart threshold (MB)", "64"],
            ["Presigned URL expiry (seconds)", "900"],
          ].map(([label, value]) => (
            <label key={label}>
              {label}
              <input defaultValue={value} onChange={() => setSaved(false)} />
            </label>
          ))}
        </div>
        <p className={saved ? "saved-state" : "unsaved-state"}>
          {saved ? "Policy saved" : "Unsaved changes"}
        </p>
      </div>
    </>
  );
}
function Security() {
  const [dirty, setDirty] = useState(false);
  return (
    <div className="admin-panel">
      <SectionHeader
        title="Security policies"
        action={
          <button className="primary-button" onClick={() => setDirty(false)}>
            Save policies
          </button>
        }
      />
      <div className="form-grid security-policy">
        <label className="toggle-field">
          Require admin 2FA
          <input
            type="checkbox"
            defaultChecked
            onChange={() => setDirty(true)}
          />
        </label>
        {[
          ["Session timeout (hours)", "12"],
          ["Password minimum length", "12"],
          ["Token default expiration (days)", "90"],
          ["Maximum token expiration (days)", "365"],
          ["Login failure threshold", "5"],
          ["Lockout duration (minutes)", "30"],
        ].map(([label, value]) => (
          <label key={label}>
            {label}
            <input
              type="number"
              min="1"
              defaultValue={value}
              onChange={() => setDirty(true)}
            />
          </label>
        ))}
      </div>
      <p className={dirty ? "unsaved-state" : "saved-state"}>
        {dirty ? "Unsaved changes" : "Policies saved"}
      </p>
    </div>
  );
}
function Backups() {
  const [rows, setRows] = useState<string[][]>([
    [
      "backup-20260712-0200",
      "Scheduled",
      "Today 02:00",
      "8m 42s",
      "18.4 GB",
      "Verified",
    ],
    [
      "backup-20260711-0200",
      "Scheduled",
      "Yesterday",
      "8m 31s",
      "18.1 GB",
      "Verified",
    ],
  ]);
  const [restore, setRestore] = useState<string | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  return (
    <div className="admin-panel">
      <SectionHeader
        title="Backup history"
        action={
          <button
            className="primary-button"
            onClick={() =>
              setRows((value) => [
                [
                  `backup-${Date.now()}`,
                  "Manual",
                  "Just now",
                  "Running",
                  "—",
                  "In progress",
                ],
                ...value,
              ])
            }
          >
            <Plus />
            Run backup
          </button>
        }
      />
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              {[
                "Backup",
                "Type",
                "Started",
                "Duration",
                "Size",
                "Status",
                "Actions",
              ].map((item) => (
                <th key={item}>{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={index}>
                    {index === 0 ? <strong>{cell}</strong> : cell}
                  </td>
                ))}
                <td>
                  <button
                    className="outline-button"
                    disabled={row[5] !== "Verified"}
                    onClick={() => { setRestore(row[0]); setRestoreConfirmation(""); }}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {restore && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>Restore backup?</h2>
            <p>
              {restore} will replace current metadata after a pre-restore safety
              snapshot.
            </p>
            <label>
              Type RESTORE to confirm
              <input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} autoFocus />
            </label>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setRestore(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={restoreConfirmation !== "RESTORE"}
                onClick={() => { setRows((value) => value.map((row) => row[0] === restore ? [...row.slice(0, 5), "Restored"] : row)); setRestore(null); }}
              >
                Restore backup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Settings() {
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("General");
  const [resetKey, setResetKey] = useState(0);
  type Field = [string, string, "text" | "toggle" | "number"];
  const sections: Record<
    string,
    { title: string; description: string; fields: Field[] }
  > = {
    General: {
      title: "General",
      description: "Public instance identity and defaults.",
      fields: [
        ["Instance name", "ShennongDB Production", "text"],
        ["Public URL", "https://data.example.org", "text"],
        ["Support URL", "https://support.example.org", "text"],
        ["Docs URL", "https://docs.example.org", "text"],
        ["Default timezone", "Asia/Shanghai", "text"],
        ["Default locale", "English", "text"],
        ["Public catalog", "Enabled", "toggle"],
        ["Registration", "Disabled", "toggle"],
      ],
    },
    Security: {
      title: "Security Policies",
      description: "Authentication, sessions, passwords, and token limits.",
      fields: [
        ["Require admin 2FA", "Enabled", "toggle"],
        ["Session timeout (hours)", "12", "number"],
        ["Password minimum length", "12", "number"],
        ["Token default expiration (days)", "90", "number"],
        ["Maximum token expiration (days)", "365", "number"],
        ["Login failure threshold", "5", "number"],
        ["Lockout duration (minutes)", "30", "number"],
      ],
    },
    Storage: {
      title: "Object Storage",
      description: "S3-compatible backend and multipart behavior.",
      fields: [
        ["S3 endpoint", "https://s3.internal", "text"],
        ["S3 bucket", "shennong-data", "text"],
        ["S3 region", "us-east-1", "text"],
        ["Path style", "Enabled", "toggle"],
        ["Presigned expiration (seconds)", "900", "number"],
        ["Multipart size (MB)", "64", "number"],
      ],
    },
    Integrations: {
      title: "Analytics Integrations",
      description: "Optional privacy-aware analytics scripts.",
      fields: [
        ["Umami enabled", "Disabled", "toggle"],
        ["Umami Website ID", "", "text"],
        ["Umami Script URL", "https://analytics.example.org/script.js", "text"],
        ["Google Analytics enabled", "Disabled", "toggle"],
        ["GA Measurement ID", "", "text"],
      ],
    },
    Notifications: {
      title: "Notifications",
      description: "Operational and security notification routing.",
      fields: [
        ["Ingestion failures", "Enabled", "toggle"],
        ["Storage alerts", "Enabled", "toggle"],
        ["Security alerts", "Enabled", "toggle"],
        ["Notification email", "ops@example.org", "text"],
        ["Webhook URL", "", "text"],
      ],
    },
    Advanced: {
      title: "Privacy, Telemetry & Retention",
      description: "Telemetry and data-retention policy.",
      fields: [
        ["Enable telemetry", "Enabled", "toggle"],
        ["IP anonymization", "Enabled", "toggle"],
        ["Respect DNT", "Enabled", "toggle"],
        ["Usage metrics", "Enabled", "toggle"],
        ["Error reporting", "Enabled", "toggle"],
        ["Audit logs (days)", "365", "number"],
        ["Access logs (days)", "90", "number"],
        ["Metrics (days)", "30", "number"],
        ["Staging files (days)", "7", "number"],
      ],
    },
  };
  const current = sections[tab];
  return (
    <div className="settings-layout">
      <div className="admin-panel settings-main">
        <div className="settings-tabs">
          {Object.keys(sections).map((item) => (
            <button
              key={item}
              className={item === tab ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="settings-section" key={`${tab}-${resetKey}`}>
          <SectionHeader
            title={current.title}
            description={current.description}
          />
          {current.fields.map(([label, value, type]) => (
            <label className="setting-row" key={label}>
              <span>
                <strong>{label}</strong>
                <small>Changes are audited and enforced by the Rust API.</small>
              </span>
              {type === "toggle" ? (
                <input
                  type="checkbox"
                  defaultChecked={value === "Enabled"}
                  onChange={() => setDirty(true)}
                />
              ) : (
                <input
                  type={type}
                  defaultValue={value}
                  onChange={() => setDirty(true)}
                />
              )}
            </label>
          ))}
        </div>
        <div className="settings-footer">
          <span className={dirty ? "unsaved" : "saved"}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <button
            className="outline-button"
            onClick={() => {
              setResetKey((value) => value + 1);
              setDirty(true);
            }}
          >
            Reset to Defaults
          </button>
          <button className="primary-button" onClick={() => setDirty(false)}>
            Save Changes
          </button>
        </div>
      </div>
      <aside className="settings-side">
        <Database />
        <h3>Configuration boundary</h3>
        <p>
          Settings are submitted through the Web BFF and enforced by the Rust
          API.
        </p>
      </aside>
    </div>
  );
}
function Table({
  headings,
  rows,
}: {
  headings: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="record-table-wrap">
      <table className="simple-table">
        <thead>
          <tr>
            {headings.map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td key={j}>
                  {j === 0 ? (
                    <strong>{x}</strong>
                  ) : x === "Healthy" ||
                    x === "Success" ||
                    x === "Verified" ||
                    x === "Active" ? (
                    <TinyBadge tone="green">{x}</TinyBadge>
                  ) : x === "Denied" || x === "failed" ? (
                    <TinyBadge tone="amber">{x}</TinyBadge>
                  ) : (
                    x
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
