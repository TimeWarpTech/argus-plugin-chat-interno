import { MEDIA_CHUNK_BYTES, type MediaCall } from "@creativepetabyte/argus-chat-media";
import { describe, expect, it } from "vitest";
import { MAX_MEDIA_BYTES } from "../../shared/limits.js";
import { uploadAttachment } from "../../ui/src/upload";

describe("uploading larger attachments", () => {
  it("transfers a file above the old 10 MB limit in bounded chunks and reports completion", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    let received = 0;
    let progress = 0;
    const call: MediaCall = async (method, input) => {
      if (method === "CreateAttachment")
        return { id: "file-1", name: "arquivo.bin", mimeType: "application/octet-stream", size: bytes.length };
      if (method === "WriteAttachment") {
        expect(input.offset).toBe(received);
        const chunk = Buffer.from(input.data as string, "base64");
        expect(chunk.length).toBeLessThanOrEqual(MEDIA_CHUNK_BYTES);
        received += chunk.length;
      }
      return {};
    };
    const file = await uploadAttachment(
      call,
      { name: "arquivo.bin", mimeType: "application/octet-stream", bytes },
      (percent) => {
        progress = percent;
      },
    );
    expect(file.size).toBe(bytes.length);
    expect(received).toBe(bytes.length);
    expect(progress).toBe(100);
  });
  it("rejects oversize files and cancels a pending upload on a contract refusal", async () => {
    let reserved = false;
    let deleted = false;
    const call: MediaCall = async (method) => {
      if (method === "CreateAttachment") {
        reserved = true;
        return { id: "f", name: "f", mimeType: "text/plain", size: 1 };
      }
      if (method === "WriteAttachment") return { error: "upload_conflict" };
      if (method === "DeleteAttachment") deleted = true;
      return {};
    };
    await expect(
      uploadAttachment(call, { name: "f", mimeType: "text/plain", bytes: new Uint8Array(MAX_MEDIA_BYTES + 1) }),
    ).rejects.toThrow("media_size_limit");
    expect(reserved).toBe(false);
    await expect(
      uploadAttachment(call, { name: "f", mimeType: "text/plain", bytes: new Uint8Array(1) }),
    ).rejects.toThrow("upload_conflict");
    expect(deleted).toBe(true);
  });
});
