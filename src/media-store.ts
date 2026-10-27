/**
 * Files, kept in the same database as the messages that own them.
 *
 * No public URL and no second port: a file travels in pieces over the contract call the screen
 * already uses, which is authenticated and bound to one company by the kernel. That is the shape
 * `@creativepetabyte/argus-chat-media` defines and `chat-tickets` already ships — the chunk size,
 * the ceiling and the base64 framing come from there rather than being chosen again here, because
 * two sides that disagree about a chunk boundary corrupt a file without anybody noticing.
 *
 * A file lives in two states. **Pending**: uploaded, owned by nobody, collectable. **Bound**: named
 * by a message, readable by whoever may read that message. Nothing is readable while pending, so a
 * half-uploaded file is never shown, and an upload somebody abandoned is swept after a day.
 */
import { type Attachment, MAX_MEDIA_BYTES, MEDIA_CHUNK_BYTES } from "@creativepetabyte/argus-chat-media";
import type { DatabaseSync } from "node:sqlite";

/** How long an unclaimed upload survives before it is swept. */
const PENDING_MS = 24 * 60 * 60 * 1000;

/** How much unclaimed upload one company may hold at once, so an abandoned tab cannot fill a disk. */
const PENDING_QUOTA = 50 * 1024 * 1024;

const NAME_MAX = 200;
const MIME_MAX = 150;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-zA-Z0-9= .+-]+)?$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type Row = Record<string, unknown>;

const numberAt = (row: Row | undefined, key: string): number => {
  const value = row?.[key];
  return typeof value === "number" ? value : 0;
};

const textAt = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("corrupt_row");
  return value;
};

const attachmentOf = (row: Row): Attachment => ({
  id: textAt(row, "id"),
  name: textAt(row, "name"),
  mimeType: textAt(row, "mime_type"),
  size: numberAt(row, "size"),
});

export class MediaStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        mime_type  TEXT NOT NULL,
        size       INTEGER NOT NULL,
        received   INTEGER NOT NULL DEFAULT 0,
        message_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachment_chunks (
        attachment_id TEXT NOT NULL,
        offset        INTEGER NOT NULL,
        data          TEXT NOT NULL,
        PRIMARY KEY (attachment_id, offset)
      );
      CREATE INDEX IF NOT EXISTS attachments_by_message ON attachments (message_id);
      CREATE INDEX IF NOT EXISTS attachments_pending ON attachments (message_id, created_at);
    `);
  }

  /** Reserves a file. Nothing is readable until every byte arrived and a message claimed it. */
  create(name: string, mimeType: string, size: number): Attachment {
    return this.inTransaction(() => {
      this.sweep();
      const trimmed = name.trim();
      if (
        trimmed === "" ||
        trimmed.length > NAME_MAX ||
        // A name is shown and may be saved to disk by whoever downloads it, so it carries no path
        // and no control characters.
        /[\\/]/.test(trimmed) ||
        Array.from(trimmed).some((character) => character.charCodeAt(0) < 32) ||
        mimeType.length > MIME_MAX ||
        !MIME.test(mimeType) ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > MAX_MEDIA_BYTES
      )
        throw new Error("invalid_attachment");

      const pending = numberAt(
        this.db
          .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM attachments WHERE message_id IS NULL")
          .get() as Row | undefined,
        "total",
      );
      if (pending + size > PENDING_QUOTA) throw new Error("upload_quota_exceeded");

      const file: Attachment = { id: crypto.randomUUID(), name: trimmed, mimeType, size };
      this.db
        .prepare("INSERT INTO attachments (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(file.id, file.name, file.mimeType, file.size, new Date().toISOString());
      return file;
    });
  }

  /** Takes one piece, in order. The same piece twice is one piece: a retry must not corrupt a file. */
  write(id: string, offset: number, data: string): { ok: true } {
    return this.inTransaction(() => {
      const file = this.db
        .prepare("SELECT size, received FROM attachments WHERE id = ? AND message_id IS NULL")
        .get(id) as Row | undefined;
      if (file === undefined) throw new Error("attachment_not_found");

      const size = numberAt(file, "size");
      const expected = Math.min(MEDIA_CHUNK_BYTES, size - offset);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset % MEDIA_CHUNK_BYTES !== 0 ||
        data.length > (MEDIA_CHUNK_BYTES * 4) / 3 ||
        !BASE64.test(data)
      )
        throw new Error("invalid_media_chunk");

      const bytes = Buffer.from(data, "base64");
      if (bytes.length !== expected || bytes.length === 0) throw new Error("invalid_media_chunk");

      const already = this.db
        .prepare("SELECT data FROM attachment_chunks WHERE attachment_id = ? AND offset = ?")
        .get(id, offset) as Row | undefined;
      if (already !== undefined) {
        if (textAt(already, "data") !== data) throw new Error("upload_conflict");
        return { ok: true } as const;
      }
      // Strictly in order, so a gap cannot exist: `received` is both the progress and the next offset.
      if (offset !== numberAt(file, "received")) throw new Error("invalid_upload_offset");

      this.db.prepare("INSERT INTO attachment_chunks VALUES (?, ?, ?)").run(id, offset, data);
      this.db.prepare("UPDATE attachments SET received = received + ? WHERE id = ?").run(bytes.length, id);
      return { ok: true } as const;
    });
  }

  /** The files that are whole and still unclaimed, refusing the rest by name. */
  ready(ids: readonly string[]): Attachment[] {
    return ids.map((id) => {
      const row = this.db
        .prepare("SELECT * FROM attachments WHERE id = ? AND message_id IS NULL AND received = size")
        .get(id) as Row | undefined;
      if (row === undefined) throw new Error("attachment_not_ready");
      return attachmentOf(row);
    });
  }

  /** Hands the files to the message that now owns them. */
  bind(ids: readonly string[], messageId: string): void {
    const claim = this.db.prepare(
      "UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL",
    );
    for (const id of ids) claim.run(messageId, id);
  }

  attachmentsOf(messageId: string): Attachment[] {
    return (
      this.db.prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY name").all(messageId) as Row[]
    ).map(attachmentOf);
  }

  /**
   * One piece of a file, named by the message that owns it.
   *
   * The message id is part of the question on purpose: it is what ties a file to a conversation, and
   * the caller checks that the reader is in that conversation before asking. An id on its own would
   * make every file in the company readable by anybody who guessed one.
   */
  readChunk(attachmentId: string, messageId: string, offset: number): { data: string } {
    if (!Number.isInteger(offset) || offset < 0 || offset % MEDIA_CHUNK_BYTES !== 0)
      throw new Error("invalid_request");
    const row = this.db
      .prepare(`
        SELECT c.data FROM attachment_chunks c
        JOIN attachments a ON a.id = c.attachment_id
        WHERE a.id = ? AND a.message_id = ? AND c.offset = ?
      `)
      .get(attachmentId, messageId, offset) as Row | undefined;
    if (row === undefined) throw new Error("attachment_not_found");
    return { data: textAt(row, "data") };
  }

  /** Drops an upload nobody claimed. A file a message owns is deleted with the conversation. */
  remove(id: string): { ok: true } {
    return this.inTransaction(() => {
      this.db
        .prepare(
          "DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE id = ? AND message_id IS NULL)",
        )
        .run(id);
      this.db.prepare("DELETE FROM attachments WHERE id = ? AND message_id IS NULL").run(id);
      return { ok: true } as const;
    });
  }

  export(): { attachments: unknown[]; attachmentChunks: unknown[] } {
    return {
      attachments: this.db.prepare("SELECT * FROM attachments").all(),
      attachmentChunks: this.db.prepare("SELECT * FROM attachment_chunks").all(),
    };
  }

  clear(): void {
    this.db.exec("DELETE FROM attachment_chunks; DELETE FROM attachments;");
  }

  /** Sweeps uploads nobody ever claimed, so an abandoned tab does not keep a file for ever. */
  private sweep(): void {
    const cutoff = new Date(Date.now() - PENDING_MS).toISOString();
    this.db
      .prepare(
        "DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?)",
      )
      .run(cutoff);
    this.db.prepare("DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?").run(cutoff);
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const answer = work();
      this.db.exec("COMMIT");
      return answer;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
