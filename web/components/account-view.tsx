"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Monitor,
  Smartphone,
  X,
} from "lucide-react";
import { SectionHeader, TinyBadge } from "./app-shell";

type AccountPage = "profile" | "security" | "sessions" | "login-history";
export function AccountView({ page }: { page: AccountPage }) {
  if (page === "profile") return <Profile />;
  if (page === "security") return <Security />;
  if (page === "sessions") return <Sessions />;
  return <LoginHistory />;
}

function Profile() {
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }
  return (
    <form className="console-panel" onSubmit={submit}>
      <SectionHeader
        title="Account profile"
        description="Identity changes are audited."
        action={<button className="primary-button">Save changes</button>}
      />
      <div className="profile-avatar-row">
        <span className="avatar avatar-green">MC</span>
        <div>
          <strong>Profile photo</strong>
          <small>JPG or PNG · 2 MB maximum</small>
        </div>
        <label className="outline-button avatar-upload">
          Change avatar
          <input type="file" accept="image/png,image/jpeg" hidden onChange={() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Display name
          <input name="displayName" defaultValue="Dr. Maya Chen" required />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue="maya.chen@shennong.org"
            required
          />
        </label>
        <label>
          Organization
          <input
            name="organization"
            defaultValue="Shennong Biomedical Institute"
          />
        </label>
        <label>
          Role
          <input value="Administrator" disabled />
        </label>
        <label>
          Timezone
          <select defaultValue="Asia/Shanghai">
            <option>Asia/Shanghai</option>
            <option>UTC</option>
            <option>America/New_York</option>
          </select>
        </label>
        <label>
          Locale
          <select defaultValue="en">
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
      </div>
      {saved && <Toast message="Profile saved" />}
    </form>
  );
}

function Security() {
  const [dialog, setDialog] = useState<
    "password" | "twofa" | "recovery" | null
  >(null);
  const [done, setDone] = useState("");
  function complete(message: string) {
    setDialog(null);
    setDone(message);
    setTimeout(() => setDone(""), 1800);
  }
  return (
    <>
      <div className="settings-stack">
        <SecurityRow
          icon={LockKeyhole}
          title="Password"
          detail="Last changed 42 days ago"
          action="Change password"
          onClick={() => setDialog("password")}
        />
        <SecurityRow
          icon={Smartphone}
          title="Two-factor authentication"
          detail="Authenticator app is enabled"
          action="Manage 2FA"
          onClick={() => setDialog("twofa")}
        />
        <SecurityRow
          icon={KeyRound}
          title="Recovery codes"
          detail="8 unused recovery codes"
          action="View codes"
          onClick={() => setDialog("recovery")}
        />
        <SecurityRow
          icon={Monitor}
          title="Active sessions"
          detail="2 signed-in devices"
          action="Review sessions"
          href="/console/sessions"
        />
        <SecurityRow
          icon={KeyRound}
          title="API tokens"
          detail="2 active personal tokens"
          action="Manage tokens"
          href="/console/api-access"
        />
      </div>
      {dialog === "password" && (
        <div className="modal-scrim">
          <form
            className="simple-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              complete("Password updated");
            }}
          >
            <DialogClose onClick={() => setDialog(null)} />
            <h2>Change password</h2>
            <label>
              Current password
              <input type="password" required />
            </label>
            <label>
              New password
              <input type="password" minLength={12} required />
            </label>
            <label>
              Confirm new password
              <input type="password" minLength={12} required />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button className="primary-button">Update password</button>
            </div>
          </form>
        </div>
      )}
      {dialog === "twofa" && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="dialog" aria-modal="true">
            <DialogClose onClick={() => setDialog(null)} />
            <h2>Two-factor authentication</h2>
            <p>
              Scan the authenticator key, then confirm a current six-digit code.
            </p>
            <div className="twofa-key">
              <code>JBSW Y3DP EHPK 3PXP</code>
            </div>
            <label>
              Authentication code
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                placeholder="000000"
              />
            </label>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => complete("Two-factor authentication verified")}
              >
                Verify
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog === "recovery" && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="dialog" aria-modal="true">
            <DialogClose onClick={() => setDialog(null)} />
            <h2>Recovery codes</h2>
            <p>Store these single-use codes somewhere secure.</p>
            <div className="recovery-grid">
              {[
                "A7KD-2MPQ",
                "V9TR-6HNX",
                "B4CW-8JLF",
                "Q2ZS-5REG",
                "M8PY-3VKT",
                "D6HU-9XAB",
                "F3LN-7QWE",
                "K5GX-4RTY",
              ].map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    "A7KD-2MPQ V9TR-6HNX B4CW-8JLF Q2ZS-5REG M8PY-3VKT D6HU-9XAB F3LN-7QWE K5GX-4RTY",
                  )
                }
              >
                Copy codes
              </button>
              <button
                className="primary-button"
                onClick={() => complete("Recovery codes acknowledged")}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {done && <Toast message={done} />}
    </>
  );
}

function SecurityRow({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
  href,
}: {
  icon: typeof LockKeyhole;
  title: string;
  detail: string;
  action: string;
  onClick?: () => void;
  href?: string;
}) {
  return (
    <div className="settings-row">
      <Icon />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {href ? (
        <a className="outline-button" href={href}>
          {action}
        </a>
      ) : (
        <button className="outline-button" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  );
}

type Session = {
  device: string;
  ip: string;
  created: string;
  active: string;
  current: boolean;
};
function Sessions() {
  const [rows, setRows] = useState<Session[]>([
    {
      device: "Firefox · Linux",
      ip: "192.168.3.10",
      created: "Jul 8",
      active: "Now",
      current: true,
    },
    {
      device: "Safari · macOS",
      ip: "10.24.1.5",
      created: "Jun 29",
      active: "2 days ago",
      current: false,
    },
  ]);
  const [selected, setSelected] = useState<Session | null>(null);
  return (
    <div className="console-panel">
      <SectionHeader
        title="Active sessions"
        description="Revoking a session signs that device out immediately."
      />
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>IP</th>
              <th>Created</th>
              <th>Last active</th>
              <th>Current</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.device}-${row.ip}`}>
                <td>
                  <strong>{row.device}</strong>
                </td>
                <td>
                  <code>{row.ip}</code>
                </td>
                <td>{row.created}</td>
                <td>{row.active}</td>
                <td>
                  {row.current ? (
                    <TinyBadge tone="green">Current</TinyBadge>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    className="danger-button compact"
                    disabled={row.current}
                    onClick={() => setSelected(row)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>Revoke session?</h2>
            <p>
              {selected.device} at {selected.ip} will need to sign in again.
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setRows((value) => value.filter((row) => row !== selected));
                  setSelected(null);
                }}
              >
                Revoke session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const loginRows = [
    [
      "Today 08:42",
      "192.168.3.10",
      "Shanghai, CN",
      "Linux",
      "Firefox 128",
      "Success",
    ],
    [
      "Jul 11 22:18",
      "203.0.113.14",
      "Unknown",
      "macOS",
      "Safari",
      "2FA failed",
    ],
    [
      "Jul 10 09:14",
      "192.168.3.10",
      "Shanghai, CN",
      "Linux",
      "Firefox 128",
      "Success",
    ],
];

function LoginHistory() {
  const [result, setResult] = useState("all");
  const visible = useMemo(
    () =>
      loginRows.filter(
        (row) =>
          result === "all" ||
          (result === "success" ? row[5] === "Success" : row[5] !== "Success"),
      ),
    [result],
  );
  return (
    <div className="console-panel">
      <SectionHeader
        title="Login history"
        description="Security events are retained according to instance policy."
      />
      <div className="workspace-toolbar">
        <label>
          Result
          <select
            value={result}
            onChange={(event) => setResult(event.target.value)}
          >
            <option value="all">All results</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              {["Time", "IP", "Location", "Device", "Browser", "Result"].map(
                (item) => (
                  <th key={item}>{item}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>
                    {column === 5 ? (
                      <TinyBadge tone={cell === "Success" ? "green" : "amber"}>
                        {cell}
                      </TinyBadge>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DialogClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="dialog-close"
      onClick={onClick}
      aria-label="Close dialog"
    >
      <X />
    </button>
  );
}
function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      <CheckCircle2 />
      {message}
    </div>
  );
}
