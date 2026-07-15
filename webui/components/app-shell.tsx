"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Beaker,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FileSearch,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  getSession,
  getPublicConfig,
  listChatThreads,
  listIngestionJobs,
  searchWorkspace,
  signOut,
  type ChatThreadRecord,
  type JsonRecord,
  type WorkspaceSearchItem,
} from "@/lib/api/adapter";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SettingsDialog, type SettingsSection } from "@/components/settings-dialog";

type ShellProps = {
  active: string;
  variant?: "public" | "admin";
  children: React.ReactNode;
};

type SessionRecord = {
  authenticated: boolean;
  user_id: string;
  role: string;
};

const adminItems = [
  ["Overview", "/admin/dashboard", LayoutDashboard],
  ["User Management", "/admin/users", Users],
  ["Access", "/admin/grants", ShieldCheck],
  ["Data Operations", "/admin/ingestion", Database],
  ["System", "/admin/settings", Settings],
] as const;

export function AppShell({ variant = "public", children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThreadRecord[]>([]);
  const pathname = usePathname();
  const isAdmin = variant === "admin";

  const loadThreads = useCallback(async () => {
    try { setThreads((await listChatThreads()).slice(0, 12)); }
    catch { setThreads([]); }
  }, []);

  useEffect(() => {
    const savedDensity = window.localStorage.getItem("shennong.interface-density");
    document.documentElement.dataset.density = savedDensity === "compact" ? "compact" : "comfortable";
    void getSession()
      .then((value) => { setSession(value); if (value.authenticated) void loadThreads(); })
      .catch(() => setSession({ authenticated: false, user_id: "", role: "" }));
    void getPublicConfig()
      .then((value) => setRegistrationOpen(value.registration_mode === "open" || value.registration_enabled === true))
      .catch(() => setRegistrationOpen(false));
  }, [loadThreads]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    const refreshThreads = () => void loadThreads();
    const openSettings = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setSettingsSection(value === "models" || value === "agent-data" || value === "security" || value === "tokens" || value === "account" ? value : "general");
      setSettingsOpen(true);
    };
    window.addEventListener("keydown", shortcut);
    window.addEventListener("shennong:threads-updated", refreshThreads);
    window.addEventListener("shennong:open-settings", openSettings);
    return () => {
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("shennong:threads-updated", refreshThreads);
      window.removeEventListener("shennong:open-settings", openSettings);
    };
  }, [loadThreads]);

  useEffect(() => { setMobileOpen(false); setProfileOpen(false); }, [pathname]);

  return (
    <div className={`app-shell shennong-shell ${isAdmin ? "admin-shell" : "public-shell"} ${collapsed ? "sidebar-collapsed" : ""}`}>
      <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
      {mobileOpen ? <button className="sidebar-mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}
      <aside className={`sidebar shennong-sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-topbar">
          <Link href={isAdmin ? "/admin/dashboard" : "/"} className="brand" aria-label="ShennongDB home"><span className="brand-symbol"><Beaker /></span><span>ShennongDB</span></Link>
          <button className="icon-button collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight /> : <ChevronLeft />}</button>
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        {isAdmin ? <AdminNav pathname={pathname} /> : <PublicNav pathname={pathname} authenticated={Boolean(session?.authenticated)} threads={threads} openSearch={() => setSearchOpen(true)} />}
        <div className="sidebar-spacer" />
        {isAdmin ? <AdminFooter session={session} /> : <PublicFooter session={session} registrationOpen={registrationOpen} profileOpen={profileOpen} onProfile={() => setProfileOpen((value) => !value)} openSettings={(section) => { setSettingsSection(section); setSettingsOpen(true); setProfileOpen(false); }} />}
      </aside>
      <main className="main-column">{children}</main>
      <WorkspaceSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} session={session} initialSection={settingsSection} />
    </div>
  );
}

function PublicNav({ pathname, authenticated, threads, openSearch }: { pathname: string; authenticated: boolean; threads: ChatThreadRecord[]; openSearch: () => void }) {
  return (
    <nav className="sidebar-nav public-primary-nav" aria-label="Main navigation">
      <NavItem label="New chat" href="/" icon={SquarePen} active={pathname === "/"} />
      <button className="nav-item sidebar-command" onClick={openSearch}><Search /><span>Search</span><kbd>⌘K</kbd></button>
      <NavItem label="Resources" href="/resources" icon={Database} active={pathname === "/resources" || pathname.startsWith("/resources/") || pathname.startsWith("/catalog")} />
      {authenticated ? <NavItem label="Projects" href="/projects" icon={FolderKanban} active={pathname.startsWith("/projects")} /> : null}
      {authenticated ? <NavItem label="My Data" href="/console/my-data" icon={FileSearch} active={pathname.startsWith("/console/my-data") || pathname.startsWith("/console/uploads")} /> : null}
      {authenticated ? (
        <div className="sidebar-history">
          <span className="sidebar-history-label">Chats</span>
          {threads.map((thread) => <NavItem key={thread.id} label={thread.title || "New chat"} href={`/chat/${encodeURIComponent(thread.id)}`} icon={MessageSquare} active={pathname === `/chat/${encodeURIComponent(thread.id)}`} />)}
          {threads.length === 0 ? <span className="sidebar-history-empty">No conversations yet</span> : null}
        </div>
      ) : null}
    </nav>
  );
}

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <nav className="sidebar-nav admin-nav" aria-label="Administrator navigation">
      <div className="nav-label">ADMIN</div>
      {adminItems.map(([label, href, Icon]) => <NavItem key={label} label={label} href={href} icon={Icon} active={pathname === href || pathname.startsWith(`${href}/`)} />)}
      <div className="nav-label system-label">HELP</div>
      <NavItem label="Documentation" href="/docs" icon={BookOpen} active={pathname === "/docs"} />
    </nav>
  );
}

function NavItem({ label, href, icon: Icon, active }: { label: string; href: string; icon: typeof LayoutDashboard; active: boolean }) {
  return <Link href={href} className={`nav-item ${active ? "active" : ""}`} title={label}><Icon /><span>{label}</span></Link>;
}

function PublicFooter({ session, registrationOpen, profileOpen, onProfile, openSettings }: { session: SessionRecord | null; registrationOpen: boolean; profileOpen: boolean; onProfile: () => void; openSettings: (section: SettingsSection) => void }) {
  if (!session?.authenticated) return (
    <div className="sidebar-footer signed-out-footer">
      <Link className="sidebar-auth-primary" href="/auth/sign-in"><LogIn />Sign in</Link>
      {registrationOpen ? <Link className="sidebar-auth-secondary" href="/auth/sign-in?mode=register"><UserPlus />Create account</Link> : null}
    </div>
  );
  return (
    <div className="sidebar-footer">
      <div className="profile-popover-wrap">
        {profileOpen ? (
          <div className="profile-popover" role="menu">
            <Link href="/console/profile"><UserRound />Profile</Link>
            <button onClick={() => openSettings("general")}><Settings />Settings</button>
            <Link href="/console/api-access"><KeyRound />API Tokens</Link>
            {session.role === "admin" ? <Link href="/admin/dashboard" className="admin-link"><ShieldCheck />Admin center</Link> : null}
            <Link href="/support"><CircleHelp />Help</Link>
            <button className="danger-menu" onClick={() => void signOut().then(() => location.assign("/"))}><LogOut />Sign out</button>
          </div>
        ) : null}
        <button className="profile-button" onClick={onProfile} aria-expanded={profileOpen}>
          <span className="avatar avatar-green">{session.user_id.slice(0, 1).toUpperCase()}</span>
          <span className="profile-copy"><strong>{session.user_id}</strong><small>{session.role}</small></span>
          <ChevronDown />
        </button>
      </div>
    </div>
  );
}

function AdminFooter({ session }: { session: SessionRecord | null }) {
  return (
    <div className="admin-footer">
      <Link href="/" className="return-portal"><ArrowLeft />Return to Agent Chat</Link>
      {session?.authenticated ? <div className="admin-user"><span className="avatar avatar-dark">{session.user_id.slice(0, 1).toUpperCase()}</span><span><strong>{session.user_id}</strong><small>{session.role}</small></span></div> : <Link className="primary-button sign-in-button" href="/auth/sign-in"><KeyRound />Sign in</Link>}
    </div>
  );
}

function WorkspaceSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); setError(""); return; }
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void searchWorkspace(query)
        .then((value) => { if (!cancelled) { setResults(value); setActiveIndex(0); } })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Search failed"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query]);
  const grouped = useMemo(() => ({
    chat: results.filter((item) => item.kind === "chat"),
    resource: results.filter((item) => item.kind === "resource"),
    project: results.filter((item) => item.kind === "project"),
  }), [results]);
  function navigate(item: WorkspaceSearchItem) { onOpenChange(false); router.push(item.href); }
  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(results.length - 1, value + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); }
    if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); navigate(results[activeIndex]); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-search-dialog" showCloseButton={false}>
        <DialogTitle className="sr-only">Search ShennongDB</DialogTitle>
        <DialogDescription className="sr-only">Search chats, Resources, and Projects.</DialogDescription>
        <div className="workspace-search-input"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKey} placeholder="Search chats, Resources, and Projects" /><kbd>ESC</kbd></div>
        <div className="workspace-search-results">
          {!query.trim() ? <div className="search-quick-links"><Link href="/" onClick={() => onOpenChange(false)}><SquarePen /><span><strong>New chat</strong><small>Start a new agent conversation</small></span></Link><Link href="/resources" onClick={() => onOpenChange(false)}><Database /><span><strong>Resources</strong><small>Browse governed biomedical data</small></span></Link><Link href="/projects" onClick={() => onOpenChange(false)}><FolderKanban /><span><strong>Projects</strong><small>Open a research workspace</small></span></Link></div> : null}
          {loading ? <div className="search-state">Searching…</div> : null}
          {error ? <div className="search-state error" role="alert">{error}</div> : null}
          {!loading && !error && query.trim() && results.length === 0 ? <div className="search-state">No matching data</div> : null}
          {(["chat", "resource", "project"] as const).map((kind) => grouped[kind].length ? <div className="search-result-group" key={kind}><strong>{kind === "chat" ? "Chats" : kind === "resource" ? "Resources" : "Projects"}</strong>{grouped[kind].map((item) => { const index = results.indexOf(item); const Icon = kind === "chat" ? MessageSquare : kind === "resource" ? Database : FolderKanban; return <button key={`${kind}-${item.id}`} className={activeIndex === index ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => navigate(item)}><Icon /><span><b>{item.title}</b>{item.description ? <small>{item.description}</small> : null}</span></button>; })}</div> : null)}
        </div>
        <div className="workspace-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span></div>
      </DialogContent>
    </Dialog>
  );
}

export function TopBar({ title, description, search = true, action }: { title?: string; description?: string; search?: boolean; action?: React.ReactNode }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<JsonRecord[]>([]);
  useEffect(() => { void listIngestionJobs().then((jobs) => setNotifications(jobs.slice(0, 5))).catch(() => undefined); }, []);
  return (
    <>
      <header className="topbar">
        <div className="topbar-title">{title ? <><h1>{title}</h1>{description ? <p>{description}</p> : null}</> : null}</div>
        {search ? <button className="global-search" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Search /><span>Search ShennongDB</span><kbd>⌘ K</kbd></button> : null}
        <div className="topbar-actions">{action}<Link href="/docs" className="top-link">Docs</Link><button className="icon-button notification-button" aria-label="Ingestion activity" onClick={() => setNotificationsOpen((value) => !value)}><Activity />{notifications.length > 0 ? <span aria-hidden="true" /> : null}</button></div>
      </header>
      {notificationsOpen ? <div className="top-popover notifications-popover" role="status"><strong>Ingestion activity</strong>{notifications.map((job) => <div key={String(job.id)}><span className={job.status === "failed" ? "event-dot" : "status-dot"} /><p><b>{String(job.resource_id ?? job.provider_name)}</b><small>{String(job.status)} · {String(job.updated_at ?? "")}</small></p></div>)}{notifications.length === 0 ? <p>No ingestion activity.</p> : null}<button className="text-button" onClick={() => setNotificationsOpen(false)}>Close</button></div> : null}
    </>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</div>;
}

export function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return <button className="icon-button" onClick={onClick} aria-label={label}>{children}</button>;
}

export function TinyBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "purple" | "neutral" }) {
  return <span className={`tiny-badge badge-${tone}`}>{children}</span>;
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} aria-label="Copy value">{copied ? "Copied" : "Copy"}</button>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Boxes /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export { MoreHorizontal, ListFilter, PanelLeft, Plus };
