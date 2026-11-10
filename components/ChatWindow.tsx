"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ApiKeyNotice from "./ApiKeyNotice";
import { CHAT_ASIDE, CHAT_BACK, CHAT_OBJECTIVE, CHAT_PANEL, CHAT_SHELL, ItemBlockedNotice, ItemFoundNotice, PhaseAdvanceModal, Rich, toPhaseAdvance, toTurnNotices, type PhaseAdvance } from "./chat-parts";
import ItemPicker from "./ItemPicker";
import TicketInvalidNotice from "./TicketInvalidNotice";
import type { PublicItem, PublicStory, StreamEvent } from "@/lib/api-types";
import { apiFetch, ApiError, describeApiError, readNdjson } from "@/lib/client/api";
import { showItemLine } from "@/lib/items-shared";
import { applyDone, currentRun, loadStoryView, restartStory } from "@/lib/client/story";
import { chatContext } from "@/lib/save/context";
import { useRequireUser } from "@/lib/save/useSave";
import type { ChatMessage, PublicCharacter } from "@/lib/schema";

export default function ChatWindow({ storyId, characterId }: { storyId: string; characterId: string }) {
  const { store } = useRequireUser();
  const [story, setStory] = useState<PublicStory | null>(null);
  const [character, setCharacter] = useState<PublicCharacter | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<false | "typing" | "judging">(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketInvalid, setTicketInvalid] = useState(false);
  const [advance, setAdvance] = useState<PhaseAdvance | null>(null);
  const [shown, setShown] = useState<PublicItem | null>(null);
  const [picking, setPicking] = useState(false);
  const [notices, setNotices] = useState<{ found: PublicItem[]; blocked: string[] }>({ found: [], blocked: [] });
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadStory = useCallback(async () => {
    if (!store) return;
    const v = await loadStoryView(store, storyId);
    const c = v.story.characters.find((x) => x.id === characterId) ?? null;
    if (!c) throw new Error("Character not found");
    if (!c.unlocked) throw new Error("This character is still locked");
    setStory(v.story);
    setHasApiKey(v.hasApiKey);
    setCharacter(c);
    return v.story;
  }, [store, storyId, characterId]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === "ticket_invalid") setTicketInvalid(true);
    setError(describeApiError(e));
  }, []);

  useEffect(() => {
    if (!store) return;
    (async () => {
      try {
        await loadStory();
        setMessages(await store.getHistory(storyId, characterId));
      } catch (e) {
        fail(e);
      }
    })();
  }, [store, storyId, characterId, loadStory, fail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function restart() {
    if (!store) return;
    await restartStory(store, storyId);
    setTicketInvalid(false);
    setError(null);
    setMessages([]);
    setShown(null);
    setNotices({ found: [], blocked: [] });
    await loadStory().catch(fail);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const typed = input.trim();
    const item = shown;
    if ((!typed && !item) || busy || !store) return;
    // The line that announces a shown item is part of the message; the server only checks ownership.
    const text = item ? (typed ? `${showItemLine(item)}\n${typed}` : showItemLine(item)) : typed;
    setInput("");
    setShown(null);
    setPicking(false);
    setNotices({ found: [], blocked: [] });
    setError(null);
    setBusy("typing");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);

    let reply = "";
    let saved = false;
    try {
      // The ticket is read from the store at send time, never held in component state.
      const sentRun = await currentRun(store, storyId);
      const context = await chatContext(store, storyId, characterId);
      const res = await apiFetch(`/api/stories/${storyId}/chat/${characterId}`, {
        method: "POST",
        json: { message: text, ...(item ? { showItemId: item.id } : {}), context },
        ticket: { store, storyId },
      });
      await readNdjson<StreamEvent>(res, async (evt) => {
        if (evt.type === "delta") {
          reply += evt.text;
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + evt.text };
            return copy;
          });
        } else if (evt.type === "replied") {
          // Save the exchange now, unless the story was restarted while the reply was streaming.
          if ((await currentRun(store, storyId)) === sentRun) {
            await store.addMessage(storyId, characterId, { role: "user", content: text });
            await store.addMessage(storyId, characterId, { role: "assistant", content: reply });
          }
          saved = true;
          setBusy("judging");
        } else if (evt.type === "done") {
          await applyDone(store, storyId, sentRun, evt);
          if (evt.phaseAdvanced) setAdvance(toPhaseAdvance(evt));
          const view = await loadStory();
          setNotices(toTurnNotices(evt, view?.items ?? []));
        } else if (evt.type === "error") {
          throw new Error(evt.message);
        }
      });
    } catch (err) {
      fail(err);
      if (!saved) {
        // Drop the unsaved turn (the player's line and the reply, even a partial one), so the screen
        // matches the saved chat and a retry does not show the line twice.
        setMessages((m) => (m[m.length - 1]?.role === "assistant" ? m.slice(0, -2) : m));
        setInput(typed);
        setShown(item);
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !story) {
    return (
      <div className="space-y-4">
        <Link href={`/story/${storyId}`} className="text-sm text-white/50 hover:text-white">← Back to story</Link>
        {ticketInvalid ? <TicketInvalidNotice message={error} onRestart={restart} /> : <p className="text-blood-500">{error}</p>}
      </div>
    );
  }
  if (!story || !character) return <p className="text-white/50">Loading…</p>;

  return (
    <div className={CHAT_SHELL}>
      <aside className={CHAT_ASIDE}>
        <Link href={`/story/${storyId}`} className={CHAT_BACK}>← {story.title}</Link>
        <div className="flex items-center gap-3 rounded-2xl border border-gold-500/20 bg-stage-900/80 p-3 lg:block lg:p-5 lg:text-center">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/40 text-2xl ring-1 ring-gold-500/40 lg:mx-auto lg:h-20 lg:w-20 lg:text-5xl">
            {character.avatarEmoji}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-lg text-gold-400 lg:mt-3 lg:whitespace-normal lg:text-2xl">{character.name}</h1>
            <p className="truncate text-xs uppercase tracking-wider text-white/50 lg:whitespace-normal">{character.role}</p>
          </div>
          <p className="mt-3 hidden text-left text-sm text-white/70 lg:block">{character.personality}</p>
        </div>
        {story.currentPhase && (
          <div className={CHAT_OBJECTIVE}>
            <p className="hidden text-xs uppercase tracking-wider text-gold-500 lg:block">
              Chapter {story.phaseIndex + 1}: {story.currentPhase.title}
            </p>
            <p className="line-clamp-2 text-white/80 lg:mt-1 lg:line-clamp-none">🎯 {story.currentPhase.objective}</p>
          </div>
        )}
      </aside>

      <section className={CHAT_PANEL}>
        <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
          {messages.length === 0 && (
            <p className="mt-10 text-center font-serif italic text-white/40">
              {character.name} looks up as you approach. Say something…
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[80%] ${
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
          {notices.found.map((i) => <ItemFoundNotice key={i.id} item={i} />)}
          {notices.blocked.length > 0 && <ItemBlockedNotice names={notices.blocked} />}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/10 p-3 sm:p-4">
          {!hasApiKey && <div className="mb-3"><ApiKeyNotice /></div>}
          {ticketInvalid && error ? (
            <div className="mb-3"><TicketInvalidNotice message={error} onRestart={restart} /></div>
          ) : (
            error && <p className="mb-2 text-sm text-blood-500">{error}</p>
          )}
          {picking && <ItemPicker items={story.items} onPick={(i) => { setShown(i); setPicking(false); }} onClose={() => setPicking(false)} />}
          {shown && (
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="rounded-full border border-gold-500/40 bg-black/40 px-3 py-1">Showing {shown.emoji} {shown.name}</span>
              <button type="button" onClick={() => setShown(null)} aria-label="Stop showing the item" className="p-2 text-white/50 hover:text-white">✕</button>
            </div>
          )}
          <form onSubmit={send} className="flex gap-2 sm:gap-3">
            <button
              type="button" onClick={() => setPicking((v) => !v)} disabled={!!busy} title="Show an item"
              className="rounded-xl border border-white/10 px-3 text-xl hover:border-gold-500 disabled:opacity-50"
            >
              🎒
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Speak to ${character.name}… (use *asterisks* for actions)`}
              disabled={!!busy}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-gold-500 disabled:opacity-60 sm:px-4"
            />
            <button
              type="submit" disabled={!!busy || (!input.trim() && !shown)}
              className="rounded-xl bg-blood-500 px-4 font-semibold hover:bg-blood-600 disabled:opacity-50 sm:px-5"
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
