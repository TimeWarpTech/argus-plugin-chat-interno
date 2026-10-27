/**
 * This plugin's own storage: a SQLite file of its own, in the folder the runtime gave this company.
 *
 * Not `ctx.store`, deliberately. A chat is listed, paginated and counted — a key-value bucket would
 * mean reading every conversation to draw one screen, and recomputing unread counts from the whole
 * history on every open. `ctx.store` is for a handful of keys; this is not that.
 *
 * Everything here is asynchronous because Drizzle reaches `node:sqlite` through a proxy (see
 * `db.ts`), and every write goes through `database.write`, which serialises them per company.
 */
import type { Attachment } from "@creativepetabyte/argus-chat-media";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { type Database, openDatabase } from "./db.js";
import { MediaStore } from "./media-store.js";
import { conversations, messages, participants } from "./schema.js";

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
  /** The files this message carries. Metadata only — the bytes are fetched piece by piece. */
  attachments: Attachment[];
}

export interface ConversationView extends Conversation {
  participants: string[];
  lastMessage: Message | undefined;
  unread: number;
}

export interface Store {
  openDirect(a: string, b: string): Promise<Conversation>;
  openGroup(name: string, createdBy: string, members: readonly string[]): Promise<Conversation>;
  conversationsOf(userId: string): Promise<ConversationView[]>;
  participantsOf(conversationId: string): Promise<string[]>;
  /** Which conversation a message belongs to, which is what decides who may read its files. */
  conversationOfMessage(messageId: string): Promise<string | undefined>;
  send(input: {
    conversationId: string;
    authorId: string;
    text: string;
    messageId?: string;
    attachmentIds?: readonly string[];
  }): Promise<Message>;
  messagesOf(conversationId: string, options?: { before?: number; limit?: number }): Promise<Message[]>;
  markRead(conversationId: string, userId: string, through: number): Promise<void>;
  unreadFor(userId: string): Promise<number>;
  exportAll(): Promise<{
    conversations: Conversation[];
    participants: unknown[];
    messages: Message[];
    attachments: unknown[];
    attachmentChunks: unknown[];
  }>;
  deleteAll(): Promise<void>;
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

const conversationOf = (row: typeof conversations.$inferSelect): Conversation => ({
  id: row.id,
  kind: row.kind,
  name: row.name ?? undefined,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

export function openStore(folder: string | undefined): Store {
  const database = openDatabase(folder);
  const { db } = database;
  const media = new MediaStore(database);

  const participantsIn = async (conversationId: string): Promise<string[]> => {
    const rows = await db
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.conversationId, conversationId));
    return rows.map((row) => row.userId);
  };

  const isParticipant = async (conversationId: string, userId: string): Promise<boolean> => {
    const [row] = await db
      .select({ userId: participants.userId })
      .from(participants)
      .where(and(eq(participants.conversationId, conversationId), eq(participants.userId, userId)));
    return row !== undefined;
  };

  /** A message with whatever it carries. */
  const withFiles = async (row: typeof messages.$inferSelect): Promise<Message> => ({
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    text: row.text,
    at: row.at,
    seq: row.seq,
    attachments: await media.attachmentsOf(row.id),
  });

  const byId = async (id: string) => {
    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    return row;
  };

  const unreadOf = async (conversationId: string, userId: string): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(
        participants,
        and(eq(participants.conversationId, messages.conversationId), eq(participants.userId, userId)),
      )
      .where(
        and(
          eq(messages.conversationId, conversationId),
          sql`${messages.seq} > ${participants.readThrough}`,
          ne(messages.authorId, userId),
        ),
      );
    return row?.n ?? 0;
  };

  return {
    openDirect(a, b) {
      return database.write(async () => {
        if (a === b) throw new Error("not_two_people");
        const key = pairKeyOf(a, b);
        const [existing] = await db.select().from(conversations).where(eq(conversations.pairKey, key));
        if (existing !== undefined) return conversationOf(existing);

        const row = {
          id: randomUUID(),
          kind: "direct" as const,
          name: null,
          createdBy: a,
          createdAt: new Date().toISOString(),
          pairKey: key,
        };
        await db.insert(conversations).values(row);
        await db.insert(participants).values([
          { conversationId: row.id, userId: a },
          { conversationId: row.id, userId: b },
        ]);
        return conversationOf(row);
      });
    },

    openGroup(name, createdBy, members) {
      return database.write(async () => {
        const trimmed = name.trim();
        if (trimmed === "") throw new Error("empty_name");
        const row = {
          id: randomUUID(),
          kind: "group" as const,
          name: trimmed,
          createdBy,
          createdAt: new Date().toISOString(),
          // NULL: a group is never deduplicated. Two groups may share a name and a membership and
          // still be two different rooms, because somebody meant to open a second one.
          pairKey: null,
        };
        await db.insert(conversations).values(row);
        const everyone = [...new Set([createdBy, ...members])];
        await db.insert(participants).values(everyone.map((userId) => ({ conversationId: row.id, userId })));
        return conversationOf(row);
      });
    },

    async conversationsOf(userId) {
      const rows = await db
        .select()
        .from(conversations)
        .innerJoin(participants, eq(participants.conversationId, conversations.id))
        .where(eq(participants.userId, userId));

      const views: ConversationView[] = [];
      for (const { conversations: row } of rows) {
        const [last] = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, row.id))
          .orderBy(desc(messages.seq))
          .limit(1);
        views.push({
          ...conversationOf(row),
          participants: await participantsIn(row.id),
          lastMessage: last === undefined ? undefined : await withFiles(last),
          unread: await unreadOf(row.id, userId),
        });
      }
      return views.sort((a, b) => (b.lastMessage?.seq ?? 0) - (a.lastMessage?.seq ?? 0));
    },

    participantsOf: participantsIn,

    async conversationOfMessage(messageId) {
      return (await byId(messageId))?.conversationId;
    },

    send({ conversationId, authorId, text, messageId, attachmentIds = [] }) {
      return database.write(async () => {
        const body = text.trim();
        // A file IS the message when there are no words, which is how anybody sends a photo.
        if (body === "" && attachmentIds.length === 0) throw new Error("empty_message");
        if (body.length > MAX_TEXT) throw new Error("message_too_long");
        if (!(await isParticipant(conversationId, authorId))) throw new Error("not_a_participant");

        // The id may be given so that the same send arriving twice is one message: a retry upstream
        // must not become two lines in somebody's conversation.
        const id = messageId ?? randomUUID();
        const already = await byId(id);
        if (already !== undefined) return withFiles(already);

        // Checked BEFORE the message exists, so a half-uploaded file cannot leave a message pointing
        // at nothing. `ready` refuses anything unfinished or already owned, by name.
        await media.ready(attachmentIds);
        await db
          .insert(messages)
          .values({ id, conversationId, authorId, text: body, at: new Date().toISOString() });
        await media.bind(attachmentIds, id);

        const stored = await byId(id);
        if (stored === undefined) throw new Error("chat_failed");
        return withFiles(stored);
      });
    },

    async messagesOf(conversationId, options) {
      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
      const before = options?.before;
      const rows = await db
        .select()
        .from(messages)
        .where(
          before === undefined
            ? eq(messages.conversationId, conversationId)
            : and(eq(messages.conversationId, conversationId), lt(messages.seq, before)),
        )
        // Newest first so the limit takes the newest page; handed back oldest-first below, which is
        // the order a conversation is read in.
        .orderBy(desc(messages.seq))
        .limit(limit);

      const page: Message[] = [];
      for (const row of rows.reverse()) page.push(await withFiles(row));
      return page;
    },

    async markRead(conversationId, userId, through) {
      // `max` so that reading an older message never un-reads a newer one: with two tabs open, the
      // one showing yesterday would otherwise push the badge back up.
      await db
        .update(participants)
        .set({ readThrough: sql`max(${participants.readThrough}, ${through})` })
        .where(and(eq(participants.conversationId, conversationId), eq(participants.userId, userId)));
    },

    async unreadFor(userId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(messages)
        .innerJoin(participants, eq(participants.conversationId, messages.conversationId))
        .where(
          and(
            eq(participants.userId, userId),
            sql`${messages.seq} > ${participants.readThrough}`,
            ne(messages.authorId, userId),
          ),
        );
      return row?.n ?? 0;
    },

    async exportAll() {
      const rows = await db.select().from(messages).orderBy(messages.seq);
      const all: Message[] = [];
      for (const row of rows) all.push(await withFiles(row));
      return {
        conversations: (await db.select().from(conversations)).map(conversationOf),
        participants: await db.select().from(participants),
        messages: all,
        ...(await media.export()),
      };
    },

    deleteAll() {
      return database.write(async () => {
        // The files first: they are what a company would most mind leaving behind.
        await media.clear();
        await db.delete(messages);
        await db.delete(participants);
        await db.delete(conversations);
      });
    },

    close() {
      database.close();
    },

    media,
  };
}
