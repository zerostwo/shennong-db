import Link from "next/link";
export default function AccessDeniedPage() { return <main className="shell" style={{ padding: 40 }}><h1>Access denied</h1><p className="muted">Your current session does not have permission to open this resource.</p><Link className="button primary" href="/auth/sign-in">Sign in</Link></main>; }
