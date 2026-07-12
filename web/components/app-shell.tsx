"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, signOut } from "@/lib/api/adapter";
import {
  Activity,
  ArrowLeft,
  Beaker,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronLeft,
  Database,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

type ShellProps = {
  active: string;
  variant?: "public" | "admin";
  children: React.ReactNode;
};

const publicGroups = [
  {
    label: "CATALOG",
    items: [
      ["Catalog", "/catalog", Boxes],
      ["Collections", "/catalog/collections", ListFilter],
      ["Tags", "/catalog/tags", ClipboardList],
      ["Schemas", "/catalog/schemas", PanelLeft],
      ["Relations", "/catalog/relations", Activity],
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      ["My Data", "/console/my-data", Database],
      ["Uploads", "/console/uploads", Cloud],
      ["API Access", "/console/api-access", KeyRound],
      ["Usage", "/console/usage", Gauge],
    ],
  },
  {
    label: "SUPPORT",
    items: [
      ["Docs", "/docs", BookOpen],
      ["Support", "/support", CircleHelp],
    ],
  },
] as const;

const adminItems = [
  ["Dashboard", "/admin/dashboard", LayoutDashboard],
  ["Users", "/admin/users", Users],
  ["Grants", "/admin/grants", ShieldCheck],
  ["Tokens", "/admin/tokens", KeyRound],
  ["Providers", "/admin/providers", Cloud],
  ["Ingestion", "/admin/ingestion", Activity],
  ["Storage", "/admin/storage", Database],
  ["Monitoring", "/admin/monitoring", Gauge],
  ["Audit Logs", "/admin/audit", ClipboardList],
  ["Security", "/admin/security", ShieldCheck],
  ["Backups", "/admin/backups", Boxes],
  ["System Settings", "/admin/settings", PanelLeft],
] as const;

export function AppShell({ variant = "public", children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [session, setSession] = useState<{
    authenticated: boolean;
    user_id: string;
    role: string;
  } | null>(null);
  const pathname = usePathname();
  const isAdmin = variant === "admin";
  useEffect(() => {
    const demoRole = new URLSearchParams(window.location.search).get("demoRole") || process.env.NEXT_PUBLIC_SHENNONG_DEMO_ROLE;
    if (demoRole) {
      setSession(demoRole === "guest" ? { authenticated: false, user_id: "", role: "" } : { authenticated: true, user_id: demoRole === "user" ? "elias-morgan" : "maya-chen", role: demoRole });
      return;
    }
    void getSession()
      .then(setSession)
      .catch(() => setSession({ authenticated: false, user_id: "", role: "" }));
  }, []);

  return (
    <div
      className={`app-shell ${isAdmin ? "admin-shell" : "public-shell"} ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      <button
        className="mobile-menu-button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu />
      </button>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-topbar">
          {isAdmin ? (
            <Link href="/admin/dashboard" className="brand">
              <span className="brand-mark">
                <Beaker />
              </span>
              <span>ShennongDB</span>
            </Link>
          ) : (
            <Link href="/catalog" className="brand">
              <span className="brand-mark">
                <Beaker />
              </span>
              <span>ShennongDB</span>
            </Link>
          )}
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
          <button
            className="icon-button collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </button>
        </div>
        {!isAdmin && (
          <div className="system-status">
            <span className="status-dot" />
            All systems operational
          </div>
        )}
        {isAdmin ? (
          <AdminNav pathname={pathname} />
        ) : (
          <PublicNav
            pathname={pathname}
            authenticated={Boolean(session?.authenticated)}
          />
        )}
        <div className="sidebar-spacer" />
        {isAdmin ? (
          <AdminFooter session={session} />
        ) : (
          <PublicFooter
            session={session}
            profileOpen={profileOpen}
            onProfile={() => setProfileOpen((value) => !value)}
          />
        )}
      </aside>
      <main className="main-column">{children}</main>
    </div>
  );
}

function PublicNav({
  pathname,
  authenticated,
}: {
  pathname: string;
  authenticated: boolean;
}) {
  return (
    <nav className="sidebar-nav">
      {publicGroups
        .filter((group) => group.label !== "ACCOUNT" || authenticated)
        .map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map(([label, href, Icon]) => (
              <NavItem
                key={label}
                label={label}
                href={href}
                icon={Icon}
                active={pathname === href}
              />
            ))}
          </div>
        ))}
    </nav>
  );
}

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <nav className="sidebar-nav admin-nav">
      <div className="nav-label">ADMIN</div>
      {adminItems.map(([label, href, Icon]) => (
        <NavItem
          key={label}
          label={label}
          href={href}
          icon={Icon}
          active={pathname === href}
        />
      ))}
      <div className="nav-label system-label">SYSTEM</div>
      <NavItem
        label="Documentation"
        href="/docs"
        icon={BookOpen}
        active={pathname === "/docs"}
      />
    </nav>
  );
}

function NavItem({
  label,
  href,
  icon: Icon,
  active,
}: {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <Link href={href} className={`nav-item ${active ? "active" : ""}`}>
      <Icon />
      <span>{label}</span>
      {label === "Data Management" || label === "Query & Workloads" ? (
        <ChevronRight className="nav-chevron" />
      ) : null}
    </Link>
  );
}

function PublicFooter({
  session,
  profileOpen,
  onProfile,
}: {
  session: { authenticated: boolean; user_id: string; role: string } | null;
  profileOpen: boolean;
  onProfile: () => void;
}) {
  if (!session?.authenticated)
    return (
      <div className="sidebar-footer">
        <Link className="primary-button sign-in-button" href="/auth/sign-in">
          <KeyRound />
          Sign in / Set up
        </Link>
      </div>
    );
  return (
    <div className="sidebar-footer">
      <div className="profile-popover-wrap">
        {profileOpen && (
          <div className="profile-popover">
            <Link href="/console/profile">
              <Users />
              Profile
            </Link>
            <Link href="/console/api-access">
              <KeyRound />
              API Tokens
            </Link>
            {session.role === "admin" && (
              <Link href="/admin/dashboard" className="admin-link">
                <ShieldCheck />
                Administrator Panel
              </Link>
            )}
            <button
              className="danger-menu"
              onClick={() => void signOut().then(() => location.reload())}
            >
              <LogOut />
              Sign out
            </button>
          </div>
        )}
        <button className="profile-button" onClick={onProfile}>
          <span className="avatar avatar-green">
            {session.user_id.slice(0, 1).toUpperCase()}
          </span>
          <span className="profile-copy">
            <strong>{session.user_id}</strong>
            <small>{session.role}</small>
          </span>
          <ChevronDown />
        </button>
      </div>
    </div>
  );
}

function AdminFooter({
  session,
}: {
  session: { authenticated: boolean; user_id: string; role: string } | null;
}) {
  return (
    <div className="admin-footer">
      <Link href="/catalog" className="return-portal">
        <ArrowLeft />
        Return to data portal
      </Link>
      {session?.authenticated ? (
        <div className="admin-user">
          <span className="avatar avatar-dark">
            {session.user_id.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{session.user_id}</strong>
            <small>{session.role}</small>
          </span>
        </div>
      ) : (
        <Link className="primary-button sign-in-button" href="/auth/sign-in">
          <KeyRound />
          Sign in
        </Link>
      )}
    </div>
  );
}

export function TopBar({
  title,
  description,
  search = true,
  action,
}: {
  title?: string;
  description?: string;
  search?: boolean;
  action?: React.ReactNode;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [role, setRole] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationsOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    void getSession()
      .then((session) => setRole(session.role))
      .catch(() => undefined);
  }, []);
  const commands = [
    ["Open catalog", "/catalog", "Resources, artifacts, and relations"],
    ["Upload dataset", "/console/uploads/new", "Register files and metadata"],
    ["View API tokens", "/console/api-access", "Personal API credentials"],
    ["View usage", "/console/usage", "Requests, transfer, and limits"],
    ["Search users", "/admin/users", "Administrator user management"],
    ["Open system settings", "/admin/settings", "Instance configuration"],
    ["Open administrator panel", "/admin/dashboard", "System health and governance"],
  ].filter(([label, , detail]) =>
    `${label} ${detail}`.toLowerCase().includes(commandQuery.toLowerCase()),
  ).filter(([, href]) => (!href.startsWith("/admin") || role === "admin" || process.env.NODE_ENV === "development") && (!href.startsWith("/console") || Boolean(role) || process.env.NODE_ENV === "development"));
  return (
    <>
      <header className="topbar">
        <div className="topbar-title">
          {title && (
            <>
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </>
          )}
        </div>
        {search && (
          <label className="global-search">
            <Search />
            <input
              placeholder="Ask ShennongDB or search resources..."
              onFocus={() => setCommandOpen(true)}
            />
            <kbd>⌘ K</kbd>
          </label>
        )}
        <div className="topbar-actions">
          {action}
          <Link href="/docs" className="top-link">
            Docs
          </Link>
          <Link href="/console/api-access" className="top-link">
            API
          </Link>
          <Link href="/support" className="top-link">
            Support
          </Link>
          <button className="icon-button" aria-label="Help" onClick={() => setHelpOpen((value) => !value)}>
            <CircleHelp />
          </button>
          <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}>
            <Activity />
            <span aria-hidden="true" />
          </button>
        </div>
      </header>
      {helpOpen && <div className="top-popover help-popover"><strong>Help &amp; documentation</strong><p>Browse API examples, deployment guidance, and governance concepts.</p><Link href="/docs" onClick={() => setHelpOpen(false)}>Open documentation</Link><Link href="/support" onClick={() => setHelpOpen(false)}>Contact support</Link></div>}
      {notificationsOpen && <div className="top-popover notifications-popover" role="status"><strong>Notifications</strong><div><span className="status-dot"/><p><b>Ingestion completed</b><small>GENCODE v44 gene map · 8 minutes ago</small></p></div><div><span className="event-dot"/><p><b>Grant expires soon</b><small>PBMC 3K · in 7 days</small></p></div><button className="text-button" onClick={() => setNotificationsOpen(false)}>Mark all as read</button></div>}
      {commandOpen && (
        <div className="modal-scrim" onClick={() => setCommandOpen(false)}>
          <div
            className="simple-dialog command-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Command palette</h2>
            <input
              autoFocus
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search resources or open a workspace…"
            />
            <div className="command-results">{commands.map(([label,href,detail])=><Link key={href} href={href} onClick={() => setCommandOpen(false)}><Search/><span><strong>{label}</strong><small>{detail}</small></span><kbd>↵</kbd></Link>)}{commands.length===0&&<div className="command-empty">No matching commands</div>}</div>
            <button
              className="text-button"
              onClick={() => setCommandOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

export function TinyBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "purple" | "neutral";
}) {
  return <span className={`tiny-badge badge-${tone}`}>{children}</span>;
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy value"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Boxes />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export { MoreHorizontal, ListFilter, PanelLeft, Plus };
