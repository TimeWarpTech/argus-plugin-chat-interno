import { describe, expect, it } from "vitest";
import {
  groupByDay,
  hueOf,
  initialsOf,
  type Message,
  otherSideOf,
  previewOf,
  refusalIn,
} from "./model";
import { wordsFor } from "./words";

const words = wordsFor("pt-BR");

const message = (authorId: string, at: string, seq: number): Message => ({
  id: `m-${seq}`,
  conversationId: "c-1",
  authorId,
  text: `t-${seq}`,
  at,
  seq,
  attachments: [],
});

describe("reading a refusal", () => {
  it("finds the code the contract answered with", () => {
    expect(refusalIn({ error: "not_a_participant" })).toBe("not_a_participant");
  });

  it("says nothing about an answer that was not a refusal", () => {
    expect(refusalIn({ messages: [] })).toBeUndefined();
    expect(refusalIn(undefined)).toBeUndefined();
  });

  it("is turned into words a reader understands, and never left as a code", () => {
    expect(words.refusalFor("empty_message")).toBe("Escreva algo antes de enviar.");
    // A code nobody mapped still has to say something honest.
    expect(words.refusalFor("something_new")).toBe(words.refusalFor("chat_failed"));
    expect(words.refusalFor(undefined)).toBeUndefined();
  });
});

describe("the square that stands for a person", () => {
  it("takes at most two initials, however many names somebody has", () => {
    expect(initialsOf("Ana Paula de Souza Lima")).toBe("AP");
    expect(initialsOf("Bruno")).toBe("B");
    expect(initialsOf("   ")).toBe("");
  });

  it("keeps its colour across renames, because it comes from the id", () => {
    expect(hueOf("user-1")).toBe(hueOf("user-1"));
    expect(hueOf("user-1")).not.toBe(hueOf("user-2"));
  });
});

describe("who a conversation is with", () => {
  it("is whoever is not you", () => {
    const conversation = {
      id: "c-1",
      kind: "direct" as const,
      participants: ["ana", "bruno"],
      unread: 0,
    };
    expect(otherSideOf(conversation, "ana")).toBe("bruno");
    expect(otherSideOf(conversation, "bruno")).toBe("ana");
  });
});

describe("the line that stands for a message in the list", () => {
  it("is the text when there is text", () => {
    expect(previewOf(message("ana", "2026-10-27T10:00:00Z", 1))).toBe("t-1");
  });

  it("is the file's name when the file IS the message", () => {
    const withFile: Message = {
      ...message("ana", "2026-10-27T10:00:00Z", 1),
      text: "",
      attachments: [{ id: "a-1", name: "foto.png", mimeType: "image/png", size: 10 }],
    };
    expect(previewOf(withFile)).toBe("foto.png");
  });

  it("is empty for a conversation nobody has written in", () => {
    expect(previewOf(undefined)).toBe("");
  });
});

describe("grouping a thread", () => {
  const now = new Date("2026-10-27T15:00:00Z");

  it("puts a run from one person under one heading, and starts a new one when somebody else speaks", () => {
    const days = groupByDay(
      [
        message("ana", "2026-10-27T10:00:00Z", 1),
        message("ana", "2026-10-27T10:01:00Z", 2),
        message("bruno", "2026-10-27T10:02:00Z", 3),
        message("ana", "2026-10-27T10:03:00Z", 4),
      ],
      "pt-BR",
      words,
      now,
    );

    expect(days).toHaveLength(1);
    expect(days[0]?.runs.map((run) => [run.authorId, run.messages.length])).toEqual([
      ["ana", 2],
      ["bruno", 1],
      ["ana", 1],
    ]);
  });

  it("names today and yesterday, and dates anything older", () => {
    const days = groupByDay(
      [
        message("ana", "2026-10-20T10:00:00Z", 1),
        message("ana", "2026-10-26T10:00:00Z", 2),
        message("ana", "2026-10-27T10:00:00Z", 3),
      ],
      "pt-BR",
      words,
      now,
    );

    expect(days.map((day) => day.label).slice(1)).toEqual(["Ontem", "Hoje"]);
    expect(days[0]?.label).not.toBe("Hoje");
  });

  it("holds nothing for a conversation with no messages", () => {
    expect(groupByDay([], "pt-BR", words, now)).toEqual([]);
  });
});
