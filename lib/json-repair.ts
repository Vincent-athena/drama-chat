/**
 * Swaps closing brackets that don't match what they close, e.g. an object ended with "]".
 * Long generated stories occasionally contain this slip, which otherwise fails the whole story.
 */
export function fixMismatchedBrackets(raw: string): string {
  const out = raw.split("");
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected && ch !== expected) out[i] = expected;
    }
  }
  return out.join("");
}
