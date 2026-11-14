import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segments } from "../lib/rich-text";

const actions = (text: string) => segments(text).filter((s) => s.action).map((s) => s.text);

describe("segments", () => {
  it("highlights *asterisk* actions", () => {
    assert.deepEqual(actions(`*Nàng cúi đầu.* "Muội không biết."`), ["Nàng cúi đầu."]);
  });

  it("treats narration outside quotes as action when a reply has no asterisks", () => {
    const text = `"Không phải là huynh làm sai gì cả..." Giọng nàng nghẹn lại.\n\nNàng lùi lại một bước. “Hãy nghe muội nói.”`;
    assert.deepEqual(actions(text), ["Giọng nàng nghẹn lại.", "Nàng lùi lại một bước."]);
    assert.equal(segments(text).map((s) => s.text).join(""), text);
  });

  it("leaves text with neither asterisks nor quotes plain", () => {
    assert.deepEqual(segments("rồi sao tui bị đuổi vậy"), [{ text: "rồi sao tui bị đuổi vậy", action: false }]);
  });

  it("gives the same answer on repeated calls", () => {
    const text = `"A" b`;
    assert.deepEqual(actions(text), ["b"]);
    assert.deepEqual(actions(text), ["b"]);
  });
});
