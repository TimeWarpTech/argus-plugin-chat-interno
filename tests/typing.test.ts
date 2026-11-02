import { describe, expect, it } from "vitest";
import { TYPING_TTL_MS, TypingRegistry } from "../src/typing.js";

describe("typing activity", () => {
  it("keeps rooms separate, renews activity, expires it and removes it immediately on stop", () => {
    const typing = new TypingRegistry();
    typing.set("a", "ana", true, 1000);
    typing.set("b", "bruno", true, 1000);
    typing.set("a", "ana", true, 2000);
    expect(typing.list("a", 1000 + TYPING_TTL_MS)).toEqual([{ userId: "ana", expiresAt: 2000 + TYPING_TTL_MS }]);
    expect(typing.list("b", 1000 + TYPING_TTL_MS)).toEqual([]);
    typing.set("a", "ana", false, 7500);
    expect(typing.list("a", 7500)).toEqual([]);
    expect(new TypingRegistry().list("a")).toEqual([]);
  });
});
