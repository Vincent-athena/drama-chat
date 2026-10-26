"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ApiKeyNotice from "./ApiKeyNotice";
import { PhaseAdvanceModal, readChatStream, Rich, type PhaseAdvance } from "./chat-parts";
import type { ChatMessage, PublicCharacter, PublicStory } from "@/lib/schema";

export default function ChatWindow({ storyId, characterId }: { storyId: string; characterId: string }) {
  const [story, setStory] = useState<PublicStory | null>(null);
  const [character, setCharacter] = useState<PublicCharacter | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    setCharacter(d.story.characters.find((c: PublicCharacter) => c.id === characterId) ?? null);
  }, [storyId, characterId]);

  useEffect(() => {
    (async () => {
      try {
        await loadStory();
        const r = await fetch(`/api/stories/${storyId}/chat/${characterId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setMessages(d.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [storyId, characterId, loadStory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy("typing");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/stories/${storyId}/chat/${characterId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      await readChatStream(res, (evt) => {
        if (evt.type === "delta") {
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
          throw new Error(String(evt.message));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      // Drop the unanswered turn; the server only saves completed exchanges.
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -2) : m));
      setInput(text);
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
  if (!story || !character) return <p className="text-white/50">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Link href={`/story/${storyId}`} className="text-sm text-white/50 hover:text-white">← {story.title}</Link>
        <div className="rounded-2xl border border-gold-500/20 bg-stage-900/80 p-5 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-black/40 text-5xl ring-1 ring-gold-500/40">
            {character.avatarEmoji}
          </div>
          <h1 className="mt-3 font-serif text-2xl text-gold-400">{character.name}</h1>
          <p className="text-xs uppercase tracking-wider text-white/50">{character.role}</p>
          <p className="mt-3 text-left text-sm text-white/70">{character.personality}</p>
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
              {character.name} looks up as you approach. Say something…
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user" ? "rounded-br-sm bg-blood-600/70" : "rounded-bl-sm bg-stage-700/80 font-serif"
                }`}
              >
                {m.role === "assistant" && !m.content ? (
                  <span className="animate-pulse text-white/50">{character.name} is thinking…</span>
                ) : (
                  <Rich text={m.content} />
                )}
              </div>
            </div>
          ))}
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
              placeholder={`Speak to ${character.name}… (use *asterisks* for actions)`}
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
