import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../src/store.js";

let store: Store;
beforeEach(() => {
  store = openStore(undefined);
});
afterEach(() => store.close());

describe("replying to a message", () => {
  it("saves a reply and resolves the original for both people without copying its text into the reply body", async () => {
    const chat = await store.openDirect("ana", "bruno");
    const original = await store.send({ conversationId: chat.id, authorId: "ana", text: "Pergunta" });
    const reply = await store.send({
      conversationId: chat.id,
      authorId: "bruno",
      text: "Resposta",
      replyToId: original.id,
    });
    expect(reply.text).toBe("Resposta");
    for (const userId of ["ana", "bruno"]) {
      expect(
        (await store.messagesOf(chat.id, { userId })).find((message) => message.id === reply.id)?.replyTo,
      ).toMatchObject({ id: original.id, authorId: "ana", text: "Pergunta" });
    }
  });
  it("refuses a missing, deleted or cross-conversation original", async () => {
    const chat = await store.openDirect("ana", "bruno");
    const other = await store.openDirect("ana", "carla");
    const original = await store.send({ conversationId: other.id, authorId: "ana", text: "Privada" });
    await expect(
      store.send({ conversationId: chat.id, authorId: "ana", text: "Nao", replyToId: original.id }),
    ).rejects.toThrow("invalid_reply");
    await expect(
      store.send({ conversationId: chat.id, authorId: "ana", text: "Nao", replyToId: "missing" }),
    ).rejects.toThrow("invalid_reply");
    await store.deleteMessage(original.id, "ana");
    await expect(
      store.send({ conversationId: other.id, authorId: "ana", text: "Nao", replyToId: original.id }),
    ).rejects.toThrow("invalid_reply");
  });
  it("removes quoted text after deleting the original and hides quotes from a cleared history", async () => {
    const chat = await store.openDirect("ana", "bruno");
    const original = await store.send({ conversationId: chat.id, authorId: "ana", text: "Segredo" });
    await store.deleteConversation(chat.id, "bruno");
    await expect(
      store.send({ conversationId: chat.id, authorId: "bruno", text: "Nao", replyToId: original.id }),
    ).rejects.toThrow("invalid_reply");
    const reply = await store.send({
      conversationId: chat.id,
      authorId: "ana",
      text: "Citando",
      replyToId: original.id,
    });
    expect((await store.messagesOf(chat.id, { userId: "bruno" }))[0]?.replyTo).toEqual({
      id: original.id,
      unavailable: true,
    });
    await store.deleteMessage(original.id, "ana");
    const quote = (await store.messagesOf(chat.id, { userId: "ana" })).find(
      (message) => message.id === reply.id,
    )?.replyTo;
    expect(quote?.deleted).toBe(true);
    expect(quote).not.toHaveProperty("text");
  });
});
