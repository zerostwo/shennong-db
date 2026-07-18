import Link from "next/link";

type ProjectTab = "workspace" | "chat" | "memory" | "graph";

export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTab }) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const items: Array<[ProjectTab, string, string]> = [
    ["workspace", "Workspace", base],
    ["chat", "Chat", `${base}/chat`],
    ["memory", "Memory", `${base}/memory`],
    ["graph", "BioGraph", `${base}/graph`],
  ];
  return <nav className="project-tabs" aria-label="Project sections">{items.map(([value, label, href]) => <Link className={active === value ? "active" : undefined} href={href} key={value}>{label}</Link>)}</nav>;
}
