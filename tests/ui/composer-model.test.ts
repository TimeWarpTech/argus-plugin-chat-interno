import { describe, expect, it } from "vitest";
import { MAX_TEXT } from "../../shared/limits.js";
import { fitMessageInsertion } from "../../ui/src/composer-model";

describe("fitting text into a message", () => {
  it("preserves the existing text and only blocks the overflowing part of a paste", () => {
    const prefix = "a".repeat(MAX_TEXT - 2);
    expect(fitMessageInsertion(prefix, prefix.length, prefix.length, "ABCDE")).toEqual({
      value: `${prefix}AB`,
      caret: MAX_TEXT,
      blocked: 3,
    });
  });
  it("allows replacing a selection when the field is already full", () => {
    const text = "a".repeat(MAX_TEXT);
    expect(fitMessageInsertion(text, 0, 3, "xyz")).toEqual({ value: `xyz${text.slice(3)}`, caret: 3, blocked: 0 });
  });
  it("does not leave half an emoji at the limit", () => {
    const text = "a".repeat(MAX_TEXT - 1);
    expect(fitMessageInsertion(text, text.length, text.length, "😀")).toEqual({
      value: text,
      caret: text.length,
      blocked: 2,
    });
  });
});
