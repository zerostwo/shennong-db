"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleSlash2, Copy, Download, ExternalLink, FileBox, Globe2, LockKeyhole, MoreHorizontal, Trash2, X } from "lucide-react";
import { getSession, type ResourceRecord } from "@/lib/api/adapter";
import { CopyButton, TinyBadge } from "./app-shell";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

type DrawerProps = { resource: ResourceRecord; onClose: () => void };
const tabs = ["Overview", "Schema", "Provenance", "Relations", "Access"] as const;

export function ResourceDrawer({ resource, onClose }: DrawerProps) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => { void getSession().then((session) => setCanDelete(session.role === "admin")).catch(() => setCanDelete(false)); }, []);

  useEffect(() => {
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>("button, a, select, input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteOpen) onClose();
      if (event.key !== "Tab" || !drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], select, input")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [deleteOpen, onClose]);

  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" />
      <aside ref={drawerRef} className="resource-drawer" role="dialog" aria-modal="true" aria-label="Resource details">
        <div className="drawer-header">
          <div className="resource-title-wrap">
            <span className="resource-icon"><FileBox /></span>
            <div>
              <div className="drawer-title-row"><h2>{resource.name}</h2><TinyBadge tone="blue">{resource.kind}</TinyBadge></div>
              <div className="resource-id mono">{resource.id}<CopyButton value={resource.id} /></div>
            </div>
          </div>
          <div className="drawer-header-actions">
            <button className="icon-button" aria-label="More resource actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal /></button>
            <button className="icon-button" onClick={onClose} aria-label="Close drawer"><X /></button>
            {menuOpen && <div className="row-action-menu drawer-action-menu">
              <a href={`/catalog/resources/${resource.id}`}><ExternalLink />Open resource page</a>
              <button onClick={() => { void navigator.clipboard?.writeText(resource.source); setMenuOpen(false); }}><Copy />Copy source URI</button>
              <a href={`/api/v1/resources/${resource.id}`} download><Download />Download metadata</a>
              {canDelete && <button className="danger-text" onClick={() => { setDeleteOpen(true); setMenuOpen(false); }}><Trash2 />Delete Resource</button>}
            </div>}
          </div>
        </div>
        <div className="drawer-tabs" role="tablist">
          {tabs.map((item) => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}
        </div>
        <div className="drawer-content">
          {tab === "Overview" && <Overview resource={resource} />}
          {tab === "Provenance" && <Provenance resource={resource} />}
          {tab === "Schema" && <Schema />}
          {tab === "Relations" && <Relations resource={resource} />}
          {tab === "Access" && <Access resource={resource} />}
        </div>
        {(tab === "Overview" || tab === "Access") && <div className="auth-callout"><div><strong>Authentication</strong><p>Use an API token for programmatic access.</p></div><a href="/console/api-access">View Tokens</a></div>}
      </aside>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader><DialogTitle>Delete Resource</DialogTitle><DialogDescription>This destructive request permanently removes {resource.name} after server-side authorization.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" onClick={onClose}><Trash2 data-icon="inline-start" />Delete Resource</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Overview({ resource }: { resource: ResourceRecord }) {
  return <><div className="detail-section"><h3>Overview</h3><div className="detail-grid"><Detail label="Description" value={resource.description} wide /><Detail label="Visibility" value={<><TinyBadge tone={resource.visibility === "Public" ? "blue" : "amber"}>{resource.visibility}</TinyBadge><span className="inline-muted">{resource.visibility === "Public" ? "Anyone can discover and read" : "Grant required"}</span></>} /><Detail label="Backend" value={<>{resource.backend} <ExternalLink size={13} /></>} /><Detail label="Storage class" value={<span className="mono soft-code">{resource.dataClass}</span>} /><Detail label="Size" value={resource.size} /><Detail label="Created" value="2024-02-18 14:22:11 UTC" /><Detail label="Updated" value={resource.updated} /><Detail label="Owner" value={resource.owner} /><Detail label="Tags" value={<div className="tag-row"><TinyBadge>rna-seq</TinyBadge><TinyBadge>expression</TinyBadge><TinyBadge>{resource.organism}</TinyBadge></div>} /></div></div><Integrity resource={resource} /><ApiExample resource={resource} /><Allowed /></>;
}

function Detail({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={`detail-item ${wide ? "detail-wide" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Integrity({ resource }: { resource: ResourceRecord }) {
  return <div className="detail-section"><h3>Integrity &amp; Provenance</h3><div className="detail-grid"><Detail label="SHA256" value={<span className="copy-value mono">{resource.checksum}<CopyButton value={resource.checksum} /></span>} wide /><Detail label="Source URI" value={<span className="copy-value mono break-value">{resource.source}<CopyButton value={resource.source} /></span>} wide /><Detail label="Pipeline version" value="shennong-ingest 2.4.1" /><Detail label="Derived from" value="Provider manifest" /><Detail label="Registered at" value="2024-02-18 14:22 UTC" /><Detail label="Last verified" value="2 hours ago" /><Detail label="Reference genome" value="GRCh38" /><Detail label="Annotation release" value="GENCODE v44" /></div></div>;
}

function ApiExample({ resource }: { resource: ResourceRecord }) {
  const [language, setLanguage] = useState<"Python" | "R" | "cURL">("Python");
  const [copied, setCopied] = useState(false);
  const endpoint = `/api/v1/resources/${resource.id}`;
  const examples = {
    Python: `import requests\n\nresponse = requests.get(\n    "${endpoint}",\n    headers={"Authorization": "Bearer $SHENNONG_TOKEN"},\n)\nresource = response.json()`,
    R: `library(shennongdata)\n\nresource <- sn_load_data("${resource.id}")\nsn_fetch_data(resource, c("tumor", "group", "YTHDF2"), layer = "tpm")`,
    cURL: `curl --fail --request GET \\\n+  "${endpoint}" \\\n+  --header "Authorization: Bearer $SHENNONG_TOKEN"`,
  };
  const code = examples[language];
  return <div className="detail-section"><div className="section-row"><h3>API Endpoints</h3><select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} aria-label="API language"><option>Python</option><option>R</option><option>cURL</option></select></div><div className="code-block"><button aria-label="Copy code" onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : <Copy size={14} />}</button><code>{code}</code></div></div>;
}

function Allowed() {
  return <div className="detail-section"><h3>Allowed Operations</h3><div className="allowed-grid"><div><AllowedItem label="Discover" allowed /><AllowedItem label="Read" allowed /><AllowedItem label="Query" allowed /><AllowedItem label="Download" allowed /></div><div><AllowedItem label="Write" /><AllowedItem label="Update" /><AllowedItem label="Delete" /></div></div></div>;
}
function AllowedItem({ label, allowed = false }: { label: string; allowed?: boolean }) {
  return <div className={`allowed-item ${allowed ? "allowed" : "blocked"}`}>{allowed ? <CheckCircle2 /> : <CircleSlash2 />}{label}</div>;
}

function Provenance({ resource }: { resource: ResourceRecord }) {
  return <><div className="detail-section"><div className="section-row"><h3>Provenance lineage</h3><a className="text-button" href={`/catalog/relations?resource=${resource.id}`}>View full lineage <ExternalLink size={13} /></a></div><div className="lineage"><LineageNode label="S3 raw bucket · WGS reads" tone="raw" /><span>→</span><LineageNode label="Alignment (STAR)" tone="artifact" /><span>→</span><LineageNode label="Quantification" tone="artifact" /><span>→</span><LineageNode label={resource.name} tone="resource" /></div></div><Integrity resource={resource} /><div className="detail-section"><h3>Verification events</h3><div className="event-list"><div><span className="event-dot" />Checksum verified <small>2 hours ago</small></div><div><span className="event-dot" />Pipeline completed <small>2024-02-18</small></div><div><span className="event-dot" />Registered in catalog <small>2024-02-18</small></div></div></div></>;
}
function LineageNode({ label, tone }: { label: string; tone: string }) {
  return <div className={`lineage-node ${tone}`}><span>{tone === "raw" ? "S3" : tone === "artifact" ? "ƒ" : "R"}</span><strong>{label}</strong><small>urn:sd:{label.toLowerCase().replaceAll(" ", "-")}</small></div>;
}

function Schema() {
  return <div className="detail-section"><div className="section-row"><h3>Schema (logical)</h3><a className="text-button" href={`data:application/json;charset=utf-8,${encodeURIComponent('{"type":"object","properties":{"gene_id":{"type":"string"},"value":{"type":"number"}}}')}`} download="shennong-schema.json">Download JSON schema <Download size={13} /></a></div><div className="schema-block"><span>1</span><code>{`{
  "type": "object",
  "properties": {
    "gene_id": { "type": "string" },
    "gene_name": { "type": "string" },
    "transcript_id": { "type": "string" },
    "sample_id": { "type": "string" },
    "value": { "type": "number" }
  }
}`}</code></div></div>;
}

function Relations({ resource }: { resource: ResourceRecord }) {
  return <div className="detail-section"><h3>Related objects</h3><div className="relation-list"><div><GitIcon /><span><strong>{resource.name} v1</strong><small>has_artifact · canonical</small></span><ExternalLink /></div><div><GitIcon /><span><strong>TCGA clinical → survival</strong><small>derived_from · public</small></span><ExternalLink /></div><div><GitIcon /><span><strong>GENCODE gene ↔ transcript</strong><small>references · public</small></span><ExternalLink /></div></div></div>;
}
function GitIcon() { return <span className="relation-icon"><Globe2 /></span>; }

function Access({ resource }: { resource: ResourceRecord }) {
  return <div className="detail-section"><h3>Access policy</h3><div className="policy-table"><div><strong>Principal</strong><strong>Access</strong><strong>Conditions</strong></div><div><span>Everyone</span><span>Read</span><span>—</span></div><div><span>Authenticated users</span><span>Read</span><span>—</span></div><div><span>{resource.owner}</span><span>{resource.visibility === "Public" ? "Read" : "Write"}</span><span>MFA required</span></div><div><span>data-stewards</span><span>Admin</span><span>IP allowlist</span></div></div><a className="text-button" href="/docs"><LockKeyhole />View policy documentation <ExternalLink size={13} /></a></div>;
}
