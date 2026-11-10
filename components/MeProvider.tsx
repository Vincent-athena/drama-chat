"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MeResponse } from "@/lib/api-types";

type MeCtx = { me: MeResponse | null; refresh(): Promise<void> };
const Ctx = createContext<MeCtx>({ me: null, refresh: async () => {} });

/** Fetches /api/me once and shares it. `me` is null while loading. */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" });
      if (r.ok) setMe((await r.json()) as MeResponse);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, refresh }), [me, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMe(): MeCtx {
  return useContext(Ctx);
}
