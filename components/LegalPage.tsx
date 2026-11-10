import Link from "next/link";

/** Shared frame for the privacy and terms pages: static text, readable on a phone. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-4 leading-relaxed text-white/80 [&_a]:text-gold-400 [&_a]:underline [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:text-gold-400 [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="font-serif text-3xl text-gold-400">{title}</h1>
      <p className="text-sm text-white/50">Last updated: {updated}</p>
      {children}
      <p className="pt-4 text-sm">
        <Link href="/">Back to Drama Chat</Link>
      </p>
    </article>
  );
}
