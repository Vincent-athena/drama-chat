"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMe } from "./MeProvider";

export default function UserMenu() {
  const { me, refresh } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (me === null) return <div className="h-8 w-20" aria-hidden />;

  if (!me.user) {
    if (pathname === "/login") return null;
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="rounded-lg border border-gold-500/40 px-3 py-1.5 text-sm text-gold-400 hover:border-gold-400"
      >
        Sign in
      </Link>
    );
  }

  async function signOut() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    await refresh();
    router.push("/");
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:border-gold-500/50"
      >
        <span>{me.user.avatarEmoji}</span>
        <span className="max-w-[10rem] truncate">{me.user.displayName}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 animate-rise rounded-xl border border-white/10 bg-stage-900 p-1.5 text-sm shadow-lg">
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/5"
          >
            👤 Profile
          </Link>
          <Link
            href="/items"
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/5"
          >
            🎒 My items
          </Link>
          <button onClick={signOut} className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/5">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
