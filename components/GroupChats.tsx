"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicGroup, PublicStory } from "@/lib/schema";

export default function GroupChats({ story }: { story: PublicStory }) {
  const router = useRouter();
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/stories/${story.id}/groups`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setGroups(d.groups);
      })
      .catch((e) => setError(e.message));
  }, [story.id]);

  const unlocked = story.characters.filter((c) => c.unlocked);
  if (unlocked.length < 2) return null;

  const byId = new Map(story.characters.map((c) => [c.id, c]));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function create() {
    setError(null);
    const r = await fetch(`/api/stories/${story.id}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: selected }),
    });
    const d = await r.json();
    if (!r.ok) return setError(d.error);
    router.push(`/story/${story.id}/group/${d.group.id}`);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-serif text-2xl">Group chats</h2>
        {!picking && (
          <button
            onClick={() => setPicking(true)}
            className="rounded-lg border border-gold-500/40 px-3 py-1.5 text-sm text-gold-400 hover:border-gold-400"
          >
            ＋ New group chat
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-4 rounded-xl border border-gold-500/30 bg-stage-900/70 p-5">
          <p className="text-sm text-white/70">Who should be in the room? Pick at least two.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unlocked.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    on ? "border-gold-400 bg-gold-500/20 text-gold-400" : "border-white/15 bg-black/30 text-white/70 hover:border-white/40"
                  }`}
                >
                  {c.avatarEmoji} {c.name}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={create}
              disabled={selected.length < 2}
              className="rounded-lg bg-blood-500 px-4 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-50"
            >
              Start group chat
            </button>
            <button
              onClick={() => { setPicking(false); setSelected([]); }}
              className="px-3 py-2 text-sm text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-blood-500">{error}</p>}

      {groups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/story/${story.id}/group/${g.id}`}
              className="rounded-xl border border-gold-500/20 bg-stage-800/70 p-4 transition hover:border-gold-400/60 hover:bg-stage-700/70"
            >
              <p className="text-2xl">{g.memberIds.map((id) => byId.get(id)?.avatarEmoji ?? "🎭").join(" ")}</p>
              <p className="mt-2 font-serif text-gold-400">{g.memberIds.map((id) => byId.get(id)?.name ?? id).join(", ")}</p>
            </Link>
          ))}
        </div>
      ) : (
        !picking && <p className="text-sm text-white/40">Bring characters together to confront them, or let them argue it out.</p>
      )}
    </section>
  );
}
