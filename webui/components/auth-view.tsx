"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Database } from "lucide-react";
import {
  getPublicConfig,
  getSetupStatus,
  registerUser,
  setupAdmin,
  signIn,
  verify2fa,
  ShennongApiError,
} from "@/lib/api/adapter";

type AuthStep = "loading" | "setup" | "signin" | "register" | "twofa" | "done";

export function AuthView() {
  const [step, setStep] = useState<AuthStep>("loading");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [doneRole, setDoneRole] = useState("");
  const [returnTo, setReturnTo] = useState("/");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExpired(params.get("reason") === "session-expired");
    const requestedReturn = params.get("returnTo") ?? "/";
    setReturnTo(requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/");
    void Promise.allSettled([getSetupStatus(), getPublicConfig()]).then(([setup, config]) => {
      const setupValue = setup.status === "fulfilled" ? setup.value : { needs_setup: false };
      const configValue = config.status === "fulfilled" ? config.value : {};
      const registrationIsOpen = configValue.registration_mode === "open" || configValue.registration_enabled === true;
      setRegistrationEnabled(registrationIsOpen);
      if (setupValue.needs_setup) setStep("setup");
      else setStep(params.get("mode") === "register" && registrationIsOpen ? "register" : "signin");
    });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("display_name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      if (step === "setup") {
        await setupAdmin(displayName, email, password);
        await signIn(email, password);
        setDoneRole("admin");
        setStep("done");
      } else if (step === "register") {
        if (password !== String(form.get("password_confirm") ?? "")) throw new Error("Passwords do not match");
        const result = await registerUser(displayName, email, password);
        setDoneRole(typeof result.role === "string" ? result.role : "user");
        setStep("done");
      } else if (step === "signin") {
        const result = await signIn(email, password);
        if (result.requires_2fa && result.challenge) {
          setChallenge(result.challenge);
          window.sessionStorage.setItem("shennong_2fa_challenge", result.challenge);
          setStep("twofa");
        } else if (result.authenticated) {
          setDoneRole(result.role ?? "");
          setStep("done");
        }
      } else if (challenge) {
        const result = await verify2fa(challenge, String(form.get("code") ?? ""));
        setDoneRole(result.role);
        window.sessionStorage.removeItem("shennong_2fa_challenge");
        setStep("done");
      }
    } catch (reason) {
      setError(reason instanceof ShennongApiError ? reason.message : reason instanceof Error ? reason.message : "Authentication failed");
    } finally { setBusy(false); }
  };

  if (step === "loading") return <main className="auth-screen"><div className="auth-card" role="status">Loading secure sign in…</div></main>;
  const title = step === "setup" ? "Create the administrator" : step === "signin" ? "Welcome back" : step === "register" ? "Create your account" : "Two-factor authentication";
  const description = step === "setup" ? "Set the first administrator account for this ShennongDB instance." : step === "signin" ? "Sign in to use Agent Chat and your private data." : step === "register" ? "Create a standard user account for this workspace." : "Enter the 6-digit code from your authenticator app.";
  return (
    <main className="auth-screen">
      <Link className="auth-brand" href="/"><Database />ShennongDB</Link>
      <div className="auth-card">
        {step === "done" ? (
          <>
            <div className="auth-success"><CheckCircle2 /><strong>Authenticated</strong><span>Your secure session is active.</span></div>
            <h1>{doneRole === "admin" ? "Administrator ready" : "Welcome to ShennongDB"}</h1>
            <p>Continue to Agent Chat or browse governed biomedical Resources.</p>
            <div className="dialog-actions"><Link className="outline-button" href="/resources">Open Resources</Link><Link className="primary-button" href={returnTo}>Continue</Link></div>
            {doneRole === "admin" ? <Link className="auth-admin-link" href="/admin/dashboard">Open Admin center</Link> : null}
          </>
        ) : (
          <>
            {expired ? <div className="form-error-summary" role="alert"><strong>Session expired</strong><span>Sign in again to continue.</span></div> : null}
            <h1>{title}</h1>
            <p>{description}</p>
            <form onSubmit={(event) => void submit(event)}>
              {step === "setup" || step === "signin" || step === "register" ? (
                <>
                  {step !== "signin" ? <label>Display name<input name="display_name" required autoComplete="name" /></label> : null}
                  <label>Email<input name="email" type="email" required autoComplete="email" /></label>
                  <label>Password<input name="password" type="password" required minLength={12} autoComplete={step === "signin" ? "current-password" : "new-password"} /></label>
                  {step === "register" ? <label>Confirm password<input name="password_confirm" type="password" required minLength={12} autoComplete="new-password" /></label> : null}
                  {step === "signin" ? <div className="auth-options"><span>Secure workspace access</span><Link href="/auth/forgot-password">Forgot password?</Link></div> : null}
                </>
              ) : (
                <>
                  <label>Code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="000000" /></label>
                  <Link className="text-button" href="/auth/recovery-code">Use recovery code</Link>
                </>
              )}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : step === "setup" ? "Create administrator" : step === "signin" ? "Sign in" : step === "register" ? "Create account" : "Verify"}</button>
            </form>
            {step === "signin" && registrationEnabled ? <div className="auth-mode-switch"><span>New to ShennongDB?</span><button onClick={() => { setError(""); setStep("register"); }}>Create account</button></div> : null}
            {step === "register" ? <div className="auth-mode-switch"><span>Already have an account?</span><button onClick={() => { setError(""); setStep("signin"); }}>Sign in</button></div> : null}
            {step === "signin" || step === "register" ? <Link className="auth-public-link" href="/resources"><ArrowLeft />Browse public Resources without an account</Link> : null}
          </>
        )}
      </div>
    </main>
  );
}
