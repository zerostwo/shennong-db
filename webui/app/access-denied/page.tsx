import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1>You do not have access to this Resource.</h1>
        <p>Request access or contact an administrator. Private resources are not disclosed without a server-side grant.</p>
        <div className="dialog-actions">
      <Button asChild variant="outline"><Link href="/resources">Return to Resources</Link></Button>
          <Button asChild><Link href="/support">Request Access</Link></Button>
        </div>
      </div>
    </main>
  );
}
