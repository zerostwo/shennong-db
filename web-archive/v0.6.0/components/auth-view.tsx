"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Database } from "lucide-react";
import { getSetupStatus, setupAdmin, signIn, verify2fa, ShennongApiError } from "@/lib/api/adapter";

export function AuthView() {
  const [step, setStep] = useState<"loading" | "setup" | "signin" | "twofa" | "done">("loading");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get("reason") === "session-expired");
    void getSetupStatus().then((value) => setStep(value.needs_setup ? "setup" : "signin")).catch(() => setStep("signin"));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (step === "setup") {
        await setupAdmin(String(form.get("display_name") ?? ""), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        setStep("done");
      } else if (step === "signin") {
        const result = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        if (result.requires_2fa && result.challenge) { setChallenge(result.challenge); window.sessionStorage.setItem("shennong_2fa_challenge", result.challenge); setStep("twofa"); }
        else if (result.authenticated) setStep("done");
      } else if (challenge) {
        await verify2fa(challenge, String(form.get("code") ?? ""));
        window.sessionStorage.removeItem("shennong_2fa_challenge");
        setStep("done");
      }
    } catch (reason) {
      setError(reason instanceof ShennongApiError ? reason.message : reason instanceof Error ? reason.message : "Authentication failed");
    } finally { setBusy(false); }
  };

  if (step === "loading") return <main className="auth-screen"><div className="auth-card" role="status">Loading secure sign in…</div></main>;
  return (
    <main className="auth-screen">
      <Link className="auth-brand" href="/catalog"><Database />ShennongDB</Link>
      <div className="auth-card">
        {step === "done" ? <><div className="auth-success"><CheckCircle2 /><strong>Authenticated</strong><span>Your secure HttpOnly session is active.</span></div><h1>Welcome back</h1><p>Continue to your data portal or administrator workspace.</p><div className="dialog-actions"><Link className="outline-button" href="/catalog">Open catalog</Link><Link className="primary-button" href="/admin/dashboard">Open admin</Link></div></> : <>
          {expired && <div className="form-error-summary" role="alert"><strong>Session Expired</strong><span>Your secure session ended. Sign in again to continue.</span></div>}
          <h1>{step === "setup" ? "Create the administrator" : step === "signin" ? "Welcome back" : "Two-factor authentication"}</h1>
          <p>{step === "setup" ? "Set the first administrator account for this instance." : step === "signin" ? "Sign in to access private Resources and personal APIs." : "Enter the 6-digit code from your authenticator app."}</p>
          <form onSubmit={(event) => void submit(event)}>
            {step === "setup" || step === "signin" ? <>
              {step === "setup" && <label>Display name<input name="display_name" required autoComplete="name" /></label>}
              <label>Email<input name="email" type="email" required autoComplete="email" /></label>
              <label>Password<input name="password" type="password" required minLength={12} autoComplete={step === "setup" ? "new-password" : "current-password"} /></label>
              <div className="auth-options"><span>Secure organization access</span><Link href="/auth/forgot-password">Forgot password?</Link></div>
            </> : <>
              <label>Code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="000000" /></label>
              <Link className="text-button" href="/auth/recovery-code">Use recovery code</Link>
            </>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : step === "setup" ? "Create administrator" : step === "signin" ? "Sign in" : "Verify"}</button>
          </form>
          {step === "signin" && <Link className="auth-public-link" href="/catalog"><ArrowLeft />Public catalog remains available without an account. Browse public catalog</Link>}
        </>}
      </div>
    </main>
  );
}
