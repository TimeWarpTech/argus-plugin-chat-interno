import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "./store.js";

let folder: string;
let store: Store;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "chat-interno-"));
  store = openStore(folder);
});

afterEach(() => {
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("a direct conversation", () => {
  it("is the same one however the pair is ordered", () => {
    const first = store.openDirect("ana", "bruno");
    const again = store.openDirect("bruno", "ana");
    expect(again.id).toBe(first.id);
    expect(store.conversationsOf("ana")).toHaveLength(1);
  });

  it("is listed for both people and for nobody else", () => {
    store.openDirect("ana", "bruno");
    expect(store.conversationsOf("ana")).toHaveLength(1);
    expect(store.conversationsOf("bruno")).toHaveLength(1);
    expect(store.conversationsOf("carla")).toHaveLength(0);
  });
});

describe("a group", () => {
  it("keeps its name and every member it was opened with", () => {
    const group = store.openGroup("Plantão", "ana", ["bruno", "carla"]);
    expect(group.name).toBe("Plantão");
    expect(store.participantsOf(group.id).sort()).toEqual(["ana", "bruno", "carla"]);
  });

  it("is a different conversation every time, unlike a direct one", () => {
    const one = store.openGroup("Plantão", "ana", ["bruno"]);
    const two = store.openGroup("Plantão", "ana", ["bruno"]);
    expect(two.id).not.toBe(one.id);
  });
});

describe("sending", () => {
  it("refuses somebody who is not in the conversation", () => {
    const conversation = store.openDirect("ana", "bruno");
    expect(() => store.send({ conversationId: conversation.id, authorId: "carla", text: "oi" })).toThrow(
      "not_a_participant",
    );
  });

  it("refuses an empty text, so a blank message cannot exist", () => {
    const conversation = store.openDirect("ana", "bruno");
    expect(() => store.send({ conversationId: conversation.id, authorId: "ana", text: "   " })).toThrow(
      "empty_message",
    );
  });

  it("gives every message a growing sequence, which is what orders them", () => {
    const conversation = store.openDirect("ana", "bruno");
    const first = store.send({ conversationId: conversation.id, authorId: "ana", text: "primeira" });
    const second = store.send({ conversationId: conversation.id, authorId: "bruno", text: "segunda" });
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(store.messagesOf(conversation.id).map((m) => m.text)).toEqual(["primeira", "segunda"]);
  });
});

describe("the unread mark", () => {
  it("counts what the other person said and not what you said yourself", () => {
    const conversation = store.openDirect("ana", "bruno");
    store.send({ conversationId: conversation.id, authorId: "ana", text: "minha" });
    store.send({ conversationId: conversation.id, authorId: "bruno", text: "dele" });
    store.send({ conversationId: conversation.id, authorId: "bruno", text: "dele 2" });
    // Two from Bruno are unread for Ana; the one Ana wrote herself is not. Bruno is owed the one
    // Ana wrote and nothing else -- his own two do not count against him.
    expect(store.unreadFor("ana")).toBe(2);
    expect(store.unreadFor("bruno")).toBe(1);
  });

  it("drops to zero once read, and never goes backwards", () => {
    const conversation = store.openDirect("ana", "bruno");
    const message = store.send({ conversationId: conversation.id, authorId: "bruno", text: "oi" });
    store.markRead(conversation.id, "ana", message.seq);
    expect(store.unreadFor("ana")).toBe(0);
    store.markRead(conversation.id, "ana", message.seq - 1);
    expect(store.unreadFor("ana")).toBe(0);
  });
});

describe("with nowhere to write", () => {
  it("still works, in memory, instead of inventing a path", () => {
    const memory = openStore(undefined);
    const conversation = memory.openDirect("ana", "bruno");
    memory.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    expect(memory.messagesOf(conversation.id)).toHaveLength(1);
    memory.close();
  });
});

describe("leaving with your data, and being forgotten", () => {
  it("exports the conversations and their messages", () => {
    const conversation = store.openDirect("ana", "bruno");
    store.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    const exported = store.exportAll();
    expect(exported.conversations).toHaveLength(1);
    expect(exported.messages).toHaveLength(1);
  });

  it("really deletes, so nothing survives the deletion", () => {
    const conversation = store.openDirect("ana", "bruno");
    store.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    store.deleteAll();
    expect(store.conversationsOf("ana")).toHaveLength(0);
    expect(store.exportAll().messages).toHaveLength(0);
  });
});
