"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import EmojiPicker from "@/components/EmojiPicker";
import { useMe } from "@/components/MeProvider";
import type { SessionView, StorySummary } from "@/lib/api-types";
import { apiFetch, describeApiError } from "@/lib/client/api";
import { loadOwnedItems } from "@/lib/client/items";
import { DisplayNameSchema } from "@/lib/profile";
import { parseSaveFile, saveFileName } from "@/lib/save/file";
import { useSave } from "@/lib/save/useSave";

type Stats = { started: number; finished: number; messages: number; items: number | null };

function shortAgent(ua: string): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os =
    /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const card = "animate-rise rounded-2xl border border-white/10 bg-stage-900 p-6";
const btn = "rounded-lg border border-gold-500/40 px-4 py-2 text-sm text-gold-400 hover:border-gold-400 disabled:opacity-50";

export default function ProfilePage() {
  const router = useRouter();
  const { refresh } = useMe();
  const { status, store, me } = useSave();
  const leaving = useRef(false);
  const user = me?.user ?? null;

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎭");
  const [identityMsg, setIdentityMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fileMsg, setFileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyFile, setBusyFile] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Guests go to the login page, unless we are leaving on purpose (sign out everywhere, account deleted).
  useEffect(() => {
    if (status === "guest" && !leaving.current) router.replace(`/login?next=${encodeURIComponent("/profile")}`);
  }, [status, router]);

  const userId = user?.id;
  useEffect(() => {
    if (user) {
      setName(user.displayName);
      setEmoji(user.avatarEmoji);
    }
    // Only when the account changes or the saved values change, not on every keystroke.
  }, [userId, user?.displayName, user?.avatarEmoji]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStats = useCallback(async () => {
    if (!store) return;
    try {
      const [progress, messages, owned, list] = await Promise.all([
        store.listProgress(),
        store.countUserMessages(),
        loadOwnedItems(store).catch(() => null),
        fetch("/api/stories").then((r) => r.json() as Promise<{ stories: StorySummary[] }>),
      ]);
      const counts = new Map(list.stories.map((s) => [s.id, s.phaseCount]));
      const finished = progress.filter((p) => {
        const n = counts.get(p.storyId);
        return n !== undefined && p.phaseIndex >= n;
      }).length;
      setStats({ started: progress.length, finished, messages, items: owned ? owned.reduce((n, s) => n + s.items.length, 0) : null });
    } catch {
      setStats(null);
    }
  }, [store]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiFetch("/api/me/sessions");
      setSessions(((await res.json()) as { sessions: SessionView[] }).sessions);
      setNow(Date.now());
      setSessionsError(null);
    } catch (err) {
      setSessionsError(describeApiError(err));
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadStats();
    loadSessions();
  }, [userId, loadStats, loadSessions]);

  if (status === "loading" || !user || !store) {
    return <p className="text-white/50">{status === "guest" ? "Redirecting to sign in…" : "Loading…"}</p>;
  }

  const parsedName = DisplayNameSchema.safeParse(name);
  const dirty = name !== user.displayName || emoji !== user.avatarEmoji;

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!parsedName.success || savingIdentity) return;
    setSavingIdentity(true);
    setIdentityMsg(null);
    try {
      await apiFetch("/api/me", { method: "PATCH", json: { displayName: parsedName.data, avatarEmoji: emoji } });
      await refresh();
      setIdentityMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setIdentityMsg({ ok: false, text: describeApiError(err) });
    } finally {
      setSavingIdentity(false);
    }
  }

  async function signOutEverywhere() {
    if (signingOut) return;
    setSigningOut(true);
    leaving.current = true;
    try {
      await apiFetch("/api/me/sessions", { method: "DELETE", redirectOn401: false });
      await refresh();
      router.push("/login");
    } catch (err) {
      leaving.current = false;
      setSigningOut(false);
      setSessionsError(describeApiError(err));
    }
  }

  async function exportSave() {
    if (!store || busyFile) return;
    setBusyFile(true);
    setFileMsg(null);
    try {
      const file = await store.exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = saveFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFileMsg({ ok: true, text: "Save file downloaded." });
    } catch (err) {
      setFileMsg({ ok: false, text: describeApiError(err) });
    } finally {
      setBusyFile(false);
    }
  }

  async function importSave(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !store || !user || busyFile) return;
    setBusyFile(true);
    setFileMsg(null);
    try {
      // Read and check the file first; the store transaction must not wait on anything else.
      let json: unknown;
      try {
        json = JSON.parse(await f.text());
      } catch {
        setFileMsg({ ok: false, text: "Not a Drama Chat save file." });
        return;
      }
      const parsed = parseSaveFile(json, user.id);
      if (!parsed.ok) {
        setFileMsg({ ok: false, text: parsed.error });
        return;
      }
      if (!window.confirm("Replace your current save on this device?")) return;
      await store.importAll(parsed.file);
      await loadStats();
      setFileMsg({ ok: true, text: "Save imported." });
    } catch (err) {
      setFileMsg({ ok: false, text: describeApiError(err) });
    } finally {
      setBusyFile(false);
    }
  }

  async function deleteAccount() {
    if (!store || !user || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    leaving.current = true;
    try {
      await apiFetch("/api/me", { method: "DELETE", json: { confirmEmail: confirm }, redirectOn401: false });
      await store.destroy().catch(() => undefined);
      await refresh();
      router.push("/");
    } catch (err) {
      leaving.current = false;
      setDeleting(false);
      setDeleteError(describeApiError(err));
    }
  }

  const emailMatches = confirm.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-serif text-3xl text-gold-400">Your profile</h1>

      <form onSubmit={saveIdentity} className={card}>
        <h2 className="font-serif text-xl text-gold-400">Identity</h2>
        <p className="mt-1 text-sm text-white/60">Characters call you by this name.</p>
        <div className="mt-4">
          <EmojiPicker value={emoji} onChange={setEmoji} disabled={savingIdentity} />
        </div>
        <label className="mt-5 block text-sm text-white/70" htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          value={name}
          maxLength={60}
          onChange={(e) => { setName(e.target.value); setIdentityMsg(null); }}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-gold-500"
        />
        {!parsedName.success && (
          <p className="mt-2 text-sm text-blood-500">Use 1 to 40 characters, without &lt; or &gt;.</p>
        )}
        <label className="mt-5 block text-sm text-white/70" htmlFor="email">Email</label>
        <input
          id="email"
          value={user.email}
          readOnly
          className="mt-1 w-full cursor-not-allowed rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/60"
        />
        <div className="mt-5 flex items-center justify-end gap-4">
          {identityMsg && (
            <p className={`text-sm ${identityMsg.ok ? "text-gold-400" : "text-blood-500"}`}>{identityMsg.text}</p>
          )}
          <button
            type="submit"
            disabled={savingIdentity || !parsedName.success || !dirty}
            className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-60"
          >
            {savingIdentity ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <section className={card}>
        <h2 className="font-serif text-xl text-gold-400">Your stats</h2>
        <p className="mt-1 text-sm text-white/60">Counted from the save on this device.</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {[
            ["Stories started", stats?.started],
            ["Stories finished", stats?.finished],
            ["Messages sent", stats?.messages],
            ["Items owned", stats?.items],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <dd className="font-serif text-2xl text-gold-400">{value ?? "–"}</dd>
              <dt className="mt-1 text-xs text-white/60">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className="font-serif text-xl text-gold-400">Signed-in devices</h2>
        {sessionsError && <p className="mt-3 text-sm text-blood-500">{sessionsError}</p>}
        {sessions === null && !sessionsError && <p className="mt-3 text-sm text-white/50">Loading…</p>}
        <ul className="mt-3 divide-y divide-white/10">
          {sessions?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span className="flex items-center gap-2">
                <span>{shortAgent(s.userAgent)}</span>
                {s.current && (
                  <span className="rounded-full border border-gold-500/40 px-2 py-0.5 text-xs text-gold-400">this device</span>
                )}
              </span>
              <span className="text-white/60">Last seen {ago(s.lastSeenAt, now)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button onClick={signOutEverywhere} disabled={signingOut} className={btn}>
            {signingOut ? "Signing out…" : "Sign out everywhere"}
          </button>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-serif text-xl text-gold-400">Save file</h2>
        <p className="mt-1 text-sm text-white/60">
          Your chats and progress live in this browser. Export a copy to back them up or move to another device, then import it
          while signed in to the same account.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={exportSave} disabled={busyFile} className={btn}>⬇ Export</button>
          <button onClick={() => fileInput.current?.click()} disabled={busyFile} className={btn}>⬆ Import</button>
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={importSave} className="hidden" />
          {fileMsg && <p className={`text-sm ${fileMsg.ok ? "text-gold-400" : "text-blood-500"}`}>{fileMsg.text}</p>}
        </div>
      </section>

      <section className="animate-rise rounded-2xl border border-blood-500/40 bg-stage-900 p-6">
        <h2 className="font-serif text-xl text-blood-500">Danger zone</h2>
        <p className="mt-1 text-sm text-white/60">
          Deleting your account removes it from the server and erases the save on this device. This cannot be undone. Saves on
          other devices stay there but cannot be used.
        </p>
        <label className="mt-4 block text-sm text-white/70" htmlFor="confirmEmail">
          Type your email to confirm
        </label>
        <input
          id="confirmEmail"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          placeholder={user.email}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-blood-500"
        />
        {deleteError && <p className="mt-2 text-sm text-blood-500">{deleteError}</p>}
        <div className="mt-4 flex justify-end">
          <button
            onClick={deleteAccount}
            disabled={!emailMatches || deleting}
            className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </section>
    </div>
  );
}
