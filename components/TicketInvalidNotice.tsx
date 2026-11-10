"use client";

import { useState } from "react";

/** Shown when the server cannot verify the save for a story. Offers a restart. */
export default function TicketInvalidNotice({
  message,
  onRestart,
}: {
  message: string;
  onRestart: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-lg border border-blood-500/40 bg-blood-600/10 px-4 py-3 text-sm">
      <p className="font-semibold text-blood-500">Save could not be verified</p>
      <p className="mt-1 text-white/70">{message}</p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onRestart();
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-blood-500 hover:text-blood-500 disabled:opacity-50"
      >
        ↺ Restart story
      </button>
    </div>
  );
}
