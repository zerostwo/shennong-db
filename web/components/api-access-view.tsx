"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Plus, RotateCw, Trash2, X } from "lucide-react";
import {
  getSession,
  issueUserToken,
  listUserTokens,
  ShennongApiError,
} from "@/lib/api/adapter";
import { CopyButton, SectionHeader, TinyBadge } from "./app-shell";
import dynamic from "next/dynamic";

const AppLineChart = dynamic(
  () => import("./charts/line-chart").then((module) => module.AppLineChart),
  { ssr: false, loading: () => <div className="chart-skeleton" /> },
);

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created: string;
  lastUsed: string;
  expires: string;
};
const demo: TokenRow[] = [
  {
    id: "tok-1",
    name: "Analysis workstation",
    prefix: "sndb_7f2a••••",
    scopes: ["resource.read", "query.execute"],
    created: "Jun 18",
    lastUsed: "2 min ago",
    expires: "Sep 18",
  },
  {
    id: "tok-2",
    name: "RStudio server",
    prefix: "sndb_5b19••••",
    scopes: ["resource.read", "artifact.download"],
    created: "Jul 1",
    lastUsed: "Yesterday",
    expires: "Oct 1",
  },
];

export function ApiAccessView() {
  const [rows, setRows] = useState<TokenRow[]>(demo);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{
    row: TokenRow;
    action: "rotate" | "revoke";
  } | null>(null);
  useEffect(() => {
    void getSession()
      .then((s) => (s.authenticated ? listUserTokens(s.user_id) : []))
      .then((items) => {
        if (items.length)
          setRows(
            items.map((item, i) => {
              const x = item as Record<string, unknown>;
              return {
                id: String(x.id ?? `token-${i}`),
                name: String(x.name ?? `Token ${i + 1}`),
                prefix: String(x.prefix ?? "sndb_••••"),
                scopes: Array.isArray(x.scopes)
                  ? x.scopes.map(String)
                  : ["resource.read"],
                created: String(x.created_at ?? "Today"),
                lastUsed: String(x.last_used ?? "Never"),
                expires: String(x.expires_at ?? "90 days"),
              };
            }),
          );
      })
      .catch(() => undefined);
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const scopes = data.getAll("scope").map(String);
    try {
      const session = await getSession();
      if (!session.authenticated)
        throw new Error("Sign in before creating a token.");
      const days = Number(data.get("expiration") ?? 90);
      const issued = await issueUserToken(
        session.user_id,
        days * 86400,
        scopes,
      );
      const name = String(data.get("name"));
      setRows((v) => [
        {
          id: `new-${Date.now()}`,
          name,
          prefix: `${issued.token.slice(0, 9)}••••`,
          scopes,
          created: "Just now",
          lastUsed: "Never",
          expires: `${days} days`,
        },
        ...v,
      ]);
      setCreateOpen(false);
      setSecret(issued.token);
    } catch (reason) {
      setError(
        reason instanceof ShennongApiError || reason instanceof Error
          ? reason.message
          : "Token creation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  function applyConfirm() {
    if (!confirm) return;
    if (confirm.action === "revoke")
      setRows((v) => v.filter((x) => x.id !== confirm.row.id));
    else
      setRows((v) =>
        v.map((x) =>
          x.id === confirm.row.id
            ? {
                ...x,
                prefix: "sndb_rotated••••",
                lastUsed: "Never",
                created: "Just now",
              }
            : x,
        ),
      );
    setConfirm(null);
  }
  return (
    <>
      <div className="api-base">
        <span>Base URL</span>
        <div>
          <code>https://api.example.org/api/v1</code>
          <CopyButton value="https://api.example.org/api/v1" />
        </div>
      </div>
      <div className="api-metrics">
        {[
          ["Requests this month", "2.14M"],
          ["Rate limit", "1,250 / min"],
          ["Data transferred", "186.4 GB"],
          ["Active tokens", String(rows.length)],
        ].map(([a, b]) => (
          <div className="console-metric" key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
          </div>
        ))}
      </div>
      <div className="console-grid">
        <div className="console-panel">
          <SectionHeader
            title="API calls · Last 30 days"
            action={
              <select aria-label="Usage range">
                <option>30 days</option>
                <option>7 days</option>
                <option>90 days</option>
              </select>
            }
          />
          <UsageChart />
        </div>
        <div className="console-panel">
          <SectionHeader title="Rate limit" />
          <div className="rate-ring">62%</div>
          <div className="rate-copy">
            <strong>1,250 / 2,000</strong>
            <span>Resets in 42 seconds</span>
          </div>
        </div>
      </div>
      <div className="console-panel token-panel">
        <SectionHeader
          title="Personal tokens"
          description="Secrets are shown only once."
          action={
            <button
              className="primary-button"
              onClick={() => setCreateOpen(true)}
            >
              <Plus />
              Create token
            </button>
          }
        />
        <div className="record-table-wrap">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Token name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>
                    <code>{row.prefix}</code>
                  </td>
                  <td>
                    <div className="tag-row">
                      {row.scopes.map((x) => (
                        <TinyBadge key={x} tone="blue">
                          {x}
                        </TinyBadge>
                      ))}
                    </div>
                  </td>
                  <td>{row.created}</td>
                  <td>{row.lastUsed}</td>
                  <td>{row.expires}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="row-action"
                        aria-label={`Rotate ${row.name}`}
                        onClick={() => setConfirm({ row, action: "rotate" })}
                      >
                        <RotateCw />
                      </button>
                      <button
                        className="row-action danger"
                        aria-label={`Revoke ${row.name}`}
                        onClick={() => setConfirm({ row, action: "revoke" })}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {createOpen && (
        <div className="modal-scrim">
          <form className="simple-dialog" onSubmit={create}>
            <button
              type="button"
              className="dialog-close"
              onClick={() => setCreateOpen(false)}
              aria-label="Close token dialog"
            >
              <X />
            </button>
            <div className="dialog-icon">
              <KeyRound />
            </div>
            <h2>Create API Token</h2>
            <p>
              Choose the minimum scopes required. The secret is displayed once.
            </p>
            <label>
              Token name
              <input
                name="name"
                required
                autoFocus
                placeholder="Analysis workstation"
              />
            </label>
            <label>
              Expiration
              <select name="expiration" defaultValue="90">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
            <fieldset>
              <legend>Scopes</legend>
              {[
                "resource.read",
                "artifact.download",
                "query.execute",
                "resource.write",
              ].map((scope, i) => (
                <label className="check-label" key={scope}>
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={i === 0}
                  />
                  {scope}
                </label>
              ))}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Creating…" : "Create token"}
              </button>
            </div>
          </form>
        </div>
      )}
      {secret && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="dialog" aria-modal="true">
            <div className="dialog-icon">
              <KeyRound />
            </div>
            <h2>Token created</h2>
            <p>Copy the token now. It will not be shown again.</p>
            <div className="secret-token">
              <code>{secret}</code>
              <CopyButton value={secret} />
            </div>
            <button className="primary-button" onClick={() => setSecret(null)}>
              I saved this token
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>
              {confirm.action === "revoke" ? "Revoke Token" : "Rotate Token"}
            </h2>
            <p>
              {confirm.action === "revoke"
                ? "This immediately invalidates the token and cannot be undone."
                : "The current secret will stop working after rotation."}
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className={
                  confirm.action === "revoke"
                    ? "danger-button"
                    : "primary-button"
                }
                onClick={applyConfirm}
              >
                {confirm.action === "revoke" ? "Revoke token" : "Rotate token"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UsageChart() {
  return (
    <AppLineChart label="API calls increased from 58,000 to 91,000 per day" />
  );
}
