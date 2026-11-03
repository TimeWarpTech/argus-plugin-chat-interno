import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../src/store.js";

let store: Store;
beforeEach(() => {
  store = openStore(undefined);
});
afterEach(() => store.close());

describe("message receipts", () => {
  it("records delivery and reading independently, preserves timestamps and refuses outsiders", async () => {
    const chat = await store.openDirect("ana", "bruno");
    const message = await store.send({ conversationId: chat.id, authorId: "ana", text: "Oi" });
    const receipt = async () => (await store.messagesOf(chat.id, { userId: "ana" }))[0]?.receipts?.[0];
    expect(await receipt()).toMatchObject({ userId: "bruno", delivered: false, read: false, readAt: null });
    await expect(store.markDelivered(chat.id, "carla", message.seq)).rejects.toThrow("not_a_participant");
    expect(await store.markDelivered(chat.id, "bruno", message.seq)).toBe(true);
    expect(await receipt()).toMatchObject({
      delivered: true,
      read: false,
      deliveredAt: expect.any(String),
      readAt: null,
    });
    const deliveredAt = (await receipt())?.deliveredAt;
    await store.markRead(chat.id, "bruno", message.seq);
    expect(await receipt()).toMatchObject({ delivered: true, read: true, deliveredAt, readAt: expect.any(String) });
    const readAt = (await receipt())?.readAt;
    expect(await store.markRead(chat.id, "bruno", message.seq)).toBe(false);
    expect((await receipt())?.readAt).toBe(readAt);
    expect((await store.messagesOf(chat.id, { userId: "bruno" }))[0]?.receipts).toBeUndefined();
  });

  it("keeps the original recipients when group members are added or leave", async () => {
    const chat = await store.openGroup("Equipe", "ana", ["bruno", "carla"]);
    const message = await store.send({ conversationId: chat.id, authorId: "ana", text: "Oi" });
    await store.markRead(chat.id, "bruno", message.seq);
    await store.addMembers(chat.id, ["daniel"], "ana");
    await store.leaveGroup(chat.id, "bruno");
    const receipts = (await store.messagesOf(chat.id, { userId: "ana" }))[0]?.receipts ?? [];
    expect(receipts.map((receipt) => receipt.userId).sort()).toEqual(["bruno", "carla"]);
    expect(receipts.every((receipt) => receipt.read)).toBe(false);
    await store.markRead(chat.id, "carla", message.seq);
    expect((await store.messagesOf(chat.id, { userId: "ana" }))[0]?.receipts?.every((receipt) => receipt.read)).toBe(
      true,
    );
  });

  it("does not mark hidden history as read or let an oversized read cursor skip future messages", async () => {
    const chat = await store.openDirect("ana", "bruno");
    await store.send({ conversationId: chat.id, authorId: "ana", text: "Antiga" });
    await store.deleteConversation(chat.id, "bruno");
    const latest = await store.send({ conversationId: chat.id, authorId: "ana", text: "Nova" });
    await store.markRead(chat.id, "bruno", latest.seq + 1000);
    const receipts = (await store.messagesOf(chat.id, { userId: "ana" })).map((message) => message.receipts?.[0]?.read);
    expect(receipts).toEqual([false, true]);
    await store.send({ conversationId: chat.id, authorId: "ana", text: "Seguinte" });
    expect(await store.unreadFor("bruno")).toBe(1);
  });
});
