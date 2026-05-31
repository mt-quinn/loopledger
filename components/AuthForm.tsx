"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { AppTheme } from "../lib/use-stored-theme";

type AuthFlow = "signIn" | "signUp";

export default function AuthForm({
  theme,
  setTheme
}: {
  theme: AppTheme;
  setTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
}) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<AuthFlow>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await signIn("password", { email: email.trim(), password, flow });
    } catch {
      setError(
        flow === "signIn"
          ? "We couldn't sign you in. Check your email and password."
          : "We couldn't create that account. The email may already be in use, or the password is too short (8+ characters)."
      );
      setSubmitting(false);
    }
  }

  return (
    <section className="hub-shell auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <p className="hub-kicker">WhichStitch</p>
          <h1 className="auth-title">{flow === "signIn" ? "Sign in" : "Create account"}</h1>
          <p className="auth-subtitle">
            Save your patterns and markups to your account so they follow you from device to device.
          </p>
        </div>

        {error ? <p className="hub-banner">{error}</p> : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={flow === "signIn" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={flow === "signIn" ? "Your password" : "At least 8 characters"}
            />
          </label>

          <button type="submit" className="hub-primary-btn auth-submit" disabled={submitting}>
            {submitting
              ? flow === "signIn"
                ? "Signing in..."
                : "Creating account..."
              : flow === "signIn"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          {flow === "signIn" ? (
            <p>
              New to WhichStitch?{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  setFlow("signUp");
                  setError(null);
                }}
              >
                Create an account
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  setFlow("signIn");
                  setError(null);
                }}
              >
                Sign in
              </button>
            </p>
          )}
        </div>

        <button
          type="button"
          className={theme === "dark" ? "hub-secondary-btn active auth-theme-btn" : "hub-secondary-btn auth-theme-btn"}
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </section>
  );
}
