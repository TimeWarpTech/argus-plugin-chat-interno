import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../src/store.js";

let store: Store;
beforeEach(() => {
  store = openStore(undefined);
});
afterEach(() => {
  store.close();
});

describe("group administrators", () => {
  it("makes the creator admin and gives a system-created group a human admin", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno"]);
    expect((await store.conversationsOf("ana"))[0]?.admins).toEqual(["ana"]);
    expect((await store.conversationsOf("bruno"))[0]?.id).toBe(group.id);
    await store.openGroup("Plantao", "system", ["carla"]);
    expect((await store.conversationsOf("carla"))[0]?.admins).toContain("carla");
  });

  it("refuses self-promotion, outsider promotion and group edits by regular members", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno"]);
    await expect(store.setGroupAdmin(group.id, "bruno", true, "bruno")).rejects.toThrow("admin_required");
    await expect(store.setGroupAdmin(group.id, "bruno", true, "carla")).rejects.toThrow("not_a_participant");
    await expect(store.setGroupAdmin(group.id, "carla", true, "ana")).rejects.toThrow("no_such_colleague");
    await expect(store.addMembers(group.id, ["carla"], "bruno")).rejects.toThrow("admin_required");
    await expect(store.removeMembers(group.id, ["ana"], "bruno")).rejects.toThrow("admin_required");
    await expect(store.renameGroup(group.id, "Outro", "bruno")).rejects.toThrow("admin_required");
  });

  it("allows promotion and demotion, keeps a last admin and serializes simultaneous demotions", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno", "carla"]);
    await expect(store.setGroupAdmin(group.id, "ana", false, "ana")).rejects.toThrow("last_admin");
    await store.setGroupAdmin(group.id, "bruno", true, "ana");
    await store.addMembers(group.id, ["daniel"], "bruno");
    const results = await Promise.allSettled([
      store.setGroupAdmin(group.id, "ana", false, "ana"),
      store.setGroupAdmin(group.id, "bruno", false, "bruno"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await store.conversationsOf("carla"))[0]?.admins).toHaveLength(1);
  });

  it("does not restore admin privileges when a removed participant rejoins", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno"]);
    await store.setGroupAdmin(group.id, "bruno", true, "ana");
    await store.removeMembers(group.id, ["bruno"], "ana");
    await store.addMembers(group.id, ["bruno"], "ana");
    expect((await store.conversationsOf("bruno"))[0]?.admins).toEqual(["ana"]);
  });
});

describe("deleting messages", () => {
  it("clears a conversation only for its caller and brings it back on the next message", async () => {
    const direct = await store.openDirect("ana", "bruno");
    await store.send({ conversationId: direct.id, authorId: "bruno", text: "Antiga" });
    await expect(store.deleteConversation(direct.id, "carla")).rejects.toThrow("not_a_participant");
    await store.deleteConversation(direct.id, "ana");
    expect(await store.conversationsOf("ana")).toEqual([]);
    expect(await store.messagesOf(direct.id, { userId: "ana" })).toEqual([]);
    expect(await store.messagesOf(direct.id, { userId: "bruno" })).toHaveLength(1);
    expect(await store.unreadFor("ana")).toBe(0);
    await store.send({ conversationId: direct.id, authorId: "bruno", text: "Nova" });
    expect(await store.conversationsOf("ana")).toHaveLength(1);
    expect((await store.messagesOf(direct.id, { userId: "ana" })).map((message) => message.text)).toEqual(["Nova"]);
    expect(await store.messagesOf(direct.id, { userId: "bruno" })).toHaveLength(2);
  });

  it("lets the creator exit and automatically gives the remaining people a human admin", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno", "carla"]);
    await store.leaveGroup(group.id, "ana");
    expect(await store.conversationsOf("ana")).toEqual([]);
    expect((await store.conversationsOf("bruno"))[0]?.admins).toHaveLength(1);
    expect((await store.conversationsOf("bruno"))[0]?.admins).not.toContain("ana");
    await expect(store.send({ conversationId: group.id, authorId: "ana", text: "Nao" })).rejects.toThrow(
      "not_a_participant",
    );
    await expect(store.messagesOf(group.id, { userId: "ana" })).rejects.toThrow("not_a_participant");
  });

  it("persists promotions and deletions across closing and reopening the database", async () => {
    const folder = mkdtempSync(join(tmpdir(), "chat-moderation-persistence-"));
    let disk = openStore(folder);
    try {
      const group = await disk.openGroup("Equipe", "ana", ["bruno"]);
      const message = await disk.send({ conversationId: group.id, authorId: "ana", text: "Original" });
      await disk.setGroupAdmin(group.id, "bruno", true, "ana");
      await disk.deleteMessage(message.id, "bruno");
      disk.close();
      disk = openStore(folder);
      expect((await disk.conversationsOf("bruno"))[0]?.admins).toEqual(expect.arrayContaining(["ana", "bruno"]));
      expect((await disk.messagesOf(group.id))[0]).toMatchObject({
        id: message.id,
        text: "",
        deletedBy: "bruno",
        deletedAt: expect.any(String),
      });
    } finally {
      disk.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("lets authors delete their own message, preserves its position and does not count it as unread", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno"]);
    const original = await store.send({ conversationId: group.id, authorId: "bruno", text: "Segredo" });
    const deleted = await store.deleteMessage(original.id, "bruno");
    expect(deleted).toMatchObject({
      id: original.id,
      seq: original.seq,
      text: "",
      attachments: [],
      deletedBy: "bruno",
    });
    expect(deleted.deletedAt).toBeTruthy();
    expect(await store.deleteMessage(original.id, "bruno")).toEqual(deleted);
    expect(await store.unreadFor("ana")).toBe(0);
  });

  it("lets group admins moderate while refusing members and outsiders", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno", "carla"]);
    const message = await store.send({ conversationId: group.id, authorId: "bruno", text: "Texto" });
    await expect(store.deleteMessage(message.id, "carla")).rejects.toThrow("cannot_delete_message");
    await expect(store.deleteMessage(message.id, "daniel")).rejects.toThrow("not_a_participant");
    await store.setGroupAdmin(group.id, "carla", true, "ana");
    expect((await store.deleteMessage(message.id, "carla")).deletedBy).toBe("carla");
  });

  it("does not grant moderation powers in a direct conversation", async () => {
    const direct = await store.openDirect("ana", "bruno");
    const message = await store.send({ conversationId: direct.id, authorId: "ana", text: "Texto" });
    await expect(store.deleteMessage(message.id, "bruno")).rejects.toThrow("cannot_delete_message");
  });

  it("removes attachment metadata and bytes from storage and exported data", async () => {
    const group = await store.openGroup("Equipe", "ana", ["bruno"]);
    const file = await store.media.create("nota.txt", "text/plain", 3);
    await store.media.write(file.id, 0, Buffer.from("abc").toString("base64"));
    const message = await store.send({
      conversationId: group.id,
      authorId: "bruno",
      text: "Arquivo",
      attachmentIds: [file.id],
    });
    await store.deleteMessage(message.id, "ana");
    const exported = await store.exportAll();
    expect(exported.attachments).toEqual([]);
    expect(exported.attachmentChunks).toEqual([]);
    expect(exported.messages[0]).toMatchObject({ text: "", attachments: [] });
    expect((await store.messagesOf(group.id))[0]?.deletedAt).toBeTruthy();
  });
});
