import { type Attachment, encodeBytes, MEDIA_CHUNK_BYTES, type MediaCall } from "@creativepetabyte/argus-chat-media";
import { MAX_MEDIA_BYTES } from "../../shared/limits.js";
import { refusalIn } from "./model";

/** Same media contract and chunk encoding, with this plugin's configurable file ceiling. */
export async function uploadAttachment(
  call: MediaCall,
  file: { name: string; mimeType: string; bytes: Uint8Array },
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Attachment> {
  signal?.throwIfAborted();
  if (file.bytes.length === 0 || file.bytes.length > MAX_MEDIA_BYTES) throw new Error("media_size_limit");
  const answer = await call("CreateAttachment", {
    name: file.name,
    mimeType: file.mimeType || "application/octet-stream",
    size: file.bytes.length,
  });
  const refused = refusalIn(answer);
  if (refused) throw new Error(refused);
  const attachment = answer as Attachment | undefined;
  if (
    !attachment ||
    typeof attachment.id !== "string" ||
    !attachment.id ||
    typeof attachment.name !== "string" ||
    typeof attachment.mimeType !== "string" ||
    attachment.size !== file.bytes.length
  )
    throw new Error("invalid_attachment");
  let reported = -1;
  try {
    for (let offset = 0; offset < file.bytes.length; offset += MEDIA_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const end = Math.min(offset + MEDIA_CHUNK_BYTES, file.bytes.length);
      const result = await call("WriteAttachment", {
        attachmentId: attachment.id,
        offset,
        data: encodeBytes(file.bytes.subarray(offset, end)),
      });
      const error = refusalIn(result);
      if (error) throw new Error(error);
      const percent = Math.floor((end * 100) / file.bytes.length);
      if (percent !== reported) {
        reported = percent;
        onProgress?.(percent);
      }
    }
    signal?.throwIfAborted();
    return attachment;
  } catch (error) {
    await call("DeleteAttachment", { attachmentId: attachment.id }).catch(() => {});
    throw error;
  }
}
