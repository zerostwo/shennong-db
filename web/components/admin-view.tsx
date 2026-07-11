import { AdminSectionView } from "./admin-section-view";

type AdminViewProps = { active: "dashboard" | "users" | "settings" };
export function AdminView({ active }: AdminViewProps) { return <AdminSectionView section={active} />; }
