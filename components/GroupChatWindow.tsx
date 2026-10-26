"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ApiKeyNotice from "./ApiKeyNotice";
import { PhaseAdvanceModal, readChatStream, Rich, type PhaseAdvance } from "./chat-parts";
import type { GroupChatMessage, PublicCharacter, PublicStory } from "@/lib/schema";

export default function GroupChatWindow({ storyId, groupId }: { storyId: string; groupId: string }) {
  const [story, setStory] = useState<PublicStory | null>(null);
  const [members, setMembers] = useState<PublicCharacter[]>([]);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<false | "typing" | "judging">(false);
  const [error, setError] = useState<string | null>(null);
  const [advance, setAdvance] = useState<PhaseAdvance | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadStory = useCallback(async () => {
    const r = await fetch(`/api/stories/${storyId}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setStory(d.story);
    setHasApiKey(d.hasApiKey);
    return d.story as PublicStory;
  }, [storyId]);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadStory();
        const r = await fetch(`/api/stories/${storyId}/groups/${groupId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setMembers(
          (d.group.memberIds as string[])
            .map((id) => s.characters.find((c) => c.id === id))
            .filter((c): c is PublicCharacter => Boolean(c))
        );
        setMessages(d.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [storyId, groupId, loadStory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const memberById = (id: string) => members.find((c) => c.id === id);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy("typing");
    setMessages((m) => [...m, { role: "user", content: text, characterId: "" }]);

    let saved = false;
    try {
      const res = await fetch(`/api/stories/${storyId}/groups/${groupId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      await readChatStream(res, (evt) => {
        if (evt.type === "speaker") {
          setMessages((m) => [...m, { role: "assistant", content: "", characterId: String(evt.characterId) }]);
        } else if (evt.type === "delta") {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + evt.text };
            return copy;
          });
        } else if (evt.type === "replied") {
          setBusy("judging");
        } else if (evt.type === "done") {
          if (evt.phaseAdvanced) {
            setAdvance(evt as unknown as PhaseAdvance);
            loadStory();
          }
        } else if (evt.type === "error") {
          saved = Boolean(evt.saved);
          throw new Error(String(evt.message));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setMessages((m) => {
        // Drop a reply that never got any text.
        const trimmed = m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m;
        if (saved) return trimmed;
        // Nothing was saved: drop the player's line too and give it back to them.
        const lastUser = trimmed.map((x) => x.role).lastIndexOf("user");
        return lastUser >= 0 ? trimmed.slice(0, lastUser) : trimmed;
      });
      if (!saved) setInput(text);
    } finally {
      setBusy(false);
    }
  }

  if (error && !story) {
    return (
      <div className="space-y-4">
        <Link href={`/story/${storyId}`} className="text-sm text-white/50 hover:text-white">← Back to story</Link>
        <p className="text-blood-500">{error}</p>
      </div>
    );
  }
  if (!story || members.length === 0) return <p className="text-white/50">Loading…</p>;

  const names = members.map((c) => c.name).join(", ");
  const waitingForFirstReply = busy === "typing" && messages[messages.length - 1]?.role === "user";

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Link href={`/story/${storyId}`} className="text-sm text-white/50 hover:text-white">← {story.title}</Link>
        <div className="rounded-2xl border border-gold-500/20 bg-stage-900/80 p-5">
          <p className="text-center text-xs uppercase tracking-wider text-gold-500">Group chat</p>
          <ul className="mt-4 space-y-3">
            {members.map((c) => (
              <li key={c.id}>
                <Link href={`/story/${storyId}/chat/${c.id}`} className="group flex items-center gap-3" title="Talk in private">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/40 text-2xl ring-1 ring-gold-500/30 group-hover:ring-gold-400">
                    {c.avatarEmoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-serif text-gold-400">{c.name}</span>
                    <span className="block text-xs uppercase tracking-wider text-white/50">{c.role}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-white/40">
            Each of them remembers your private talks with them, and will remember this conversation when you talk alone.
          </p>
        </div>
        {story.currentPhase && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm">
            <p className="text-xs uppercase tracking-wider text-gold-500">
              Chapter {story.phaseIndex + 1}: {story.currentPhase.title}
            </p>
            <p className="mt-1 text-white/80">🎯 {story.currentPhase.objective}</p>
          </div>
        )}
      </aside>

      <section className="flex h-[calc(100vh-9rem)] flex-col rounded-2xl border border-white/10 bg-stage-900/60">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <p className="mt-10 text-center font-serif italic text-white/40">
              {names} are gathered in one room. Say something…
            </p>
          )}
          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blood-600/70 px-4 py-3 text-[15px] leading-relaxed">
                    <Rich text={m.content} />
                  </div>
                </div>
              );
            }
            const speaker = memberById(m.characterId);
            return (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/40 text-xl ring-1 ring-gold-500/30">
                  {speaker?.avatarEmoji ?? "🎭"}
                </span>
                <div className="max-w-[80%]">
                  <p className="mb-1 text-xs text-gold-500">{speaker?.name ?? m.characterId}</p>
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-stage-700/80 px-4 py-3 font-serif text-[15px] leading-relaxed">
                    {!m.content ? (
                      <span className="animate-pulse text-white/50">{speaker?.name} is thinking…</span>
                    ) : (
                      <Rich text={m.content} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {waitingForFirstReply && <p className="text-center text-xs text-white/30">The room falls quiet…</p>}
          {busy === "judging" && <p className="text-center text-xs text-white/30">The story is unfolding…</p>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/10 p-4">
          {!hasApiKey && <div className="mb-3"><ApiKeyNotice /></div>}
          {error && <p className="mb-2 text-sm text-blood-500">{error}</p>}
          <form onSubmit={send} className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Speak to the room, or address someone by name… (use *asterisks* for actions)"
              disabled={!!busy}
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-gold-500 disabled:opacity-60"
            />
            <button
              type="submit" disabled={!!busy || !input.trim()}
              className="rounded-xl bg-blood-500 px-5 font-semibold hover:bg-blood-600 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </section>

      {advance && <PhaseAdvanceModal storyId={storyId} advance={advance} onClose={() => setAdvance(null)} />}
    </div>
  );
}
