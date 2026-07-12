"use client";
import { useMemo, useState } from "react";
import {
  FileBox,
  Heart,
  MoreHorizontal,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { jobs, resources } from "@/lib/mock-data";
import { SectionHeader, TinyBadge } from "./app-shell";
type Page = "my-data" | "uploads" | "jobs";
export function DataOpsView({ page }: { page: Page }) {
  if (page === "my-data") return <MyData />;
  if (page === "uploads") return <Uploads />;
  return <Jobs />;
}
function MyData() {
  const [tab, setTab] = useState("Owned");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(new Set(["toil"]));
  const rows = useMemo(
    () =>
      resources
        .filter((row) =>
          row.join(" ").toLowerCase().includes(query.toLowerCase()),
        )
        .filter((row) => tab !== "Favorites" || favorites.has(row[1])),
    [favorites, query, tab],
  );
  return (
    <div className="console-panel">
      <SectionHeader
        title="My Data"
        description="Owned, shared, favorite, and collected resources."
        action={
          <a className="primary-button" href="/console/uploads/new">
            <Plus />
            Upload data
          </a>
        }
      />
      <div className="console-tabs" role="tablist">
        {["Owned", "Shared with me", "Favorites", "Collections"].map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="workspace-toolbar">
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search my resources…"
        />
      </div>
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th>Type</th>
              <th>Visibility</th>
              <th>Backend</th>
              <th>Data class</th>
              <th>Favorite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[1]}>
                <td>
                  <strong>{row[0]}</strong>
                </td>
                {row.slice(1).map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
                <td>
                  <button
                    className={`row-action ${favorites.has(row[1]) ? "favorite" : ""}`}
                    aria-label={`${favorites.has(row[1]) ? "Remove" : "Add"} ${row[0]} ${favorites.has(row[1]) ? "from" : "to"} favorites`}
                    onClick={() =>
                      setFavorites((value) => {
                        const next = new Set(value);
                        if (next.has(row[1])) next.delete(row[1]);
                        else next.add(row[1]);
                        return next;
                      })
                    }
                  >
                    <Heart />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty-state">
            <Heart />
            <h3>No favorite resources</h3>
            <p>Add resources from My Data or the public catalog.</p>
          </div>
        )}
      </div>
    </div>
  );
}
type UploadRow = {
  name: string;
  dataset: string;
  files: string;
  size: string;
  status: string;
  progress: string;
  created: string;
};
const initialUploads: UploadRow[] = [
  {
    name: "PBMC May snapshot",
    dataset: "PBMC 3K",
    files: "3",
    size: "4.8 GB",
    status: "Materializing",
    progress: "72%",
    created: "12 min ago",
  },
  {
    name: "TCGA clinical refresh",
    dataset: "TCGA survival",
    files: "2",
    size: "82 MB",
    status: "Available",
    progress: "100%",
    created: "Yesterday",
  },
  {
    name: "WGS batch 24",
    dataset: "S3 raw bucket",
    files: "18",
    size: "412 GB",
    status: "Failed",
    progress: "48%",
    created: "Jul 8",
  },
];
function Uploads() {
  const [rows, setRows] = useState(initialUploads);
  const [selected, setSelected] = useState<UploadRow | null>(null);
  const [confirm, setConfirm] = useState<UploadRow | null>(null);
  return (
    <div className="console-panel">
      <SectionHeader
        title="Uploads"
        description="Track transfer, validation, and materialization."
        action={
          <a className="primary-button" href="/console/uploads/new">
            <Plus />
            New upload
          </a>
        }
      />
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              {[
                "Upload name",
                "Dataset",
                "Files",
                "Total size",
                "Status",
                "Progress",
                "Created",
                "Actions",
              ].map((item) => (
                <th key={item}>{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <button
                    className="link-button"
                    onClick={() => setSelected(row)}
                  >
                    {row.name}
                  </button>
                </td>
                <td>{row.dataset}</td>
                <td>{row.files}</td>
                <td>{row.size}</td>
                <td>
                  <TinyBadge
                    tone={
                      row.status === "Available"
                        ? "green"
                        : row.status === "Failed"
                          ? "amber"
                          : "blue"
                    }
                  >
                    {row.status}
                  </TinyBadge>
                </td>
                <td>{row.progress}</td>
                <td>{row.created}</td>
                <td>
                  <div className="table-actions">
                    {row.status === "Failed" && (
                      <button
                        className="row-action"
                        aria-label={`Retry ${row.name}`}
                        onClick={() =>
                          setRows((value) =>
                            value.map((item) =>
                              item === row
                                ? {
                                    ...item,
                                    status: "Validating",
                                    progress: "52%",
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <RefreshCw />
                      </button>
                    )}
                    {row.status !== "Available" && (
                      <button
                        className="row-action danger"
                        aria-label={`Cancel ${row.name}`}
                        onClick={() => setConfirm(row)}
                      >
                        <X />
                      </button>
                    )}
                    <button
                      className="row-action"
                      aria-label={`View ${row.name}`}
                      onClick={() => setSelected(row)}
                    >
                      <MoreHorizontal />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <UploadDrawer row={selected} onClose={() => setSelected(null)} />
      )}{" "}
      {confirm && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>Cancel Upload</h2>
            <p>
              Multipart transfer and validation will stop. Uploaded parts may be
              retained according to staging policy.
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setConfirm(null)}
              >
                Keep upload
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setRows((value) =>
                    value.map((item) =>
                      item === confirm
                        ? { ...item, status: "Cancelled" }
                        : item,
                    ),
                  );
                  setConfirm(null);
                }}
              >
                Cancel upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function UploadDrawer({
  row,
  onClose,
}: {
  row: UploadRow;
  onClose: () => void;
}) {
  return (
    <>
      <div className="drawer-scrim" />
      <aside
        className="resource-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Upload details"
      >
        <div className="drawer-header">
          <div>
            <h2>{row.name}</h2>
            <p>
              {row.dataset} · {row.size}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close upload details"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="drawer-content">
          <div className="detail-section">
            <h3>Upload progress</h3>
            <div className="upload-progress">
              <span style={{ width: row.progress }} />
            </div>
            <p>
              {row.status} · {row.progress}
            </p>
          </div>
          <div className="detail-section">
            <h3>Files</h3>
            {["expression.h5ad", "metadata.tsv", "manifest.json"].map(
              (file) => (
                <div className="settings-row" key={file}>
                  <FileBox />
                  <span>
                    <strong>{file}</strong>
                    <small>Checksum verified</small>
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
function Jobs() {
  const [selected, setSelected] = useState<readonly string[] | null>(null);
  const [rows, setRows] = useState<string[][]>(() => jobs.map((row) => [...row]));
  return (
    <div className="console-panel">
      <SectionHeader
        title="Ingestion jobs"
        description="Follow registration, verification, and materialization."
      />
      <div className="record-table-wrap">
        <table className="simple-table">
          <thead>
            <tr>
              {[
                "Job ID",
                "Resource",
                "Provider",
                "State",
                "Progress",
                "Duration",
                "Worker",
                "Actions",
              ].map((item) => (
                <th key={item}>{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                <td>
                  <button
                    className="link-button"
                    onClick={() => setSelected(row)}
                  >
                    {row[0]}
                  </button>
                </td>
                {row.slice(1).map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
                <td>
                  {row[3] === "failed" && (
                    <button
                      className="outline-button"
                      onClick={() =>
                        setRows((value) =>
                          value.map((item) =>
                            item === row
                              ? [
                                  ...item.slice(0, 3),
                                  "registered",
                                  "0%",
                                  "—",
                                  "queued",
                                ]
                              : item,
                          ),
                        )
                      }
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <JobDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function JobDrawer({
  row,
  onClose,
}: {
  row: readonly string[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Timeline");
  return (
    <>
      <div className="drawer-scrim" />
      <aside
        className="resource-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Ingestion job details"
      >
        <div className="drawer-header">
          <div>
            <h2>{row[0]}</h2>
            <p>{row[1]}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close job details"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="drawer-tabs">
          {["Timeline", "Logs", "Files", "Warnings", "Errors"].map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="drawer-content">
          <div className="detail-section">
            <h3>{tab}</h3>
            {tab === "Logs" ? (
              <pre className="log-view">
                registered provider manifest{"\n"}checksum verified{"\n"}
                materializing resource
              </pre>
            ) : (
              <div className="event-list">
                {[
                  "registered",
                  "downloading",
                  "verifying",
                  "materializing",
                  "available",
                ].map((item, index) => (
                  <div key={item}>
                    <span className="event-dot" />
                    <strong>{item}</strong>
                    <small>
                      {index < 3
                        ? "Completed"
                        : index === 3
                          ? `${row[4]} complete`
                          : "Pending"}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
