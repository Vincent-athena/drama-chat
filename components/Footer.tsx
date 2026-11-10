"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Hidden on the chat screens: they size themselves to the viewport and a footer would push the message box down. */
export default function Footer() {
  const path = usePathname() ?? "";
  if (/^\/story\/[^/]+\/(chat|group)(\/|$)/.test(path)) return null;
  return (
    <footer className="mx-auto flex max-w-6xl gap-4 px-4 pb-4 text-xs text-white/60">
      <Link href="/privacy" className="py-2 hover:text-white">
        Privacy
      </Link>
      <Link href="/terms" className="py-2 hover:text-white">
        Terms
      </Link>
    </footer>
  );
}
