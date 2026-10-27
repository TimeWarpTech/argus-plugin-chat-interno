import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBytes, MEDIA_CHUNK_BYTES } from "@creativepetabyte/argus-chat-media";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../src/store.js";

let folder: string;
let store: Store;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "chat-media-"));
  store = openStore(folder);
});

afterEach(() => {
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

/** A file of `size` bytes whose content is predictable, so a round trip can be checked byte by byte. */
const fileOf = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, index) => (index * 7) % 256);

/** Uploads a whole file the way the screen does: create, then one chunk at a time. */
async function upload(bytes: Uint8Array, name = "foto.png", mimeType = "image/png") {
  const attachment = await store.media.create(name, mimeType, bytes.length);
  for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
    await store.media.write(
      attachment.id,
      offset,
      encodeBytes(bytes.subarray(offset, offset + MEDIA_CHUNK_BYTES)),
    );
  }
  return attachment;
}

describe("uploading a file in pieces", () => {
  it("comes back byte for byte, across more than one chunk", async () => {
    const bytes = fileOf(MEDIA_CHUNK_BYTES + 1234);
    const attachment = await upload(bytes);
    const conversation = await store.openDirect("ana", "bruno");
    const message = await await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    const back = new Uint8Array(bytes.length);
    for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
      const chunk = await store.media.readChunk(attachment.id, message.id, offset);
      back.set(Uint8Array.from(Buffer.from(chunk.data, "base64")), offset);
    }
    expect(back).toEqual(bytes);
  });

  it("refuses a chunk that arrives out of order, so a file cannot be silently holed", async () => {
    const attachment = await store.media.create("a.bin", "application/octet-stream", MEDIA_CHUNK_BYTES * 2);
    const second = encodeBytes(fileOf(MEDIA_CHUNK_BYTES));
    await expect(store.media.write(attachment.id, MEDIA_CHUNK_BYTES, second)).rejects.toThrow(
      "invalid_upload_offset",
    );
  });

  it("takes the same chunk twice as one, because a retry must not corrupt an upload", async () => {
    const attachment = await store.media.create("a.bin", "application/octet-stream", 10);
    const data = encodeBytes(fileOf(10));
    await store.media.write(attachment.id, 0, data);
    await expect(store.media.write(attachment.id, 0, data)).resolves.toEqual({ ok: true });
  });

  it("refuses a name or a type that does not look like one", async () => {
    await expect(store.media.create("../escapar.png", "image/png", 10)).rejects.toThrow(
      "invalid_attachment",
    );
    await expect(store.media.create("a.png", "nao-e-um-tipo", 10)).rejects.toThrow("invalid_attachment");
  });

  it("refuses a file larger than the limit", async () => {
    await expect(
      store.media.create("enorme.bin", "application/octet-stream", 11 * 1024 * 1024),
    ).rejects.toThrow("invalid_attachment");
  });
});

describe("sending with an attachment", () => {
  it("refuses one that was never finished, so a message cannot point at half a file", async () => {
    const attachment = await store.media.create("meia.png", "image/png", MEDIA_CHUNK_BYTES * 2);
    const conversation = await store.openDirect("ana", "bruno");

    await expect(
      store.send({
        conversationId: conversation.id,
        authorId: "ana",
        text: "",
        attachmentIds: [attachment.id],
      }),
    ).rejects.toThrow("attachment_not_ready");
  });

  it("allows an empty text when a file is attached, because the file is the message", async () => {
    const attachment = await upload(fileOf(64));
    const conversation = await store.openDirect("ana", "bruno");

    const message = await await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "",
      attachmentIds: [attachment.id],
    });

    expect(message.attachments.map((file) => file.name)).toEqual(["foto.png"]);
  });

  it("lists what came with each message when the conversation is read", async () => {
    const attachment = await upload(fileOf(64));
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    const [message] = await store.messagesOf(conversation.id);
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0]?.mimeType).toBe("image/png");
  });

  it("cannot take a file somebody else's message already holds", async () => {
    const attachment = await upload(fileOf(64));
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "um",
      attachmentIds: [attachment.id],
    });

    await expect(
      store.send({
        conversationId: conversation.id,
        authorId: "ana",
        text: "dois",
        attachmentIds: [attachment.id],
      }),
    ).rejects.toThrow("attachment_not_ready");
  });
});

describe("reading a file back", () => {
  it("refuses a file that belongs to another message", async () => {
    const attachment = await upload(fileOf(64));
    const conversation = await store.openDirect("ana", "bruno");
    const message = await await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });
    const other = await store.send({ conversationId: conversation.id, authorId: "bruno", text: "outra" });

    await expect(store.media.readChunk(attachment.id, other.id, 0)).rejects.toThrow(
      "attachment_not_found",
    );
    expect((await store.media.readChunk(attachment.id, message.id, 0)).data).toBeTruthy();
  });
});

describe("leaving and being forgotten, with files", () => {
  it("exports the files and deletes them for good", async () => {
    const attachment = await upload(fileOf(64));
    const conversation = await store.openDirect("ana", "bruno");
    await store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    expect(((await store.exportAll()).attachments as unknown[]).length).toBe(1);

    await store.deleteAll();
    expect(((await store.exportAll()).attachments as unknown[]).length).toBe(0);
    expect(((await store.exportAll()).attachmentChunks as unknown[]).length).toBe(0);
  });
});
