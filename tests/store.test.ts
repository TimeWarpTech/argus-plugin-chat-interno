import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../src/store.js";

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
  it("is the same one however the pair is ordered", async () => {
    const first = await store.openDirect("ana", "bruno");
    const again = await store.openDirect("bruno", "ana");
    expect(again.id).toBe(first.id);
    expect(await store.conversationsOf("ana")).toHaveLength(1);
  });

  it("is listed for both people and for nobody else", async () => {
    await store.openDirect("ana", "bruno");
    expect(await store.conversationsOf("ana")).toHaveLength(1);
    expect(await store.conversationsOf("bruno")).toHaveLength(1);
    expect(await store.conversationsOf("carla")).toHaveLength(0);
  });

  it("cannot be opened with yourself", async () => {
    await expect(store.openDirect("ana", "ana")).rejects.toThrow("not_two_people");
  });
});

describe("a group", () => {
  it("keeps its name and every member it was opened with", async () => {
    const group = await store.openGroup("Plantão", "ana", ["bruno", "carla"]);
    expect(group.name).toBe("Plantão");
    expect((await store.participantsOf(group.id)).sort()).toEqual(["ana", "bruno", "carla"]);
  });

  it("is a different conversation every time, unlike a direct one", async () => {
    const one = await store.openGroup("Plantão", "ana", ["bruno"]);
    const two = await store.openGroup("Plantão", "ana", ["bruno"]);
    expect(two.id).not.toBe(one.id);
  });

  it("refuses a name that is only spaces", async () => {
    await expect(store.openGroup("   ", "ana", [])).rejects.toThrow("empty_name");
  });
});

describe("sending", () => {
  it("refuses somebody who is not in the conversation", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    await expect(
      store.send({ conversationId: conversation.id, authorId: "carla", text: "oi" }),
    ).rejects.toThrow("not_a_participant");
  });

  it("refuses an empty text, so a blank message cannot exist", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    await expect(
      store.send({ conversationId: conversation.id, authorId: "ana", text: "   " }),
    ).rejects.toThrow("empty_message");
  });

  it("gives every message a growing sequence, which is what orders them", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    const first = await store.send({ conversationId: conversation.id, authorId: "ana", text: "primeira" });
    const second = await store.send({ conversationId: conversation.id, authorId: "bruno", text: "segunda" });
    expect(second.seq).toBeGreaterThan(first.seq);
    expect((await store.messagesOf(conversation.id)).map((m) => m.text)).toEqual(["primeira", "segunda"]);
  });

  it("is one message when the same id arrives twice", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    const once = { conversationId: conversation.id, authorId: "ana", text: "oi", messageId: "m-1" };
    await store.send(once);
    await store.send(once);
    expect(await store.messagesOf(conversation.id)).toHaveLength(1);
  });
});

describe("paging a conversation", () => {
  it("hands back the newest page, oldest first, and walks backwards from a point", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    for (let index = 1; index <= 5; index += 1) {
      await store.send({ conversationId: conversation.id, authorId: "ana", text: `m${index}` });
    }

    const newest = await store.messagesOf(conversation.id, { limit: 2 });
    expect(newest.map((m) => m.text)).toEqual(["m4", "m5"]);

    const oldest = newest[0];
    if (oldest === undefined) throw new Error("the page came back empty");
    const older = await store.messagesOf(conversation.id, { before: oldest.seq, limit: 2 });
    expect(older.map((m) => m.text)).toEqual(["m2", "m3"]);
  });
});

describe("the unread mark", () => {
  it("counts what the other person said and not what you said yourself", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({ conversationId: conversation.id, authorId: "ana", text: "minha" });
    await store.send({ conversationId: conversation.id, authorId: "bruno", text: "dele" });
    await store.send({ conversationId: conversation.id, authorId: "bruno", text: "dele 2" });
    // Two from Bruno are unread for Ana; the one Ana wrote herself is not. Bruno is owed the one
    // Ana wrote and nothing else -- his own two do not count against him.
    expect(await store.unreadFor("ana")).toBe(2);
    expect(await store.unreadFor("bruno")).toBe(1);
  });

  it("drops to zero once read, and never goes backwards", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    const message = await store.send({ conversationId: conversation.id, authorId: "bruno", text: "oi" });
    await store.markRead(conversation.id, "ana", message.seq);
    expect(await store.unreadFor("ana")).toBe(0);
    await store.markRead(conversation.id, "ana", message.seq - 1);
    expect(await store.unreadFor("ana")).toBe(0);
  });
});

describe("with nowhere to write", () => {
  it("still works, in memory, instead of inventing a path", async () => {
    const memory = openStore(undefined);
    const conversation = await memory.openDirect("ana", "bruno");
    await memory.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    expect(await memory.messagesOf(conversation.id)).toHaveLength(1);
    memory.close();
  });
});

describe("leaving with your data, and being forgotten", () => {
  it("exports the conversations and their messages", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    const exported = await store.exportAll();
    expect(exported.conversations).toHaveLength(1);
    expect(exported.messages).toHaveLength(1);
  });

  it("really deletes, so nothing survives the deletion", async () => {
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    await store.deleteAll();
    expect(await store.conversationsOf("ana")).toHaveLength(0);
    expect((await store.exportAll()).messages).toHaveLength(0);
  });
});
