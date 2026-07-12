"use client";
import { useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";
const tabs = ["Overview", "Grants", "Tokens", "Sessions", "Audit"] as const;
export function UserDetailView({ userId }: { userId: string }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [action, setAction] = useState<string | null>(null);
  const [status, setStatus] = useState("Active");
  return (
    <AppShell variant="admin" active="users">
      <TopBar
        title="Dr. Maya Chen"
        description={`User ${userId}`}
        search={false}
      />
      <div className="admin-page">
        <div className="admin-panel user-detail">
          <div className="user-detail-header">
            <span className="avatar avatar-green">MC</span>
            <div>
              <h2>Dr. Maya Chen</h2>
              <p>maya.chen@shennong.org · Shennong Biomedical Institute</p>
              <div className="tag-row">
                <TinyBadge tone="purple">Administrator</TinyBadge>
                <TinyBadge tone={status === "Active" ? "green" : "amber"}>
                  {status}
                </TinyBadge>
                <TinyBadge tone="green">2FA enabled</TinyBadge>
              </div>
            </div>
            <div className="user-actions">
              <button
                className="outline-button"
                onClick={() => setAction("Change role")}
              >
                Change role
              </button>
              <button
                className="danger-button"
                onClick={() =>
                  setAction(
                    status === "Active" ? "Disable user" : "Enable user",
                  )
                }
              >
                {status === "Active" ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
          <div className="settings-tabs">
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
          {tab === "Overview" && <Overview onAction={setAction} />}{" "}
          {tab === "Grants" && (
            <Table
              headings={["Resource", "Scopes", "Granted by", "Expires"]}
              rows={[
                [
                  "PBMC 3K TileDB filtered",
                  "resource.read, query.execute",
                  "maya.chen",
                  "Never",
                ],
                [
                  "S3 raw bucket · WGS reads",
                  "artifact.download",
                  "data-stewards",
                  "2026-10-01",
                ],
              ]}
            />
          )}{" "}
          {tab === "Tokens" && (
            <Table
              headings={["Token", "Prefix", "Scopes", "Last used", "Expires"]}
              rows={[
                [
                  "Analysis workstation",
                  "sndb_7f2a••••",
                  "resource.read",
                  "2 min ago",
                  "Sep 18",
                ],
                [
                  "RStudio",
                  "sndb_5b19••••",
                  "query.execute",
                  "Yesterday",
                  "Oct 1",
                ],
              ]}
            />
          )}{" "}
          {tab === "Sessions" && (
            <Table
              headings={["Device", "IP", "Created", "Last active"]}
              rows={[
                ["Firefox · Linux", "192.168.3.10", "Jul 8", "Now"],
                ["Safari · macOS", "10.24.1.5", "Jun 29", "2 days ago"],
              ]}
            />
          )}{" "}
          {tab === "Audit" && (
            <Table
              headings={["Time", "Action", "Object", "Result", "IP"]}
              rows={[
                [
                  "Today 08:42",
                  "grant.create",
                  "pbmc-3k",
                  "Success",
                  "192.168.3.18",
                ],
                [
                  "Yesterday",
                  "auth.sign_in",
                  "session",
                  "Success",
                  "192.168.3.10",
                ],
              ]}
            />
          )}
        </div>
      </div>
      {action && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <button
              className="dialog-close"
              aria-label="Close dialog"
              onClick={() => setAction(null)}
            >
              <X />
            </button>
            <div className="dialog-icon">
              <ShieldCheck />
            </div>
            <h2>{action}</h2>
            <p>This administrative action is recorded in the audit log.</p>
            {action === "Change role" && (
              <label>
                Role
                <select defaultValue="admin">
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
            )}
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button
                className={
                  action.includes("Disable") ||
                  action.includes("Revoke") ||
                  action.includes("Reset")
                    ? "danger-button"
                    : "primary-button"
                }
                onClick={() => {
                  if (action === "Disable user") setStatus("Disabled");
                  if (action === "Enable user") setStatus("Active");
                  setAction(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
function Overview({ onAction }: { onAction: (action: string) => void }) {
  return (
    <div className="user-overview-grid">
      <div>
        <SectionHeader title="Identity" />
        <dl className="detail-list">
          <div>
            <dt>Role</dt>
            <dd>Administrator</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Active</dd>
          </div>
          <div>
            <dt>Two-factor</dt>
            <dd>Enabled</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>2025-11-18</dd>
          </div>
          <div>
            <dt>Last login</dt>
            <dd>Today 08:42 UTC</dd>
          </div>
          <div>
            <dt>Login failures</dt>
            <dd>0 in last 30 days</dd>
          </div>
        </dl>
      </div>
      <div>
        <SectionHeader title="Security actions" />
        <div className="settings-stack">
          <button
            className="outline-button"
            onClick={() => onAction("Reset 2FA")}
          >
            <KeyRound />
            Reset 2FA
          </button>
          <button
            className="outline-button"
            onClick={() => onAction("Revoke sessions")}
          >
            <LockKeyhole />
            Revoke sessions
          </button>
          <button
            className="outline-button"
            onClick={() => onAction("Revoke tokens")}
          >
            <KeyRound />
            Revoke tokens
          </button>
        </div>
      </div>
    </div>
  );
}
function Table({ headings, rows }: { headings: string[]; rows: string[][] }) {
  return (
    <div className="record-table-wrap">
      <table className="simple-table">
        <thead>
          <tr>
            {headings.map((item) => (
              <th key={item}>{item}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column}>
                  {column === 0 ? <strong>{cell}</strong> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
