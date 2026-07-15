"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { forgotPassword, resetPassword, verify2fa, verifyRecoveryCode } from "@/lib/api/adapter";

type Mode = "forgot" | "reset" | "two-factor" | "recovery";
const copy: Record<Mode, [string, string, string]> = {
  forgot: [
    "Reset your password",
    "Enter your email. The response does not reveal whether the account exists.",
    "Send reset link",
  ],
  reset: [
    "Choose a new password",
    "Use at least 12 characters and do not reuse an API token.",
    "Reset password",
  ],
  "two-factor": [
    "Two-factor authentication",
    "Enter the 6-digit code from your authenticator app.",
    "Verify",
  ],
  recovery: [
    "Use a recovery code",
    "Each recovery code can only be used once.",
    "Verify recovery code",
  ],
};
export function AuthSupportView({ mode }: { mode: Mode }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [title, description, action] = copy[mode];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    if (mode === "reset" && data.get("password") !== data.get("confirm")) {
      setError("Passwords do not match");
      return;
    }
    try {
      if (mode === "forgot") await forgotPassword(String(data.get("email")));
      else if (mode === "reset") {
        const token = new URLSearchParams(window.location.search).get("token") ?? String(data.get("token") ?? "");
        if (!token) throw new Error("A password reset token is required.");
        await resetPassword(token, String(data.get("password")));
      } else {
        const challenge = window.sessionStorage.getItem("shennong_2fa_challenge");
        if (!challenge) throw new Error("The two-factor challenge is missing or expired. Sign in again.");
        if (mode === "two-factor") await verify2fa(challenge, String(data.get("code")));
        else await verifyRecoveryCode(challenge, String(data.get("code")));
        window.sessionStorage.removeItem("shennong_2fa_challenge");
      }
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); }
  }
  return (
    <main className="auth-screen">
      <Link className="auth-brand" href="/">
        ShennongDB
      </Link>
      <form className="auth-card" onSubmit={submit}>
        <h1>{title}</h1>
        <p>{description}</p>
        {done ? (
          <div className="auth-success" role="status">
            <CheckCircle2 />
            <strong>
              {mode === "forgot" ? "Check your email" : "Verification complete"}
            </strong>
            <span>
              {mode === "forgot"
                ? "If an account exists, a reset link has been sent."
                : "You can safely continue to ShennongDB."}
            </span>
          </div>
        ) : (
          <>
            {mode === "forgot" && (
              <label>
                Email
                <input name="email" type="email" required autoFocus />
              </label>
            )}
            {mode === "reset" && (
              <>
                <label>Reset token<input name="token" defaultValue={typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : ""} required /></label>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    minLength={12}
                    required
                  />
                </label>
              </>
            )}
            {mode === "two-factor" && (
              <label>
                Authentication code
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  autoFocus
                />
              </label>
            )}
            {mode === "recovery" && (
              <label>
                Recovery code
                <input
                  name="code"
                  autoComplete="one-time-code"
                  pattern="[A-Za-z0-9-]{8,}"
                  required
                  autoFocus
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button">{action}</button>
          </>
        )}
        {mode === "two-factor" && (
          <Link className="auth-public-link" href="/auth/recovery-code">
            Use a recovery code
          </Link>
        )}
        {done && (
          <Link className="auth-public-link" href="/auth/sign-in">
            Return to sign in
          </Link>
        )}
      </form>
    </main>
  );
}
