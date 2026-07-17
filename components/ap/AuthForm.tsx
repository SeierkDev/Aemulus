"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus:border-border-strong focus:outline-none";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ap/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { name, email, password } : { email, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      router.replace("/ap/queue");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-ink-3">
        {mode === "login" ? "Access your AP workspace." : "Start entering invoices with a sealed audit trail."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        {mode === "signup" && (
          <label className="block text-xs text-ink-3">
            Name
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jane Doe" />
          </label>
        )}
        <label className="block text-xs text-ink-3">
          Email
          <input className={field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
        </label>
        <label className="block text-xs text-ink-3">
          Password
          <input
            className={field}
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-30"
        >
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-ink">{error}</p>}

      <p className="mt-4 text-sm text-ink-3">
        {mode === "login" ? "New here? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
          className="text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80"
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
