/**
 * This plugin's own storage: a SQLite file of its own, in the folder the runtime gave this company.
 *
 * Not `ctx.store`, deliberately. A chat is listed, paginated and counted — a key-value bucket would
 * mean reading every conversation to draw one screen, and recomputing unread counts from the whole
 * history on every open. `ctx.store` is for a handful of keys; this is not that.
 */
import type { Attachment } from "@creativepetabyte/argus-chat-media";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MediaStore } from "./media-store.js";

export type Kind = "direct" | "group";

export interface Conversation {
  id: string;
  kind: Kind;
  /** A group's name. A direct conversation is named by whoever is on the other side. */
  name: string | undefined;
  createdBy: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  at: string;
  /** What orders messages. Never the timestamp: two in the same millisecond would be a coin toss. */
  seq: number;
  /** The files this message carries. Metadata only -- the bytes are fetched piece by piece. */
  attachments: Attachment[];
}

export interface ConversationView extends Conversation {
  participants: string[];
  lastMessage: Message | undefined;
  unread: number;
}

export interface Store {
  openDirect(a: string, b: string): Conversation;
  openGroup(name: string, createdBy: string, members: readonly string[]): Conversation;
  conversationsOf(userId: string): ConversationView[];
  participantsOf(conversationId: string): string[];
  /** Which conversation a message belongs to, which is what decides who may read its files. */
  conversationOfMessage(messageId: string): string | undefined;
  send(input: {
    conversationId: string;
    authorId: string;
    text: string;
    messageId?: string;
    attachmentIds?: readonly string[];
  }): Message;
  messagesOf(conversationId: string, options?: { before?: number; limit?: number }): Message[];
  markRead(conversationId: string, userId: string, through: number): void;
  unreadFor(userId: string): number;
  exportAll(): {
    conversations: Conversation[];
    participants: unknown[];
    messages: Message[];
    attachments: unknown[];
    attachmentChunks: unknown[];
  };
  deleteAll(): void;
  close(): void;
  /** The files, kept beside the messages that own them. */
  readonly media: MediaStore;
}

/** The longest a message may be. Long enough for a paragraph, short enough to bound a row. */
export const MAX_TEXT = 4000;

/**
 * What makes a direct conversation unique, whichever way round the two names arrive.
 *
 * Sorted on purpose: `openDirect("ana","bruno")` and `openDirect("bruno","ana")` are the same
 * conversation, and without this the second call opens a second one — two histories for one pair,
 * each person writing into a thread the other never sees.
 */
const pairKeyOf = (a: string, b: string): string => [a, b].sort().join("\u0000");

/**
 * A row as SQLite hands it over: a loose record of values.
 *
 * Read field by field rather than asserted into a shape. The schema below is the only writer, so a
 * row that does not match means the file was tampered with or migrated by something else — and
 * then `corrupt_row` is the honest answer, not a half-built object flowing on.
 */
type Row = Record<string, unknown>;

const text = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error("corrupt_row");
  return value;
};

const count = (row: Row | undefined, key: string): number => {
  const value = row?.[key];
  return typeof value === "number" ? value : 0;
};

/** A row that must be there: it was just inserted, so its absence is the file lying. */
const must = (row: Row | undefined): Row => {
  if (row === undefined) throw new Error("corrupt_row");
  return row;
};

const conversationOf = (row: Row): Conversation => {
  const name = row.name;
  return {
    id: text(row, "id"),
    kind: row.kind === "group" ? "group" : "direct",
    name: typeof name === "string" ? name : undefined,
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
  };
};

const messageOf = (row: Row, attachments: Attachment[] = []): Message => {
  const seq = row.seq;
  if (typeof seq !== "number") throw new Error("corrupt_row");
  return {
    id: text(row, "id"),
    conversationId: text(row, "conversation_id"),
    authorId: text(row, "author_id"),
    text: text(row, "text"),
    at: text(row, "at"),
    seq,
    attachments,
  };
};

/**
 * Opens this company's store.
 *
 * `undefined` is not an oversight: the runtime hands a folder only when the process was given one,
 * and inventing a path would promise a durability it does not have. With nowhere to write, the chat
 * runs in memory -- usable, and lost on restart. The caller says so out loud.
 */
export function openStore(folder: string | undefined): Store {
  const db = new DatabaseSync(folder === undefined ? ":memory:" : join(folder, "chat-interno.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      name        TEXT,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      pair_key    TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS participants (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL,
      read_through    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      seq             INTEGER PRIMARY KEY AUTOINCREMENT,
      id              TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      author_id       TEXT NOT NULL,
      text            TEXT NOT NULL,
      at              TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, seq);
    CREATE INDEX IF NOT EXISTS participants_by_user ON participants (user_id);
  `);

  const insertConversation = db.prepare(
    "INSERT INTO conversations (id, kind, name, created_by, created_at, pair_key) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertParticipant = db.prepare(
    "INSERT OR IGNORE INTO participants (conversation_id, user_id) VALUES (?, ?)",
  );
  const byPair = db.prepare("SELECT * FROM conversations WHERE pair_key = ?");
  const byId = db.prepare("SELECT * FROM conversations WHERE id = ?");
  const participantRows = db.prepare("SELECT user_id FROM participants WHERE conversation_id = ?");
  const isParticipant = db.prepare(
    "SELECT 1 AS yes FROM participants WHERE conversation_id = ? AND user_id = ?",
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, conversation_id, author_id, text, at) VALUES (?, ?, ?, ?, ?)",
  );
  const messageById = db.prepare("SELECT * FROM messages WHERE id = ?");
  const lastMessage = db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1",
  );
  const unreadInConversation = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    JOIN participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.conversation_id = ? AND m.seq > p.read_through AND m.author_id <> ?
  `);
  const unreadEverywhere = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    JOIN participants p ON p.conversation_id = m.conversation_id
    WHERE p.user_id = ? AND m.seq > p.read_through AND m.author_id <> ?
  `);
  const mine = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN participants p ON p.conversation_id = c.id
    WHERE p.user_id = ?
  `);
  const pageFromTop = db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?",
  );
  const pageBefore = db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
  );
  const readThrough = db.prepare(
    "UPDATE participants SET read_through = MAX(read_through, ?) WHERE conversation_id = ? AND user_id = ?",
  );

  const media = new MediaStore(db);

  /** A message with whatever it carries. */
  const withFiles = (row: Row): Message => {
    const message = messageOf(row);
    return { ...message, attachments: media.attachmentsOf(message.id) };
  };

  const participantsIn = (conversationId: string): string[] =>
    participantRows.all(conversationId).map((row) => text(row, "user_id"));

  const unreadOf = (conversationId: string, userId: string): number => {
    return count(unreadInConversation.get(userId, conversationId, userId), "n");
  };

  const viewOf = (row: Row, userId: string): ConversationView => {
    const conversation = conversationOf(row);
    const last = lastMessage.get(conversation.id);
    return {
      ...conversation,
      participants: participantsIn(conversation.id),
      lastMessage: last === undefined ? undefined : withFiles(last),
      unread: unreadOf(conversation.id, userId),
    };
  };

  return {
    openDirect(a, b) {
      if (a === b) throw new Error("not_two_people");
      const key = pairKeyOf(a, b);
      const existing = byPair.get(key);
      if (existing !== undefined) return conversationOf(existing);
      const id = randomUUID();
      insertConversation.run(id, "direct", null, a, new Date().toISOString(), key);
      insertParticipant.run(id, a);
      insertParticipant.run(id, b);
      return conversationOf(must(byId.get(id)));
    },

    openGroup(name, createdBy, members) {
      const trimmed = name.trim();
      if (trimmed === "") throw new Error("empty_name");
      const id = randomUUID();
      // `pair_key` stays NULL: a group is never deduplicated. Two groups may share a name and a
      // membership and still be two different rooms, because somebody meant to open a second one.
      insertConversation.run(id, "group", trimmed, createdBy, new Date().toISOString(), null);
      insertParticipant.run(id, createdBy);
      for (const member of members) insertParticipant.run(id, member);
      return conversationOf(must(byId.get(id)));
    },

    conversationsOf(userId) {
      return (mine.all(userId))
        .map((row) => viewOf(row, userId))
        .sort((a, b) => (b.lastMessage?.seq ?? 0) - (a.lastMessage?.seq ?? 0));
    },

    participantsOf(conversationId) {
      return participantsIn(conversationId);
    },

    conversationOfMessage(messageId) {
      const row = db.prepare("SELECT conversation_id FROM messages WHERE id = ?").get(messageId);
      return row === undefined ? undefined : text(row, "conversation_id");
    },

    send({ conversationId, authorId, text, messageId, attachmentIds = [] }) {
      const body = text.trim();
      // A file IS the message when there are no words, which is how anybody sends a photo.
      if (body === "" && attachmentIds.length === 0) throw new Error("empty_message");
      if (body.length > MAX_TEXT) throw new Error("message_too_long");
      if (isParticipant.get(conversationId, authorId) === undefined) throw new Error("not_a_participant");
      // The id may be given so that the same send arriving twice is one message: a retry upstream
      // must not become two lines in somebody's conversation.
      const id = messageId ?? randomUUID();
      const already = messageById.get(id);
      if (already !== undefined) return withFiles(already);
      // Checked BEFORE the message exists, so a half-uploaded file cannot leave a message pointing
      // at nothing. `ready` refuses anything unfinished or already owned, by name.
      media.ready(attachmentIds);
      insertMessage.run(id, conversationId, authorId, body, new Date().toISOString());
      media.bind(attachmentIds, id);
      return withFiles(must(messageById.get(id)));
    },

    messagesOf(conversationId, options) {
      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
      const before = options?.before;
      const rows =
        before === undefined
          ? (pageFromTop.all(conversationId, limit))
          : (pageBefore.all(conversationId, before, limit));
      // Read newest-first so the limit takes the newest page, then handed back oldest-first, which
      // is the order a conversation is read in.
      return rows.map(withFiles).reverse();
    },

    markRead(conversationId, userId, through) {
      // `MAX` so that reading an older message never un-reads a newer one: with two tabs open, the
      // one showing yesterday would otherwise push the badge back up.
      readThrough.run(through, conversationId, userId);
    },

    unreadFor(userId) {
      return count(unreadEverywhere.get(userId, userId), "n");
    },

    exportAll() {
      return {
        conversations: db.prepare("SELECT * FROM conversations").all().map(conversationOf),
        participants: db.prepare("SELECT * FROM participants").all(),
        messages: db.prepare("SELECT * FROM messages ORDER BY seq").all().map(withFiles),
        ...media.export(),
      };
    },

    deleteAll() {
      // The files first: they are what a company would most mind leaving behind.
      media.clear();
      db.exec("DELETE FROM messages; DELETE FROM participants; DELETE FROM conversations;");
    },

    close() {
      db.close();
    },

    media,
  };
}
