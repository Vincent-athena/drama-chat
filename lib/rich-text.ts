/** A run of chat text: spoken or plain text, or an action shown highlighted. */
export type Segment = { text: string; action: boolean };

const ASTERISK_ACTION = /(\*[^*\n]+\*)/g;
const QUOTED = /("[^"\n]*"|“[^”\n]*”)/g;

/**
 * Splits a message into actions and the rest. Actions are written in *asterisks*; when a reply has none
 * but does quote its speech, the model narrated novel-style, so the narration outside the quotes is the action.
 */
export function segments(text: string): Segment[] {
  if (/\*[^*\n]+\*/.test(text)) {
    return text
      .split(ASTERISK_ACTION)
      .filter(Boolean)
      .map((part) =>
        part.startsWith("*") && part.endsWith("*") && part.length > 2
          ? { text: part.slice(1, -1), action: true }
          : { text: part, action: false }
      );
  }
  if (!/"[^"\n]*"|“[^”\n]*”/.test(text)) return [{ text, action: false }];
  const out: Segment[] = [];
  for (const part of text.split(QUOTED)) {
    if (!part) continue;
    if (/^["“]/.test(part)) {
      out.push({ text: part, action: false });
      continue;
    }
    // Keep spaces and line breaks plain, so only the words of each line are highlighted.
    for (const piece of part.split(/(\s*\n\s*)/)) {
      if (!piece) continue;
      const [, lead, body, trail] = piece.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      if (lead) out.push({ text: lead, action: false });
      if (body) out.push({ text: body, action: true });
      if (trail) out.push({ text: trail, action: false });
    }
  }
  return out;
}
