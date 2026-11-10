"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMe } from "@/components/MeProvider";

const RESEND_SECONDS = 60;

/** Only same-site paths: starts with "/" but not "//" (or "/\"). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { refresh } = useMe();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function post(path: string, json: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
      credentials: "same-origin",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429 && typeof body.retryAfter === "number") setWait(body.retryAfter);
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/request-code", { email });
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/verify", { email, code });
      await refresh();
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-6">
      <div className="animate-rise rounded-2xl border border-gold-500/30 bg-stage-900 p-6">
        <h1 className="font-serif text-2xl text-gold-400">Sign in to Drama Chat</h1>
        {step === "email" ? (
          <form onSubmit={sendCode}>
            <p className="mt-1 text-sm text-white/60">
              We email you a 6-digit code. No password, and new emails get an account automatically.
            </p>
            <label className="mt-5 block text-sm text-white/70" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-gold-500"
            />
            {error && <p className="mt-4 text-sm text-blood-500">{error}</p>}
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="mt-1 text-sm text-white/60">
              We sent a 6-digit code to <span className="text-white/90">{email.trim()}</span>. It works for 10 minutes.
            </p>
            <label className="mt-5 block text-sm text-white/70" htmlFor="code">Code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-gold-500"
            />
            {error && <p className="mt-4 text-sm text-blood-500">{error}</p>}
            <div className="mt-6 flex items-center justify-between gap-3">
              <div className="flex flex-col items-start gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => { setStep("email"); setError(null); setCode(""); }}
                  className="text-white/60 hover:text-white"
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  onClick={() => sendCode()}
                  disabled={busy || wait > 0}
                  className="text-gold-500 hover:text-gold-400 disabled:text-white/30"
                >
                  {wait > 0 ? `Resend code (${wait}s)` : "Resend code"}
                </button>
              </div>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-60"
              >
                {busy ? "Checking…" : "Sign in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-white/50">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
