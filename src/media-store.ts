/**
 * Files, kept in the same database as the messages that own them.
 *
 * No upload endpoint and no public URL: the bytes travel in 48 KiB pieces over the same
 * authenticated contract call the screen already uses — the shape
 * `@creativepetabyte/argus-chat-media` defines and `chat-tickets` already ships. The chunk size and
 * the ceiling come from there rather than being chosen again here, because two sides that disagree
 * about a chunk boundary corrupt a file without anybody noticing.
 *
 * A file lives in two states. **Pending**: uploaded, owned by nobody, collectable. **Bound**: named
 * by a message, readable by whoever may read that message. Nothing is readable while pending, so a
 * half-uploaded file is never shown, and an upload somebody abandoned is swept after a day.
 */
import { type Attachment, MAX_MEDIA_BYTES, MEDIA_CHUNK_BYTES } from "@creativepetabyte/argus-chat-media";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { attachmentChunks, attachments } from "./schema.js";

/** How long an unclaimed upload survives before it is swept. */
const PENDING_MS = 24 * 60 * 60 * 1000;

/** How much unclaimed upload one company may hold at once, so an abandoned tab cannot fill a disk. */
const PENDING_QUOTA = 50 * 1024 * 1024;

const NAME_MAX = 200;
const MIME_MAX = 150;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-zA-Z0-9= .+-]+)?$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type Row = typeof attachments.$inferSelect;

const attachmentOf = (row: Row): Attachment => ({
  id: row.id,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
});

export class MediaStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  /** Reserves a file. Nothing is readable until every byte arrived and a message claimed it. */
  create(name: string, mimeType: string, size: number): Promise<Attachment> {
    return this.database.write(async () => {
      await this.sweep();
      const trimmed = name.trim();
      if (
        trimmed === "" ||
        trimmed.length > NAME_MAX ||
        // A name is shown, and saved to disk by whoever downloads it, so it carries no path and no
        // control characters.
        /[\\/]/.test(trimmed) ||
        Array.from(trimmed).some((character) => character.charCodeAt(0) < 32) ||
        mimeType.length > MIME_MAX ||
        !MIME.test(mimeType) ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > MAX_MEDIA_BYTES
      )
        throw new Error("invalid_attachment");

      const [pending] = await this.db
        .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)` })
        .from(attachments)
        .where(isNull(attachments.messageId));
      if ((pending?.total ?? 0) + size > PENDING_QUOTA) throw new Error("upload_quota_exceeded");

      const file = { id: crypto.randomUUID(), name: trimmed, mimeType, size };
      await this.db.insert(attachments).values({ ...file, createdAt: new Date().toISOString() });
      return file;
    });
  }

  /** Takes one piece, in order. The same piece twice is one piece: a retry must not corrupt a file. */
  write(id: string, offset: number, data: string): Promise<{ ok: true }> {
    return this.database.write(async () => {
      const [file] = await this.db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), isNull(attachments.messageId)));
      if (file === undefined) throw new Error("attachment_not_found");

      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset % MEDIA_CHUNK_BYTES !== 0 ||
        data.length > (MEDIA_CHUNK_BYTES * 4) / 3 ||
        !BASE64.test(data)
      )
        throw new Error("invalid_media_chunk");

      const bytes = Buffer.from(data, "base64");
      if (bytes.length !== Math.min(MEDIA_CHUNK_BYTES, file.size - offset) || bytes.length === 0)
        throw new Error("invalid_media_chunk");

      const [already] = await this.db
        .select({ data: attachmentChunks.data })
        .from(attachmentChunks)
        .where(and(eq(attachmentChunks.attachmentId, id), eq(attachmentChunks.offset, offset)));
      if (already !== undefined) {
        if (already.data !== data) throw new Error("upload_conflict");
        return { ok: true } as const;
      }
      // Strictly in order, so a gap cannot exist: `received` is both the progress and the next offset.
      if (offset !== file.received) throw new Error("invalid_upload_offset");

      await this.db.insert(attachmentChunks).values({ attachmentId: id, offset, data });
      await this.db
        .update(attachments)
        .set({ received: sql`${attachments.received} + ${bytes.length}` })
        .where(eq(attachments.id, id));
      return { ok: true } as const;
    });
  }

  /** The files that are whole and still unclaimed, refusing the rest by name. */
  async ready(ids: readonly string[]): Promise<Attachment[]> {
    const found: Attachment[] = [];
    for (const id of ids) {
      const [row] = await this.db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, id),
            isNull(attachments.messageId),
            eq(attachments.received, attachments.size),
          ),
        );
      if (row === undefined) throw new Error("attachment_not_ready");
      found.push(attachmentOf(row));
    }
    return found;
  }

  /** Hands the files to the message that now owns them. */
  async bind(ids: readonly string[], messageId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(attachments)
      .set({ messageId })
      .where(and(inArray(attachments.id, [...ids]), isNull(attachments.messageId)));
  }

  async attachmentsOf(messageId: string): Promise<Attachment[]> {
    const rows = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, messageId))
      .orderBy(attachments.name);
    return rows.map(attachmentOf);
  }

  /**
   * One piece of a file, named by the message that owns it.
   *
   * The message id is part of the question on purpose: it is what ties a file to a conversation, and
   * the caller checks that the reader is in that conversation before asking. An id on its own would
   * make every file in the company readable by anybody who guessed one.
   */
  async readChunk(attachmentId: string, messageId: string, offset: number): Promise<{ data: string }> {
    if (!Number.isInteger(offset) || offset < 0 || offset % MEDIA_CHUNK_BYTES !== 0)
      throw new Error("invalid_request");
    const [row] = await this.db
      .select({ data: attachmentChunks.data })
      .from(attachmentChunks)
      .innerJoin(attachments, eq(attachments.id, attachmentChunks.attachmentId))
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.messageId, messageId),
          eq(attachmentChunks.offset, offset),
        ),
      );
    if (row === undefined) throw new Error("attachment_not_found");
    return { data: row.data };
  }

  /** Drops an upload nobody claimed. A file a message owns is deleted with the conversation. */
  remove(id: string): Promise<{ ok: true }> {
    return this.database.write(async () => {
      const [pending] = await this.db
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.id, id), isNull(attachments.messageId)));
      if (pending !== undefined) {
        await this.db.delete(attachmentChunks).where(eq(attachmentChunks.attachmentId, id));
        await this.db.delete(attachments).where(eq(attachments.id, id));
      }
      return { ok: true } as const;
    });
  }

  async export(): Promise<{ attachments: unknown[]; attachmentChunks: unknown[] }> {
    return {
      attachments: await this.db.select().from(attachments),
      attachmentChunks: await this.db.select().from(attachmentChunks),
    };
  }

  async clear(): Promise<void> {
    await this.db.delete(attachmentChunks);
    await this.db.delete(attachments);
  }

  /** Sweeps uploads nobody ever claimed, so an abandoned tab does not keep a file for ever. */
  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - PENDING_MS).toISOString();
    const stale = await this.db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(isNull(attachments.messageId), lt(attachments.createdAt, cutoff)));
    if (stale.length === 0) return;
    const ids = stale.map((row) => row.id);
    await this.db.delete(attachmentChunks).where(inArray(attachmentChunks.attachmentId, ids));
    await this.db.delete(attachments).where(inArray(attachments.id, ids));
  }
}
