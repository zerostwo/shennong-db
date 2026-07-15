"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import {
  createBackup,
  createGrant,
  deleteGrant,
  getAdminOverview,
  getHealth,
  getSettings,
  getStorageSummary,
  getUsage,
  installProvider,
  listAllTokens,
  listAuditEvents,
  listBackups,
  listGrants,
  listIngestionJobs,
  listProviders,
  listUsers,
  revokeToken,
  restoreBackup,
  updateSetting,
  updateUser,
  type JsonRecord,
} from "@/lib/api/adapter";
import { AppShell, SectionHeader, TinyBadge, TopBar } from "./app-shell";

const AppLineChart = dynamic(() => import("./charts/line-chart").then((module) => module.AppLineChart), { ssr: false, loading: () => <div className="chart-skeleton" /> });

export type Section = "dashboard" | "users" | "settings" | "grants" | "tokens" | "providers" | "ingestion" | "storage" | "monitoring" | "audit" | "security" | "backups";
const copy: Record<Section, [string, string]> = {
  dashboard: ["Overview", "Live system health, usage, and activity."], users: ["User Management", "Manage persisted identities and account state."], grants: ["Grants", "Control persisted resource scopes and expirations."], tokens: ["Tokens", "Review and revoke issued API credentials."], providers: ["Providers", "Install provider manifests exposed by this instance."], ingestion: ["Ingestion jobs", "Monitor real provider materialization jobs."], storage: ["Storage", "Review artifact storage measured from Resources."], monitoring: ["Monitoring", "Inspect recorded API traffic and backend health."], audit: ["Audit log", "Review persisted governance events."], security: ["Security", "Configure enforced authentication policies."], backups: ["Backups", "Create and review metadata snapshots in object storage."], settings: ["System Settings", "Persist instance configuration in PostgreSQL."],
};

type Data = { rows: JsonRecord[]; health?: JsonRecord; overview?: JsonRecord; usage?: JsonRecord; settings?: JsonRecord; storage?: JsonRecord };

export function AdminSectionView({ section }: { section: Section }) {
  const [data, setData] = useState<Data>({ rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      if (section === "dashboard") {
        const [health, overview, usage, rows] = await Promise.all([getHealth(), getAdminOverview(), getUsage(30), listAuditEvents()]);
        setData({ health, overview, usage, rows: rows as JsonRecord[] });
      } else if (section === "monitoring") {
        const [health, usage] = await Promise.all([getHealth(), getUsage(30)]); setData({ health, usage, rows: [] });
      } else if (section === "storage") {
        const [storage, settings] = await Promise.all([getStorageSummary(), getSettings()]); setData({ storage, settings, rows: [] });
      } else if (section === "settings" || section === "security") setData({ settings: await getSettings(), rows: [] });
      else if (section === "users") setData({ rows: await listUsers() as JsonRecord[] });
      else if (section === "grants") setData({ rows: await listGrants() });
      else if (section === "tokens") setData({ rows: await listAllTokens() });
      else if (section === "providers") setData({ rows: await listProviders() as JsonRecord[] });
      else if (section === "ingestion") setData({ rows: await listIngestionJobs() });
      else if (section === "audit") setData({ rows: await listAuditEvents() as JsonRecord[] });
      else if (section === "backups") setData({ rows: await listBackups() });
      setUpdated(new Date().toLocaleTimeString());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); }
    finally { setLoading(false); }
  }, [section]);
  useEffect(() => { void load(); }, [load]);
  const [title, description] = copy[section];
  return <AppShell variant="admin" active={section}><TopBar title={title} description={description} search={false} action={<div className="admin-refresh"><span>{updated ? `Updated ${updated}` : "Not refreshed"}</span><button className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw />Refresh</button></div>} /><div className="admin-page">{error && <div className="error-banner" role="alert">{error}</div>}{loading ? <div className="loading-state">Loading live data…</div> : <AdminContent section={section} data={data} reload={load} />}</div></AppShell>;
}

function AdminContent({ section, data, reload }: { section: Section; data: Data; reload: () => Promise<void> }) {
  if (section === "dashboard") return <Dashboard data={data} />;
  if (section === "monitoring") return <Monitoring data={data} />;
  if (section === "storage") return <Storage data={data} reload={reload} />;
  if (section === "settings") return <Settings settings={data.settings ?? {}} reload={reload} />;
  if (section === "security") return <Security settings={data.settings ?? {}} reload={reload} />;
  if (section === "backups") return <Backups rows={data.rows} reload={reload} />;
  return <LiveTable section={section} rows={data.rows} reload={reload} />;
}

function Dashboard({ data }: { data: Data }) {
  const overview = data.overview ?? {}; const totals = (data.usage?.totals ?? {}) as JsonRecord;
  const series = array(data.usage?.series).map((row) => number(row.requests));
  return <><div className="metric-grid"><Metric label="Resources" value={overview.resources} /><Metric label="Artifacts" value={overview.artifacts} /><Metric label="Logical storage" value={formatBytes(number(overview.logical_bytes))} /><Metric label="Users" value={overview.users} /><Metric label="Requests (30d)" value={totals.requests} /></div><div className="admin-grid"><div className="admin-panel"><SectionHeader title="System services" /><KeyValue rows={Object.entries((data.health?.backends ?? {}) as JsonRecord).map(([key, value]) => [key, String(value)])} /></div><div className="admin-panel"><SectionHeader title="Request volume" /><AppLineChart label="Recorded requests over the last 30 days" values={series.length ? series : [0]} /></div></div><div className="admin-panel"><SectionHeader title="Recent audit trail" /><RecordTable columns={["Time", "Actor", "Action", "Object"]} rows={data.rows.map((row) => [text(row.created_at), text(row.actor_user_id), text(row.action), text(row.resource_id)])} /></div></>;
}

function Monitoring({ data }: { data: Data }) {
  const totals=(data.usage?.totals??{}) as JsonRecord; const series=array(data.usage?.series); const endpoints=array(data.usage?.endpoints);
  return <><div className="metric-grid"><Metric label="Requests" value={totals.requests}/><Metric label="Errors" value={totals.errors}/><Metric label="Rate limited" value={totals.rate_limited}/><Metric label="Median latency" value={`${number(totals.median_latency_ms).toFixed(1)} ms`}/><Metric label="Response bytes" value={formatBytes(number(totals.response_bytes))}/></div><div className="admin-grid"><div className="admin-panel"><SectionHeader title="Request volume"/><AppLineChart label="Daily requests" values={series.map((row)=>number(row.requests))}/></div><div className="admin-panel"><SectionHeader title="Daily errors"/><AppLineChart label="Daily errors" values={series.map((row)=>number(row.errors))}/></div></div><div className="admin-panel"><SectionHeader title="Top endpoints"/><RecordTable columns={["Endpoint","Requests","Errors","Median latency"]} rows={endpoints.map((row)=>[text(row.endpoint),text(row.requests),text(row.errors),`${number(row.median_latency_ms).toFixed(1)} ms`])}/></div></>;
}

function Storage({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const storage=data.storage??{};const totals=(storage.totals??{}) as JsonRecord;const backends=array(storage.backends);const current=settingValue(data.settings ?? {},"storage");
  return <><div className="metric-grid"><Metric label="Artifacts" value={totals.artifact_count}/><Metric label="Logical bytes" value={formatBytes(number(totals.logical_bytes))}/><Metric label="Verified" value={totals.verified}/></div><div className="admin-panel"><SectionHeader title="Storage backends"/><RecordTable columns={["Backend","Artifacts","Logical bytes","Last write"]} rows={backends.map((row)=>[text(row.backend),text(row.artifact_count),formatBytes(number(row.logical_bytes)),text(row.last_write_at)])}/></div><JsonSettings group="storage" value={current} reload={reload}/></>;
}

function Security({ settings, reload }: { settings: JsonRecord; reload: () => Promise<void> }) { return <JsonSettings group="security" value={settingValue(settings,"security")} reload={reload}/>; }

function Settings({ settings, reload }: { settings: JsonRecord; reload: () => Promise<void> }) {
  const groups=Object.keys(settings);const [group,setGroup]=useState(groups[0]??"general");
  useEffect(()=>{if(!groups.includes(group)&&groups[0])setGroup(groups[0]);},[group,groups]);
  return <div className="settings-layout"><div className="admin-panel settings-main"><div className="settings-tabs">{groups.map((item)=><button key={item} className={item===group?"active":""} onClick={()=>setGroup(item)}>{item}</button>)}</div><JsonSettings group={group} value={settingValue(settings,group)} reload={reload}/></div></div>;
}

function JsonSettings({ group, value, reload }: { group:string; value:JsonRecord; reload:()=>Promise<void> }) {
  const [draft,setDraft]=useState<JsonRecord>(value);const [saving,setSaving]=useState(false);const [message,setMessage]=useState("");
  useEffect(()=>setDraft(value),[value]);
  async function save(){setSaving(true);setMessage("");try{await updateSetting(group,draft);await reload();setMessage("Saved to PostgreSQL");}catch(reason){setMessage(reason instanceof Error?reason.message:"Save failed");}finally{setSaving(false);}}
  return <div className="settings-section"><SectionHeader title={group[0]?.toUpperCase()+group.slice(1)} description="Values are loaded from and persisted by the Rust API."/>{Object.entries(draft).map(([key,val])=><label className="setting-row" key={key}><span><strong>{key.replaceAll("_"," ")}</strong></span>{key==="registration_mode"?<select aria-label="registration mode" value={String(val??"disabled")} onChange={(event)=>setDraft((old)=>({...old,[key]:event.target.value}))}><option value="open">Open</option><option value="disabled">Disabled</option></select>:typeof val==="boolean"?<input type="checkbox" checked={val} onChange={(event)=>setDraft((old)=>({...old,[key]:event.target.checked}))}/>:<input type={typeof val==="number"?"number":"text"} value={String(val??"")} onChange={(event)=>setDraft((old)=>({...old,[key]:typeof val==="number"?Number(event.target.value):event.target.value}))}/>}</label>)}<div className="settings-footer"><span role="status">{message}</span><button className="primary-button" onClick={()=>void save()} disabled={saving}>{saving?"Saving…":"Save changes"}</button></div></div>;
}

function Backups({ rows, reload }: { rows:JsonRecord[]; reload:()=>Promise<void> }) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const[restore,setRestore]=useState<JsonRecord|null>(null);const[confirmation,setConfirmation]=useState("");async function run(){setBusy(true);setError("");try{await createBackup("metadata");await reload();}catch(reason){setError(reason instanceof Error?reason.message:"Backup failed");}finally{setBusy(false);}}async function applyRestore(){if(!restore)return;setBusy(true);setError("");try{await restoreBackup(text(restore.id));setRestore(null);setConfirmation("");await reload();}catch(reason){setError(reason instanceof Error?reason.message:"Restore failed");}finally{setBusy(false);}}
  return <div className="admin-panel"><SectionHeader title="Backup history" action={<button className="primary-button" onClick={()=>void run()} disabled={busy}><Plus/>{busy?"Working…":"Run metadata backup"}</button>}/>{error&&<div className="error-banner" role="alert">{error}</div>}<RecordTable columns={["Backup","Kind","Created","Size","Status","Storage URI","Action"]} rows={rows.map((row)=>[text(row.id),text(row.kind),text(row.created_at),formatBytes(number(row.size_bytes)),text(row.status),text(row.storage_uri),"__action__"])} action={(index)=><button className="outline-button" disabled={rows[index].status!=="completed"||busy} onClick={()=>setRestore(rows[index])}>Restore</button>}/>{restore&&<div className="modal-scrim"><div className="simple-dialog" role="alertdialog" aria-modal="true"><h2>Restore metadata backup?</h2><p>A real safety snapshot will be created before Resource, Artifact, and Relation records are restored.</p><label>Type RESTORE<input value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} autoFocus/></label><div className="dialog-actions"><button className="outline-button" onClick={()=>setRestore(null)}>Cancel</button><button className="danger-button" disabled={confirmation!=="RESTORE"||busy} onClick={()=>void applyRestore()}>Restore backup</button></div></div></div>}</div>;
}

type TableConfig={columns:string[];rows:(row:JsonRecord)=>string[]};
const tableConfig:Record<Exclude<Section,"dashboard"|"settings"|"monitoring"|"storage"|"security"|"backups">,TableConfig>={
  users:{columns:["User","Email","Role","Status","Updated"],rows:(r)=>[text(r.display_name),text(r.email),text(r.role),text(r.status),text(r.updated_at)]},
  grants:{columns:["User","Resource","Scopes","Granted by","Granted at","Expires"],rows:(r)=>[text(r.user_name??r.user_id),text(r.resource_id),arrayText(r.scopes),text(r.granted_by),text(r.granted_at),text(r.expires_at)]},
  tokens:{columns:["Owner","Token ID","Scopes","Issued","Expires","Status"],rows:(r)=>[text(r.owner??r.user_id),text(r.token_id),arrayText(r.scopes),text(r.issued_at),text(r.expires_at),r.revoked_at?"Revoked":"Active"]},
  providers:{columns:["Name","Version","Files","Kind","Title"],rows:(r)=>[text(r.name),text(r.version),String(array(r.files).length),text((r.resource_schema as JsonRecord)?.kind),text((r.resource_schema as JsonRecord)?.title)]},
  ingestion:{columns:["Job ID","Resource","Provider","Version","Status","Updated","Error"],rows:(r)=>[text(r.id),text(r.resource_id),text(r.provider_name),text(r.provider_version),text(r.status),text(r.updated_at),text(r.error_code)]},
  audit:{columns:["Time","Actor","Action","Type","Object","Metadata"],rows:(r)=>[text(r.created_at),text(r.actor_user_id),text(r.action),text(r.resource_type),text(r.resource_id),JSON.stringify(r.metadata??{})]},
};

function LiveTable({ section, rows, reload }: { section: keyof typeof tableConfig; rows:JsonRecord[]; reload:()=>Promise<void> }) {
  const config=tableConfig[section];const [query,setQuery]=useState("");const [dialog,setDialog]=useState(false);const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const visible=useMemo(()=>rows.filter((row)=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),[rows,query]);
  async function remove(row:JsonRecord){setBusy(text(row.id??row.token_id??row.resource_id));setError("");try{if(section==="users")await updateUser({id:text(row.id),display_name:text(row.display_name),email:text(row.email)==="—"?undefined:text(row.email),role:text(row.role),status:"disabled"});else if(section==="grants")await deleteGrant(text(row.resource_id),text(row.user_id));else if(section==="tokens")await revokeToken(text(row.token_id));await reload();}catch(reason){setError(reason instanceof Error?reason.message:"Action failed");}finally{setBusy("");}}
  function exportAudit(){const matrix=[config.columns,...visible.map(config.rows)];const csv=matrix.map((row)=>row.map((cell)=>`"${cell.replaceAll('"','""')}"`).join(",")).join("\n");const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));link.download="shennong-audit.csv";link.click();URL.revokeObjectURL(link.href);}
  const creatable = section === "users" || section === "grants" || section === "providers";
  return <div className="admin-panel"><SectionHeader title={copy[section][0]} action={section==="audit"?<button className="outline-button" onClick={exportAudit}><Download/>Export live data</button>:(creatable?<button className="primary-button" onClick={()=>setDialog(true)}><Plus/>{section==="providers"?"Install provider":section==="grants"?"Create grant":"Create user"}</button>:undefined)}/><div className="workspace-toolbar"><input className="input" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={`Search ${section}…`}/><TinyBadge tone="green">Live API</TinyBadge></div>{error&&<div className="error-banner" role="alert">{error}</div>}<RecordTable columns={[...config.columns,...(["users","grants","tokens"].includes(section)?["Action"]:[])]} rows={visible.map((row)=>[...config.rows(row),...(["users","grants","tokens"].includes(section)?["__action__"]:[])])} action={(rowIndex)=>{const row=visible[rowIndex];return <button className="danger-button compact" disabled={busy!==""} onClick={()=>void remove(row)}>{section==="users"?"Disable":section==="tokens"?"Revoke":"Remove"}</button>;}}/>{dialog&&creatable&&<CreateDialog section={section} close={()=>setDialog(false)} reload={reload}/>}</div>;
}

function CreateDialog({ section, close, reload }: { section:"users"|"grants"|"providers";close:()=>void;reload:()=>Promise<void> }) {
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);try{if(section==="users"){const email=String(form.get("email"));const id=String(form.get("id"));await updateUser({id,display_name:String(form.get("display_name")),email,role:String(form.get("role")),status:"active",password:String(form.get("password"))});}else if(section==="grants")await createGrant({user_id:String(form.get("user_id")),resource_id:String(form.get("resource_id")),scopes:String(form.get("scopes")).split(",").map((v)=>v.trim()).filter(Boolean),reason:String(form.get("reason"))});else await installProvider(String(form.get("name")));await reload();close();}catch(reason){setError(reason instanceof Error?reason.message:"Action failed");}finally{setBusy(false);}}
  return <div className="modal-scrim"><form className="simple-dialog" onSubmit={submit}><h2>{section==="providers"?"Install provider":section==="grants"?"Create grant":"Create user"}</h2>{section==="users"?<><label>User ID<input name="id" required autoFocus/></label><label>Display name<input name="display_name" required/></label><label>Email<input name="email" type="email" required/></label><label>Initial password<input name="password" type="password" minLength={12} required/></label><label>Role<select name="role"><option value="user">User</option><option value="admin">Admin</option></select></label></>:section==="grants"?<><label>User ID<input name="user_id" required autoFocus/></label><label>Resource ID<input name="resource_id" required/></label><label>Scopes<input name="scopes" defaultValue="resource.read" required/></label><label>Reason<textarea name="reason"/></label></>:<label>Provider manifest name<input name="name" required autoFocus/></label>}{error&&<div className="error-banner" role="alert">{error}</div>}<div className="dialog-actions"><button type="button" className="outline-button" onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>{busy?"Working…":"Confirm"}</button></div></form></div>;
}

function Metric({label,value}:{label:string;value:unknown}){return <div className="metric-card"><span>{label}</span><strong>{text(value,"0")}</strong></div>}
function KeyValue({rows}:{rows:string[][]}){return <RecordTable columns={["Service","Status"]} rows={rows}/>}
function RecordTable({columns,rows,action}:{columns:string[];rows:string[][];action?:(index:number)=>React.ReactNode}){return <div className="record-table-wrap"><table className="simple-table"><thead><tr>{columns.map((column)=><th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={`${index}-${row[0]}`}>{row.map((cell,cellIndex)=><td key={cellIndex}>{cell==="__action__"&&action?action(index):cellIndex===0?<strong>{cell}</strong>:cell==="Active"||cell==="available"||cell==="completed"||cell==="ok"?<TinyBadge tone="green">{cell}</TinyBadge>:cell}</td>)}</tr>)}</tbody></table>{rows.length===0&&<div className="empty-state"><h3>No persisted records</h3><p>The API returned an empty collection.</p></div>}</div>}
function text(value:unknown,fallback="—"){if(value===null||value===undefined||value==="")return fallback;return String(value)}
function number(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0}
function array(value:unknown):JsonRecord[]{return Array.isArray(value)?value as JsonRecord[]:[]}
function arrayText(value:unknown){return Array.isArray(value)?value.map(String).join(", "):text(value)}
function formatBytes(value:number){if(!value)return "0 B";const units=["B","KB","MB","GB","TB","PB"];let size=value,index=0;while(size>=1024&&index<units.length-1){size/=1024;index+=1}return `${size.toFixed(size>=10?1:2)} ${units[index]}`}
function settingValue(settings:JsonRecord,key:string):JsonRecord{const wrapper=settings[key] as JsonRecord|undefined;return (wrapper?.value??{}) as JsonRecord}
