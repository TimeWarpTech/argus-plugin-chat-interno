import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBytes, MEDIA_CHUNK_BYTES } from "@creativepetabyte/argus-chat-media";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "./store.js";

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
function upload(bytes: Uint8Array, name = "foto.png", mimeType = "image/png") {
  const attachment = store.media.create(name, mimeType, bytes.length);
  for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
    store.media.write(attachment.id, offset, encodeBytes(bytes.subarray(offset, offset + MEDIA_CHUNK_BYTES)));
  }
  return attachment;
}

describe("uploading a file in pieces", () => {
  it("comes back byte for byte, across more than one chunk", () => {
    const bytes = fileOf(MEDIA_CHUNK_BYTES + 1234);
    const attachment = upload(bytes);
    const conversation = store.openDirect("ana", "bruno");
    const message = store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    const back = new Uint8Array(bytes.length);
    for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
      const chunk = store.media.readChunk(attachment.id, message.id, offset);
      back.set(Uint8Array.from(Buffer.from(chunk.data, "base64")), offset);
    }
    expect(back).toEqual(bytes);
  });

  it("refuses a chunk that arrives out of order, so a file cannot be silently holed", () => {
    const attachment = store.media.create("a.bin", "application/octet-stream", MEDIA_CHUNK_BYTES * 2);
    const second = encodeBytes(fileOf(MEDIA_CHUNK_BYTES));
    expect(() => store.media.write(attachment.id, MEDIA_CHUNK_BYTES, second)).toThrow(
      "invalid_upload_offset",
    );
  });

  it("takes the same chunk twice as one, because a retry must not corrupt an upload", () => {
    const attachment = store.media.create("a.bin", "application/octet-stream", 10);
    const data = encodeBytes(fileOf(10));
    store.media.write(attachment.id, 0, data);
    expect(() => store.media.write(attachment.id, 0, data)).not.toThrow();
  });

  it("refuses a name or a type that does not look like one", () => {
    expect(() => store.media.create("../escapar.png", "image/png", 10)).toThrow("invalid_attachment");
    expect(() => store.media.create("a.png", "nao-e-um-tipo", 10)).toThrow("invalid_attachment");
  });

  it("refuses a file larger than the limit", () => {
    expect(() => store.media.create("enorme.bin", "application/octet-stream", 11 * 1024 * 1024)).toThrow(
      "invalid_attachment",
    );
  });
});

describe("sending with an attachment", () => {
  it("refuses one that was never finished, so a message cannot point at half a file", () => {
    const attachment = store.media.create("meia.png", "image/png", MEDIA_CHUNK_BYTES * 2);
    const conversation = store.openDirect("ana", "bruno");

    expect(() =>
      store.send({
        conversationId: conversation.id,
        authorId: "ana",
        text: "",
        attachmentIds: [attachment.id],
      }),
    ).toThrow("attachment_not_ready");
  });

  it("allows an empty text when a file is attached, because the file is the message", () => {
    const attachment = upload(fileOf(64));
    const conversation = store.openDirect("ana", "bruno");

    const message = store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "",
      attachmentIds: [attachment.id],
    });

    expect(message.attachments.map((file) => file.name)).toEqual(["foto.png"]);
  });

  it("lists what came with each message when the conversation is read", () => {
    const attachment = upload(fileOf(64));
    const conversation = store.openDirect("ana", "bruno");
    store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    const [message] = store.messagesOf(conversation.id);
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0]?.mimeType).toBe("image/png");
  });

  it("cannot take a file somebody else's message already holds", () => {
    const attachment = upload(fileOf(64));
    const conversation = store.openDirect("ana", "bruno");
    store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "um",
      attachmentIds: [attachment.id],
    });

    expect(() =>
      store.send({
        conversationId: conversation.id,
        authorId: "ana",
        text: "dois",
        attachmentIds: [attachment.id],
      }),
    ).toThrow("attachment_not_ready");
  });
});

describe("reading a file back", () => {
  it("refuses a file that belongs to another message", () => {
    const attachment = upload(fileOf(64));
    const conversation = store.openDirect("ana", "bruno");
    const message = store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });
    const other = store.send({ conversationId: conversation.id, authorId: "bruno", text: "outra" });

    expect(() => store.media.readChunk(attachment.id, other.id, 0)).toThrow("attachment_not_found");
    expect(store.media.readChunk(attachment.id, message.id, 0).data).toBeTruthy();
  });
});

describe("leaving and being forgotten, with files", () => {
  it("exports the files and deletes them for good", () => {
    const attachment = upload(fileOf(64));
    const conversation = store.openDirect("ana", "bruno");
    store.send({
      conversationId: conversation.id,
      authorId: "ana",
      text: "olha",
      attachmentIds: [attachment.id],
    });

    expect((store.exportAll().attachments as unknown[]).length).toBe(1);

    store.deleteAll();
    expect((store.exportAll().attachments as unknown[]).length).toBe(0);
    expect((store.exportAll().attachmentChunks as unknown[]).length).toBe(0);
  });
});
