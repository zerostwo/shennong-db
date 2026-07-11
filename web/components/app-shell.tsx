"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity, Archive, ArrowLeft, BarChart3, Beaker, BookOpen, Boxes, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, ClipboardList, Cloud, Database, FileText, FolderKanban, Gauge, GitBranch,
  KeyRound, LayoutDashboard, ListFilter, LogOut, Menu, MoreHorizontal, PackageOpen, PanelLeft, Plus, Search,
  Settings, ShieldCheck, SlidersHorizontal, Tags, Users, X
} from "lucide-react";

type ShellProps = { active: string; variant?: "public" | "admin"; children: React.ReactNode };

const publicGroups = [
  { label: "CATALOG", items: [["Overview", "/catalog", LayoutDashboard], ["Catalog", "/catalog", Boxes], ["Collections", "/catalog/collections", FolderKanban], ["Tags", "/catalog/tags", Tags], ["Schemas", "/catalog/schemas", FileText], ["Relations", "/catalog/relations", GitBranch]] },
  { label: "DATA OPS", items: [["Ingest", "/console/uploads/new", PackageOpen], ["Pipelines", "/console/jobs", Activity], ["Jobs", "/console/jobs", ClipboardList], ["Storage", "/admin/storage", Database], ["Monitoring", "/admin/monitoring", Gauge]] },
  { label: "GOVERNANCE", items: [["Access", "/admin/grants", ShieldCheck], ["Audit Logs", "/admin/audit", ClipboardList], ["Policies", "/admin/settings", SlidersHorizontal], ["Tokens", "/console/api-access", KeyRound]] },
  { label: "SUPPORT", items: [["Docs", "/docs", BookOpen], ["Support", "/support", CircleHelp]] }
] as const;

const adminItems = [
  ["Dashboard", "/admin/dashboard", LayoutDashboard], ["Resources", "/catalog", Boxes], ["Data Management", "/admin/storage", Database],
  ["Query & Workloads", "/admin/monitoring", BarChart3], ["Users & Access", "/admin/users", Users], ["Audit Logs", "/admin/audit", ClipboardList],
  ["System Settings", "/admin/settings", Settings], ["Backups", "/admin/backups", Archive], ["Alerts", "/admin/monitoring", Activity], ["Integrations", "/admin/providers", Cloud]
] as const;

export function AppShell({ active, variant = "public", children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const isAdmin = variant === "admin";

  return (
    <div className={`app-shell ${isAdmin ? "admin-shell" : "public-shell"}`}>
      <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-topbar">
          {isAdmin ? <Link href="/admin/dashboard" className="brand"><span className="brand-mark"><Beaker /></span><span>ShennongDB</span></Link> : <Link href="/catalog" className="brand"><span className="brand-mark"><Beaker /></span><span>ShennongDB</span></Link>}
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
          <button className="icon-button collapse-button" aria-label="Collapse sidebar"><ChevronLeft /></button>
        </div>
        {!isAdmin && <div className="system-status"><span className="status-dot" />All systems operational</div>}
        {isAdmin ? <AdminNav active={active} /> : <PublicNav active={active} />}
        <div className="sidebar-spacer" />
        {isAdmin ? <AdminFooter /> : <PublicFooter profileOpen={profileOpen} onProfile={() => setProfileOpen((value) => !value)} />}
      </aside>
      <main className="main-column">{children}</main>
    </div>
  );
}

function PublicNav({ active }: { active: string }) {
  return <nav className="sidebar-nav">{publicGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([label, href, Icon]) => <NavItem key={label} label={label} href={href} icon={Icon} active={active === label.toLowerCase() || (active === "catalog" && label === "Catalog")} />)}</div>)}</nav>;
}

function AdminNav({ active }: { active: string }) {
  return <nav className="sidebar-nav admin-nav"><div className="nav-label">ADMIN</div>{adminItems.map(([label, href, Icon]) => <NavItem key={label} label={label} href={href} icon={Icon} active={active === label.toLowerCase().replaceAll(" ", "-")} />)}<div className="nav-label system-label">SYSTEM</div><NavItem label="Status" href="/admin/dashboard" icon={Activity} active={false} /><NavItem label="Documentation" href="/docs" icon={BookOpen} active={false} /></nav>;
}

function NavItem({ label, href, icon: Icon, active }: { label: string; href: string; icon: typeof LayoutDashboard; active: boolean }) {
  return <Link href={href} className={`nav-item ${active ? "active" : ""}`}><Icon /><span>{label}</span>{label === "Data Management" || label === "Query & Workloads" ? <ChevronRight className="nav-chevron" /> : null}</Link>;
}

function PublicFooter({ profileOpen, onProfile }: { profileOpen: boolean; onProfile: () => void }) {
  return <div className="sidebar-footer"><div className="profile-popover-wrap">{profileOpen && <div className="profile-popover"><Link href="/console/profile"><Users />Profile</Link><Link href="/console/api-access"><KeyRound />API Tokens</Link><Link href="/admin/settings"><Settings />Settings</Link><Link href="/admin/dashboard" className="admin-link"><ShieldCheck />Administrator Panel</Link><button className="danger-menu"><LogOut />Sign out</button></div>}<button className="profile-button" onClick={onProfile}><span className="avatar avatar-green">R</span><span className="profile-copy"><strong>researcher@demo.org</strong><small>Researcher</small></span><ChevronDown /></button></div></div>;
}

function AdminFooter() {
  return <div className="admin-footer"><div className="admin-status"><span className="status-dot" />All systems operational</div><small>Updated 2m ago</small><Link href="/catalog" className="return-portal"><ArrowLeft />Return to data portal</Link><div className="admin-user"><span className="avatar avatar-dark">AD</span><span><strong>Administrator</strong><small>admin@shennong.org</small></span><ChevronDown /></div></div>;
}

export function TopBar({ title, description, search = true, action }: { title?: string; description?: string; search?: boolean; action?: React.ReactNode }) {
  return <header className="topbar"><div className="topbar-title">{title && <><h1>{title}</h1>{description && <p>{description}</p>}</>}</div>{search && <label className="global-search"><Search /><input placeholder="Ask ShennongDB or search resources..." /><kbd>⌘ K</kbd></label>}<div className="topbar-actions">{action}<Link href="/docs" className="top-link">Docs</Link><Link href="/console/api-access" className="top-link">API</Link><Link href="/support" className="top-link">Support</Link><button className="icon-button" aria-label="Help"><CircleHelp /></button><button className="icon-button" aria-label="Notifications"><Activity /></button></div></header>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return <button className="icon-button" onClick={onClick} aria-label={label}>{children}</button>;
}

export function TinyBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "purple" | "neutral" }) {
  return <span className={`tiny-badge badge-${tone}`}>{children}</span>;
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} aria-label="Copy value">{copied ? "Copied" : "Copy"}</button>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Boxes /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export { MoreHorizontal, ListFilter, PanelLeft, Plus };
