"use client";

import { FormEvent, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, GitBranch, Pencil, Plus, Search, Share2, Trash2, X } from "lucide-react";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";

const content = {
  collections: {
    title: "Collections",
    description: "Organize and share related biomedical resources.",
    head: [
      "Name",
      "Description",
      "Resources",
      "Owner",
      "Visibility",
      "Updated",
    ],
    rows: [
      [
        "RNA expression atlas",
        "Curated bulk and single-cell expression datasets",
        "8",
        "Dr. Maya Chen",
        "Private",
        "2 hours ago",
      ],
      [
        "Reference annotations",
        "Genome builds, indexes, and gene maps",
        "12",
        "data-stewards",
        "Public",
        "Yesterday",
      ],
    ],
  },
  tags: {
    title: "Tags",
    description: "Browse the controlled vocabulary used across the catalog.",
    head: ["Tag", "Resources", "Description", "Updated"],
    rows: [
      ["rna-seq", "18", "RNA sequencing datasets and derivatives", "Today"],
      ["human", "42", "Homo sapiens resources", "Today"],
      ["clinical", "9", "Clinical and survival metadata", "Jul 8"],
    ],
  },
  schemas: {
    title: "Schemas",
    description: "Inspect reusable metadata and artifact schemas.",
    head: ["Schema", "Version", "Objects", "Status", "Updated"],
    rows: [
      ["expression-matrix", "2.1", "14", "Active", "Jul 10"],
      ["clinical-survival", "1.4", "6", "Active", "Jun 29"],
      ["genome-annotation", "3.0", "8", "Active", "Jun 18"],
    ],
  },
  relations: {
    title: "Relations",
    description: "Follow evidence-backed links between resources.",
    head: ["Source", "Relation type", "Target", "Evidence", "Updated"],
    rows: [
      [
        "Toil RNA-seq",
        "has_artifact",
        "Toil RNA-seq v1",
        "Provider manifest",
        "Today",
      ],
      [
        "TCGA clinical",
        "derived_from",
        "TCGA survival",
        "Pipeline run ing-7831",
        "Yesterday",
      ],
      [
        "GENCODE gene",
        "references",
        "GENCODE transcript",
        "GENCODE v44",
        "Jul 8",
      ],
    ],
  },
} as const;

export function CatalogSectionView() {
  const key = usePathname().split("/").at(-1) as keyof typeof content;
  const page = content[key] ?? content.collections;
  const [rows, setRows] = useState<string[][]>(() =>
    page.rows.map((x) => [...x]),
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const visible = useMemo(
    () =>
      rows.filter((r) =>
        r.join(" ").toLowerCase().includes(query.toLowerCase()),
      ),
    [query, rows],
  );
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRows((v) => [
      [
        String(data.get("name")),
        String(data.get("description")),
        "0",
        "You",
        "Private",
        "Just now",
      ],
      ...v,
    ]);
    setCreating(false);
  }
  return (
    <AppShell active={key}>
      <TopBar />
      <div className="workspace-page">
        <SectionHeader
          title={page.title}
          description={page.description}
          action={
            key === "collections" ? (
              <button
                className="primary-button"
                onClick={() => setCreating(true)}
              >
                <Plus />
                Create collection
              </button>
            ) : undefined
          }
        />
        <div className="workspace-toolbar">
          <label className="filter-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${page.title.toLowerCase()}…`}
            />
          </label>
          <select>
            <option>Recently updated</option>
            <option>Name</option>
          </select>
        </div>
        <div className="record-table-wrap">
          <table className="simple-table">
            <thead>
              <tr>
                {page.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
                {key === "collections" && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => (
                <tr
                  key={`${row[0]}-${i}`}
                  className={key === "relations" ? "clickable-row" : undefined}
                  tabIndex={key === "relations" ? 0 : undefined}
                  onClick={() => key === "relations" && setSelected(row)}
                  onKeyDown={(event) => event.key === "Enter" && key === "relations" && setSelected(row)}
                >
                  {row.map((cell, j) => (
                    <td key={j}>
                      {j === 0 ? (
                        key === "collections" ? (
                          <button
                            className="link-button"
                            onClick={() => setSelected(row)}
                          >
                            {cell}
                          </button>
                        ) : (
                          <strong>{cell}</strong>
                        )
                      ) : cell === "Public" || cell === "Active" ? (
                        <TinyBadge tone="green">{cell}</TinyBadge>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                  {key === "collections" && (
                    <td>
                      <button
                        className="row-action"
                        aria-label={`Delete ${row[0]}`}
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {creating && (
        <div className="modal-scrim">
          <form className="simple-dialog" onSubmit={create}>
            <h2>Create collection</h2>
            <label>
              Name
              <input name="name" required autoFocus />
            </label>
            <label>
              Description
              <textarea name="description" required />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="primary-button">Create collection</button>
            </div>
          </form>
        </div>
      )}
      {selected && key === "collections" && (
        <CollectionDrawer
          row={selected}
          onClose={() => setSelected(null)}
          onRename={(name) => {
            setRows((value) =>
              value.map((item) =>
                item === selected ? [name, ...item.slice(1)] : item,
              ),
            );
            setSelected((value) => (value ? [name, ...value.slice(1)] : value));
          }}
        />
      )}
      {selected && key === "relations" && (
        <RelationDrawer row={selected} onClose={() => setSelected(null)} />
      )}
      {deleting && (
        <div className="modal-scrim">
          <div className="simple-dialog" role="alertdialog" aria-modal="true">
            <h2>Delete collection?</h2>
            <p>
              {deleting[0]} will be removed. Resources remain in the catalog.
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setRows((value) => value.filter((item) => item !== deleting));
                  setDeleting(null);
                }}
              >
                Delete collection
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function RelationDrawer({ row, onClose }: { row: string[]; onClose: () => void }) {
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close relation details" /><aside className="resource-drawer" role="dialog" aria-modal="true" aria-label="Relation details"><div className="drawer-header"><div className="resource-title-wrap"><span className="resource-icon"><GitBranch /></span><div><h2>{row[1]}</h2><p>{row[0]} → {row[2]}</p></div></div><button className="icon-button" aria-label="Close relation details" onClick={onClose}><X /></button></div><div className="drawer-content"><div className="detail-section"><h3>Relationship</h3><div className="detail-grid"><div className="detail-item"><span>Source</span><strong>{row[0]}</strong></div><div className="detail-item"><span>Target</span><strong>{row[2]}</strong></div><div className="detail-item"><span>Type</span><strong><TinyBadge tone="purple">{row[1]}</TinyBadge></strong></div><div className="detail-item"><span>Updated</span><strong>{row[4]}</strong></div><div className="detail-item detail-wide"><span>Evidence</span><strong>{row[3]}</strong></div></div></div><div className="detail-section"><h3>Evidence trail</h3><div className="event-list"><div><span className="event-dot" />Provider statement accepted <small>{row[4]}</small></div><div><span className="event-dot" />Identifiers resolved <small>Checksum verified</small></div><div><span className="event-dot" />Relation published <small>Catalog index</small></div></div></div><button className="outline-button" onClick={() => onClose()}><ExternalLink />Open source resource</button></div></aside></>;
}

function CollectionDrawer({
  row,
  onClose,
  onRename,
}: {
  row: string[];
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [resources, setResources] = useState([
    "Toil RNA-seq (Homo sapiens)",
    "PBMC 3K TileDB filtered",
    "TCGA survival metadata",
  ]);
  const [renaming, setRenaming] = useState(false);
  const [shared, setShared] = useState(row[4] === "Public");
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="drawer-scrim" />
      <aside
        className="resource-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Collection details"
      >
        <div className="drawer-header">
          <div>
            <h2>{row[0]}</h2>
            <p>{row[1]}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close collection details"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="drawer-content">
          <div className="detail-section">
            <div className="section-row">
              <h3>Collection</h3>
              <button
                className="outline-button"
                onClick={() => setRenaming(true)}
              >
                <Pencil />
                Rename
              </button>
            </div>
            <label className="setting-row">
              <span>
                <strong>Share collection</strong>
                <small>
                  {shared
                    ? "Anyone with access can discover it"
                    : "Only you can view it"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
              />
            </label>
          </div>
          <div className="detail-section">
            <div className="section-row">
              <h3>Resources</h3>
              <button
                className="outline-button"
                onClick={() =>
                  setResources((value) => [...value, "GENCODE v44 gene map"])
                }
              >
                <Plus />
                Add resource
              </button>
            </div>
            {resources.map((resource) => (
              <div className="settings-row" key={resource}>
                <span>
                  <strong>{resource}</strong>
                  <small>Resource</small>
                </span>
                <button
                  className="row-action danger"
                  aria-label={`Remove ${resource}`}
                  onClick={() =>
                    setResources((value) =>
                      value.filter((item) => item !== resource),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
          <button className="outline-button" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/catalog/collections/${encodeURIComponent(row[0])}`); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>
            <Share2 />
            {copied ? "Copied" : "Copy share link"}
          </button>
        </div>
      </aside>
      {renaming && (
        <div className="modal-scrim">
          <form
            className="simple-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(String(new FormData(event.currentTarget).get("name")));
              setRenaming(false);
            }}
          >
            <h2>Rename collection</h2>
            <label>
              Name
              <input name="name" defaultValue={row[0]} required autoFocus />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
              <button className="primary-button">Rename</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
