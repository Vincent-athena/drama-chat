"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useMe } from "@/components/MeProvider";
import type { MeResponse } from "@/lib/api-types";
import { LocalSaveStore } from "./local";
import type { SaveStore } from "./types";

/** The save store of the signed-in user. Memoised per user id; opening the database is lazy. */
export function useSave(): { status: "loading" | "guest" | "ready"; store: SaveStore | null; me: MeResponse | null } {
  const { me } = useMe();
  const userId = me?.user?.id ?? null;
  const store = useMemo(() => (userId === null ? null : new LocalSaveStore(userId)), [userId]);
  const status = me === null ? "loading" : me.user ? "ready" : "guest";
  return { status, store, me };
}

/** Like useSave, but sends guests to the login page and comes back afterwards. */
export function useRequireUser(): { status: "loading" | "guest" | "ready"; store: SaveStore | null; me: MeResponse | null } {
  const s = useSave();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (s.status === "guest") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [s.status, router, pathname]);
  return s;
}
