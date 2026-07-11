"use client";

import { FormEvent, useState } from "react";
import { signIn, verify2fa, ShennongApiError } from "@/lib/api/adapter";

export function AuthView() {
  const [step, setStep] = useState<"signin" | "twofa" | "done">("signin");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (step === "signin") {
        const result = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        if (result.requires_2fa && result.challenge) { setChallenge(result.challenge); setStep("twofa"); } else if (result.authenticated) setStep("done");
      } else if (challenge) {
        await verify2fa(challenge, String(form.get("code") ?? ""));
        setStep("done");
      }
    } catch (reason) {
      setError(reason instanceof ShennongApiError ? `${reason.code}: ${reason.message}` : reason instanceof Error ? reason.message : "Authentication failed");
    } finally { setBusy(false); }
  };
  if (step === "done") return <div className="panel" style={{ maxWidth: 460, margin: "12vh auto", padding: 30, textAlign: "center" }}><div className="eyebrow">Authenticated</div><h1>Welcome back</h1><p className="muted">Your secure HttpOnly session is active.</p><div style={{ display: "flex", gap: 10, justifyContent: "center" }}><a className="button primary" href="/catalog">Open catalog</a><a className="button" href="/console/api-access">Open console</a></div></div>;
  return <main className="shell" style={{ padding: 20 }}><div style={{ maxWidth: 460, margin: "10vh auto" }}><a href="/catalog" style={{ fontWeight: 800 }}>← ShennongDB</a><div className="panel" style={{ padding: 30, marginTop: 20 }}><div className="eyebrow">{step === "signin" ? "Secure sign in" : "Step-up verification"}</div><h1 style={{ marginBottom: 8 }}>{step === "signin" ? "Sign in to ShennongDB" : "Enter your 2FA code"}</h1><p className="muted">{step === "signin" ? "Use your organization account to access private resources and console controls." : "A verification code was sent to your enrolled authenticator."}</p><form onSubmit={(event) => void submit(event)} style={{ display: "grid", gap: 14, marginTop: 24 }}>{step === "signin" ? <><label>Email<input className="input" name="email" type="email" required placeholder="you@organization.org" /></label><label>Password<input className="input" name="password" type="password" required minLength={12} /></label></> : <label>Authentication code<input className="input" name="code" inputMode="numeric" pattern="[0-9]{6}" required placeholder="000000" /></label>}{error && <div style={{ color: "#a23b32" }}>{error}</div>}<button className="button primary" type="submit" disabled={busy}>{busy ? "Working…" : step === "signin" ? "Continue" : "Verify and sign in"}</button></form><div className="muted" style={{ marginTop: 18, fontSize: 12 }}>Credentials are sent only to the same-origin auth endpoint; the browser never stores JWTs or passwords.</div></div></div></main>;
}
