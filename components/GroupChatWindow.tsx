"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ApiKeyNotice from "./ApiKeyNotice";
import { ItemBlockedNotice, ItemFoundNotice, PhaseAdvanceModal, Rich, toPhaseAdvance, toTurnNotices, type PhaseAdvance } from "./chat-parts";
import ItemPicker from "./ItemPicker";
import TicketInvalidNotice from "./TicketInvalidNotice";
import type { PublicItem, PublicStory, StreamEvent } from "@/lib/api-types";
import { apiFetch, ApiError, describeApiError, readNdjson } from "@/lib/client/api";
import { showItemLine } from "@/lib/items-shared";
import { applyDone, currentRun, loadStoryView, restartStory } from "@/lib/client/story";
import { groupContext } from "@/lib/save/context";
import { useRequireUser } from "@/lib/save/useSave";
import type { ChatMessage, Group, PublicCharacter } from "@/lib/schema";

/** A line in the room; characterId is the speaker, or "" when the player spoke. */
type Line = ChatMessage & { characterId: string };

export default function GroupChatWindow({ storyId, groupId }: { storyId: string; groupId: string }) {
  const { store } = useRequireUser();
  const [story, setStory] = useState<PublicStory | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<PublicCharacter[]>([]);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [messages, setMessages] = useState<Line[]>([]);
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
    if (!store) return null;
    const v = await loadStoryView(store, storyId);
    setStory(v.story);
    setHasApiKey(v.hasApiKey);
    return v.story;
  }, [store, storyId]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === "ticket_invalid") setTicketInvalid(true);
    setError(describeApiError(e));
  }, []);

  useEffect(() => {
    if (!store) return;
    (async () => {
      try {
        const g = await store.getGroup(storyId, Number(groupId));
        if (!g) throw new Error("Group chat not found");
        const s = await loadStory();
        if (!s) return;
        const found = g.memberIds
          .map((id) => s.characters.find((c) => c.id === id))
          .filter((c): c is PublicCharacter => Boolean(c));
        if (found.length !== g.memberIds.length || found.some((c) => !c.unlocked)) {
          throw new Error("This group includes a locked character");
        }
        setGroup(g);
        setMembers(found);
        setMessages((await store.getGroupHistory(storyId, g.id)).map(({ role, content, characterId }) => ({ role, content, characterId })));
      } catch (e) {
        fail(e);
      }
    })();
  }, [store, storyId, groupId, loadStory, fail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const memberById = (id: string) => members.find((c) => c.id === id);

  async function restart() {
    if (!store) return;
    await restartStory(store, storyId);
    // The group itself is gone with the rest of the save.
    window.location.assign(`/story/${storyId}`);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const typed = input.trim();
    const item = shown;
    if ((!typed && !item) || busy || !store || !group) return;
    // The line that announces a shown item is part of the message; the server only checks ownership.
    const text = item ? (typed ? `${showItemLine(item)}\n${typed}` : showItemLine(item)) : typed;
    setInput("");
    setShown(null);
    setPicking(false);
    setNotices({ found: [], blocked: [] });
    setError(null);
    setBusy("typing");
    setMessages((m) => [...m, { role: "user", content: text, characterId: "" }]);

    // Replies that have finished (a reply is finished when the next speaker or `replied` arrives).
    const finished: { speakerId: string; text: string }[] = [];
    let current: { speakerId: string; text: string } | null = null;
    let sentRun: string | null = null;
    let savedRound = false;
    const saveRound = async () => {
      if (savedRound || finished.length === 0) return;
      savedRound = true;
      if ((await currentRun(store, storyId)) !== sentRun) return;
      await store.addGroupMessage(storyId, group.id, "", { role: "user", content: text });
      for (const r of finished) await store.addGroupMessage(storyId, group.id, r.speakerId, { role: "assistant", content: r.text });
    };
    try {
      sentRun = await currentRun(store, storyId);
      const context = await groupContext(store, storyId, group);
      const res = await apiFetch(`/api/stories/${storyId}/group-chat`, {
        method: "POST",
        json: { message: text, ...(item ? { showItemId: item.id } : {}), group: { id: group.id, memberIds: group.memberIds }, context },
        ticket: { store, storyId },
      });
      await readNdjson<StreamEvent>(res, async (evt) => {
        if (evt.type === "speaker") {
          if (current) finished.push(current);
          current = { speakerId: evt.characterId, text: "" };
          setMessages((m) => [...m, { role: "assistant", content: "", characterId: evt.characterId }]);
        } else if (evt.type === "delta") {
          if (current) current.text += evt.text;
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + evt.text };
            return copy;
          });
        } else if (evt.type === "replied") {
          if (current) finished.push(current);
          current = null;
          await saveRound();
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
      const keep = finished.length > 0;
      // Keep the replies that finished before the failure.
      await saveRound().catch(() => undefined);
      const unfinished = current as { speakerId: string; text: string } | null;
      setMessages((m) => {
        // Drop a reply that never finished.
        const trimmed = unfinished && m[m.length - 1]?.role === "assistant" ? m.slice(0, -1) : m;
        if (keep) return trimmed;
        // Nothing finished: drop the player's line too and give it back to them.
        const lastUser = trimmed.map((x) => x.role).lastIndexOf("user");
        return lastUser >= 0 ? trimmed.slice(0, lastUser) : trimmed;
      });
      if (!keep) {
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
  if (error && members.length === 0) {
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
          {notices.found.map((i) => <ItemFoundNotice key={i.id} item={i} />)}
          {notices.blocked.length > 0 && <ItemBlockedNotice names={notices.blocked} />}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/10 p-4">
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
              <button type="button" onClick={() => setShown(null)} aria-label="Stop showing the item" className="text-white/50 hover:text-white">✕</button>
            </div>
          )}
          <form onSubmit={send} className="flex gap-3">
            <button
              type="button" onClick={() => setPicking((v) => !v)} disabled={!!busy} title="Show an item"
              className="rounded-xl border border-white/10 px-3 text-xl hover:border-gold-500 disabled:opacity-50"
            >
              🎒
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Speak to the room, or address someone by name… (use *asterisks* for actions)"
              disabled={!!busy}
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-gold-500 disabled:opacity-60"
            />
            <button
              type="submit" disabled={!!busy || (!input.trim() && !shown)}
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
