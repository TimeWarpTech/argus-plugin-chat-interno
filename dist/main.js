var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/main.ts
import { runPlugin } from "@creativepetabyte/argus-sdk";

// src/plugin.ts
import { createHash } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import {
  definePlugin,
  eventsEmitScope
} from "@creativepetabyte/argus-sdk";

// src/store.ts
import { randomUUID } from "node:crypto";
import { and as and2, desc, eq as eq2, lt as lt2, ne, sql as sql2 } from "drizzle-orm";

// src/db.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";

// src/schema.ts
var schema_exports = {};
__export(schema_exports, {
  attachmentChunks: () => attachmentChunks,
  attachments: () => attachments,
  conversations: () => conversations,
  messages: () => messages,
  participants: () => participants
});
import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
var conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["direct", "group"] }).notNull(),
  /** A group's name. A direct conversation is named by whoever is on the other side. */
  name: text("name"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  /**
   * What makes a direct conversation unique, whichever way round the two names arrive.
   *
   * Sorted before it is stored, so opening a conversation from either side lands in the same
   * history. NULL for a group: two groups may share a name and a membership and still be two rooms.
   */
  pairKey: text("pair_key")
});
var participants = sqliteTable(
  "participants",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** How far this person has read. Never moves backwards. */
    readThrough: integer("read_through").notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index("participants_by_user").on(table.userId)
  ]
);
var messages = sqliteTable(
  "messages",
  {
    /** What orders messages. Never the timestamp: two in the same millisecond would be a coin toss. */
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    text: text("text").notNull(),
    at: text("at").notNull()
  },
  (table) => [
    unique("messages_id").on(table.id),
    index("messages_by_conversation").on(table.conversationId, table.seq)
  ]
);
var attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    /** Bytes stored so far. Also the next legal offset, which is what makes a gap impossible. */
    received: integer("received").notNull().default(0),
    /** NULL while pending: uploaded, owned by nobody, unreadable, swept after a day. */
    messageId: text("message_id"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("attachments_by_message").on(table.messageId),
    index("attachments_pending").on(table.messageId, table.createdAt)
  ]
);
var attachmentChunks = sqliteTable(
  "attachment_chunks",
  {
    attachmentId: text("attachment_id").notNull(),
    offset: integer("offset").notNull(),
    data: text("data").notNull()
  },
  (table) => [primaryKey({ columns: [table.attachmentId, table.offset] })]
);

// src/db.ts
var MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
function openDatabase(folder) {
  const raw = new DatabaseSync(folder === void 0 ? ":memory:" : join(folder, "chat-interno.db"));
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  migrate(raw);
  const db = drizzle(
    async (sql3, params, method) => {
      const statement = raw.prepare(sql3);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      const rows = statement.all(...params);
      const positional = rows.map((row) => Object.values(row));
      return { rows: method === "get" ? positional[0] ?? [] : positional };
    },
    { schema: schema_exports }
  );
  let queue = Promise.resolve();
  const write = (work) => {
    const mine = queue.then(async () => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const answer = await work();
        raw.exec("COMMIT");
        return answer;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    });
    queue = mine.catch(() => {
    });
    return mine;
  };
  return { db, raw, write, close: () => raw.close() };
}
var hasTable = (raw, name) => raw.prepare("SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== void 0;
function migrate(raw) {
  raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    raw.prepare("SELECT name FROM _migrations").all().map((row) => row.name)
  );
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  const first = files[0];
  if (first !== void 0 && done.size === 0 && hasTable(raw, "conversations")) {
    raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      first,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    done.add(first);
  }
  for (const name of files) {
    if (done.has(name)) continue;
    const sql3 = readFileSync(join(MIGRATIONS, name), "utf8");
    raw.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of sql3.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed !== "") raw.exec(trimmed);
      }
      raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        name,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
}

// src/media-store.ts
import { MAX_MEDIA_BYTES, MEDIA_CHUNK_BYTES } from "@creativepetabyte/argus-chat-media";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
var PENDING_MS = 24 * 60 * 60 * 1e3;
var PENDING_QUOTA = 50 * 1024 * 1024;
var NAME_MAX = 200;
var MIME_MAX = 150;
var MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-zA-Z0-9= .+-]+)?$/;
var BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
var attachmentOf = (row) => ({
  id: row.id,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size
});
var MediaStore = class {
  constructor(database) {
    this.database = database;
  }
  database;
  get db() {
    return this.database.db;
  }
  /** Reserves a file. Nothing is readable until every byte arrived and a message claimed it. */
  create(name, mimeType, size) {
    return this.database.write(async () => {
      await this.sweep();
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.length > NAME_MAX || // A name is shown, and saved to disk by whoever downloads it, so it carries no path and no
      // control characters.
      /[\\/]/.test(trimmed) || Array.from(trimmed).some((character) => character.charCodeAt(0) < 32) || mimeType.length > MIME_MAX || !MIME.test(mimeType) || !Number.isInteger(size) || size < 1 || size > MAX_MEDIA_BYTES)
        throw new Error("invalid_attachment");
      const [pending] = await this.db.select({ total: sql`coalesce(sum(${attachments.size}), 0)` }).from(attachments).where(isNull(attachments.messageId));
      if ((pending?.total ?? 0) + size > PENDING_QUOTA) throw new Error("upload_quota_exceeded");
      const file = { id: crypto.randomUUID(), name: trimmed, mimeType, size };
      await this.db.insert(attachments).values({ ...file, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
      return file;
    });
  }
  /** Takes one piece, in order. The same piece twice is one piece: a retry must not corrupt a file. */
  write(id, offset, data) {
    return this.database.write(async () => {
      const [file] = await this.db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.messageId)));
      if (file === void 0) throw new Error("attachment_not_found");
      if (!Number.isInteger(offset) || offset < 0 || offset % MEDIA_CHUNK_BYTES !== 0 || data.length > MEDIA_CHUNK_BYTES * 4 / 3 || !BASE64.test(data))
        throw new Error("invalid_media_chunk");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length !== Math.min(MEDIA_CHUNK_BYTES, file.size - offset) || bytes.length === 0)
        throw new Error("invalid_media_chunk");
      const [already] = await this.db.select({ data: attachmentChunks.data }).from(attachmentChunks).where(and(eq(attachmentChunks.attachmentId, id), eq(attachmentChunks.offset, offset)));
      if (already !== void 0) {
        if (already.data !== data) throw new Error("upload_conflict");
        return { ok: true };
      }
      if (offset !== file.received) throw new Error("invalid_upload_offset");
      await this.db.insert(attachmentChunks).values({ attachmentId: id, offset, data });
      await this.db.update(attachments).set({ received: sql`${attachments.received} + ${bytes.length}` }).where(eq(attachments.id, id));
      return { ok: true };
    });
  }
  /** The files that are whole and still unclaimed, refusing the rest by name. */
  async ready(ids) {
    const found = [];
    for (const id of ids) {
      const [row] = await this.db.select().from(attachments).where(
        and(
          eq(attachments.id, id),
          isNull(attachments.messageId),
          eq(attachments.received, attachments.size)
        )
      );
      if (row === void 0) throw new Error("attachment_not_ready");
      found.push(attachmentOf(row));
    }
    return found;
  }
  /** Hands the files to the message that now owns them. */
  async bind(ids, messageId) {
    if (ids.length === 0) return;
    await this.db.update(attachments).set({ messageId }).where(and(inArray(attachments.id, [...ids]), isNull(attachments.messageId)));
  }
  async attachmentsOf(messageId) {
    const rows = await this.db.select().from(attachments).where(eq(attachments.messageId, messageId)).orderBy(attachments.name);
    return rows.map(attachmentOf);
  }
  /**
   * One piece of a file, named by the message that owns it.
   *
   * The message id is part of the question on purpose: it is what ties a file to a conversation, and
   * the caller checks that the reader is in that conversation before asking. An id on its own would
   * make every file in the company readable by anybody who guessed one.
   */
  async readChunk(attachmentId, messageId, offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset % MEDIA_CHUNK_BYTES !== 0)
      throw new Error("invalid_request");
    const [row] = await this.db.select({ data: attachmentChunks.data }).from(attachmentChunks).innerJoin(attachments, eq(attachments.id, attachmentChunks.attachmentId)).where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.messageId, messageId),
        eq(attachmentChunks.offset, offset)
      )
    );
    if (row === void 0) throw new Error("attachment_not_found");
    return { data: row.data };
  }
  /** Drops an upload nobody claimed. A file a message owns is deleted with the conversation. */
  remove(id) {
    return this.database.write(async () => {
      const [pending] = await this.db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.id, id), isNull(attachments.messageId)));
      if (pending !== void 0) {
        await this.db.delete(attachmentChunks).where(eq(attachmentChunks.attachmentId, id));
        await this.db.delete(attachments).where(eq(attachments.id, id));
      }
      return { ok: true };
    });
  }
  async export() {
    return {
      attachments: await this.db.select().from(attachments),
      attachmentChunks: await this.db.select().from(attachmentChunks)
    };
  }
  async clear() {
    await this.db.delete(attachmentChunks);
    await this.db.delete(attachments);
  }
  /** Sweeps uploads nobody ever claimed, so an abandoned tab does not keep a file for ever. */
  async sweep() {
    const cutoff = new Date(Date.now() - PENDING_MS).toISOString();
    const stale = await this.db.select({ id: attachments.id }).from(attachments).where(and(isNull(attachments.messageId), lt(attachments.createdAt, cutoff)));
    if (stale.length === 0) return;
    const ids = stale.map((row) => row.id);
    await this.db.delete(attachmentChunks).where(inArray(attachmentChunks.attachmentId, ids));
    await this.db.delete(attachments).where(inArray(attachments.id, ids));
  }
};

// src/store.ts
var MAX_TEXT = 4e3;
var pairKeyOf = (a, b) => [a, b].sort().join("\0");
var conversationOf = (row) => ({
  id: row.id,
  kind: row.kind,
  name: row.name ?? void 0,
  createdBy: row.createdBy,
  createdAt: row.createdAt
});
function openStore(folder) {
  const database = openDatabase(folder);
  const { db } = database;
  const media = new MediaStore(database);
  const participantsIn = async (conversationId) => {
    const rows = await db.select({ userId: participants.userId }).from(participants).where(eq2(participants.conversationId, conversationId));
    return rows.map((row) => row.userId);
  };
  const isParticipant = async (conversationId, userId) => {
    const [row] = await db.select({ userId: participants.userId }).from(participants).where(and2(eq2(participants.conversationId, conversationId), eq2(participants.userId, userId)));
    return row !== void 0;
  };
  const withFiles = async (row) => ({
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    text: row.text,
    at: row.at,
    seq: row.seq,
    attachments: await media.attachmentsOf(row.id)
  });
  const byId = async (id) => {
    const [row] = await db.select().from(messages).where(eq2(messages.id, id));
    return row;
  };
  const unreadOf = async (conversationId, userId) => {
    const [row] = await db.select({ n: sql2`count(*)` }).from(messages).innerJoin(
      participants,
      and2(eq2(participants.conversationId, messages.conversationId), eq2(participants.userId, userId))
    ).where(
      and2(
        eq2(messages.conversationId, conversationId),
        sql2`${messages.seq} > ${participants.readThrough}`,
        ne(messages.authorId, userId)
      )
    );
    return row?.n ?? 0;
  };
  return {
    openDirect(a, b) {
      return database.write(async () => {
        if (a === b) throw new Error("not_two_people");
        const key = pairKeyOf(a, b);
        const [existing] = await db.select().from(conversations).where(eq2(conversations.pairKey, key));
        if (existing !== void 0) return conversationOf(existing);
        const row = {
          id: randomUUID(),
          kind: "direct",
          name: null,
          createdBy: a,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          pairKey: key
        };
        await db.insert(conversations).values(row);
        await db.insert(participants).values([
          { conversationId: row.id, userId: a },
          { conversationId: row.id, userId: b }
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
          kind: "group",
          name: trimmed,
          createdBy,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          // NULL: a group is never deduplicated. Two groups may share a name and a membership and
          // still be two different rooms, because somebody meant to open a second one.
          pairKey: null
        };
        await db.insert(conversations).values(row);
        const everyone = [.../* @__PURE__ */ new Set([createdBy, ...members])];
        await db.insert(participants).values(everyone.map((userId) => ({ conversationId: row.id, userId })));
        return conversationOf(row);
      });
    },
    async conversationsOf(userId) {
      const rows = await db.select().from(conversations).innerJoin(participants, eq2(participants.conversationId, conversations.id)).where(eq2(participants.userId, userId));
      const views = [];
      for (const { conversations: row } of rows) {
        const [last] = await db.select().from(messages).where(eq2(messages.conversationId, row.id)).orderBy(desc(messages.seq)).limit(1);
        views.push({
          ...conversationOf(row),
          participants: await participantsIn(row.id),
          lastMessage: last === void 0 ? void 0 : await withFiles(last),
          unread: await unreadOf(row.id, userId)
        });
      }
      return views.sort((a, b) => (b.lastMessage?.seq ?? 0) - (a.lastMessage?.seq ?? 0));
    },
    participantsOf: participantsIn,
    async conversationOfMessage(messageId) {
      return (await byId(messageId))?.conversationId;
    },
    send({ conversationId, authorId, text: text2, messageId, attachmentIds = [] }) {
      return database.write(async () => {
        const body = text2.trim();
        if (body === "" && attachmentIds.length === 0) throw new Error("empty_message");
        if (body.length > MAX_TEXT) throw new Error("message_too_long");
        if (!await isParticipant(conversationId, authorId)) throw new Error("not_a_participant");
        const id = messageId ?? randomUUID();
        const already = await byId(id);
        if (already !== void 0) return withFiles(already);
        await media.ready(attachmentIds);
        await db.insert(messages).values({ id, conversationId, authorId, text: body, at: (/* @__PURE__ */ new Date()).toISOString() });
        await media.bind(attachmentIds, id);
        const stored = await byId(id);
        if (stored === void 0) throw new Error("chat_failed");
        return withFiles(stored);
      });
    },
    async messagesOf(conversationId, options) {
      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
      const before = options?.before;
      const rows = await db.select().from(messages).where(
        before === void 0 ? eq2(messages.conversationId, conversationId) : and2(eq2(messages.conversationId, conversationId), lt2(messages.seq, before))
      ).orderBy(desc(messages.seq)).limit(limit);
      const page = [];
      for (const row of rows.reverse()) page.push(await withFiles(row));
      return page;
    },
    async markRead(conversationId, userId, through) {
      await db.update(participants).set({ readThrough: sql2`max(${participants.readThrough}, ${through})` }).where(and2(eq2(participants.conversationId, conversationId), eq2(participants.userId, userId)));
    },
    async unreadFor(userId) {
      const [row] = await db.select({ n: sql2`count(*)` }).from(messages).innerJoin(participants, eq2(participants.conversationId, messages.conversationId)).where(
        and2(
          eq2(participants.userId, userId),
          sql2`${messages.seq} > ${participants.readThrough}`,
          ne(messages.authorId, userId)
        )
      );
      return row?.n ?? 0;
    },
    async exportAll() {
      const rows = await db.select().from(messages).orderBy(messages.seq);
      const all = [];
      for (const row of rows) all.push(await withFiles(row));
      return {
        conversations: (await db.select().from(conversations)).map(conversationOf),
        participants: await db.select().from(participants),
        messages: all,
        ...await media.export()
      };
    },
    deleteAll() {
      return database.write(async () => {
        await media.clear();
        await db.delete(messages);
        await db.delete(participants);
        await db.delete(conversations);
      });
    },
    close() {
      database.close();
    },
    media
  };
}

// src/plugin.ts
var PLUGIN_ID = "chat.internal";
var MEMBERS_READ = "kernel.members:read";
var CHAT = "chat.internal.v1.InternalChat";
var MESSAGE_SENT = "chat.internal.v1.MessageSent";
var SCREEN_PATH = "chat-interno";
var BUNDLE = fileURLToPath2(new URL("../ui/dist/ui.js", import.meta.url));
var BUNDLE_URL = process.env.PLUGIN_UI_URL ?? "http://localhost:4640/ui.js";
function integrity() {
  try {
    return `sha384-${createHash("sha384").update(readFileSync2(BUNDLE)).digest("base64")}`;
  } catch {
    return void 0;
  }
}
var HASH = integrity();
var refusal = (error) => ({ error });
var NO_CALLER = "no_caller";
var asRecord = (input) => typeof input === "object" && input !== null ? input : {};
var stringAt = (input, key) => {
  const value = asRecord(input)[key];
  return typeof value === "string" && value !== "" ? value : void 0;
};
var numberAt = (input, key) => {
  const value = asRecord(input)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
};
var stringsAt = (input, key) => {
  const value = asRecord(input)[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
};
var codeOf = (error) => {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z_]+$/.test(message) ? message : "chat_failed";
};
var plugin = definePlugin({
  id: PLUGIN_ID,
  manifest: {
    serves: [CHAT],
    emits: [MESSAGE_SENT],
    requestedScopes: [
      {
        // Emitting is a permission, not plumbing: without this every emit answers 403 and the
        // refusal is recorded. Essential because a chat whose screens never update is not a chat.
        name: eventsEmitScope(PLUGIN_ID),
        description: "Avisar as telas abertas de cada mensagem nova",
        essential: true
      },
      {
        // The staff directory, which is the only thing this plugin asks of the kernel. Essential:
        // a chat that cannot name a single colleague has nobody to open a conversation with.
        //
        // Spelled out rather than built, because the SDK has no builder for it -- `eventsEmitScope`
        // and friends cover events and calls, and this one is the kernel's own capability.
        name: MEMBERS_READ,
        description: "Ver quem trabalha nesta empresa, para voc\xEA escolher com quem falar",
        essential: true
      }
    ],
    ...HASH === void 0 ? {} : { ui: { url: BUNDLE_URL, integrity: HASH } },
    pages: HASH === void 0 ? [] : [{ path: SCREEN_PATH, title: "Chat interno", component: "ChatInternoPage" }],
    slots: [
      {
        id: `${PLUGIN_ID}:rail`,
        slot: "shell.nav.rail",
        // A plugin's page is mounted under `plugins/`, never at the top level -- the shell puts it
        // there so a plugin cannot shadow a screen of the product's own. The link has to say the
        // same, and it is relative: a leading `/app` lands on `/app/app/...`.
        content: { kind: "link", label: "Chat interno", icon: "message-circle", to: `plugins/${SCREEN_PATH}` }
      }
    ],
    messages: {
      "pt-BR": { title: "Chat interno" },
      en: { title: "Internal chat" }
    }
  },
  create(ctx) {
    let store;
    const storage = () => {
      store ??= openStore(ctx.dataDir);
      return store;
    };
    if (ctx.dataDir === void 0) {
      ctx.log("no data directory: the chat is in memory and will not survive a restart");
    }
    const authorOf = (call) => call?.caller?.userId;
    const announceMessage = async (message, participants2) => {
      try {
        await ctx.emit(
          MESSAGE_SENT,
          {
            messageId: message.id,
            conversationId: message.conversationId,
            authorId: message.authorId,
            text: message.text,
            at: message.at,
            seq: message.seq,
            participants: [...participants2]
          },
          // Ordered by conversation: two messages in one conversation arrive in the order they were
          // written, while different conversations go in parallel.
          { orderKey: message.conversationId }
        );
      } catch (error) {
        ctx.log(`could not announce a message: ${codeOf(error)}`);
      }
    };
    return {
      serves: {
        [CHAT]: {
          /** The colleagues, from the kernel's directory. Degrades on a host that offers none. */
          Colleagues: async (_input, call) => {
            if (authorOf(call) === void 0) return refusal(NO_CALLER);
            if (ctx.members === void 0) return { colleagues: [], directory: "unavailable" };
            try {
              const page = await ctx.members.list({ pageSize: 100 });
              return { colleagues: page.members, nextOffset: page.nextOffset };
            } catch {
              return { colleagues: [], directory: "unavailable" };
            }
          },
          Conversations: async (_input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            return {
              conversations: await storage().conversationsOf(me),
              unread: await storage().unreadFor(me)
            };
          },
          OpenDirect: async (input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            const withUserId = stringAt(input, "withUserId");
            if (withUserId === void 0) return refusal("no_such_colleague");
            try {
              return { conversation: await storage().openDirect(me, withUserId) };
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          /**
           * A group, which is the ONE thing here that a call with nobody behind it may open.
           *
           * Another plugin opening a room — an automation starting a shift channel — has no person
           * to name, and opening a room forges nobody's words. Writing in it still demands a caller.
           */
          OpenGroup: async (input, call) => {
            const name = stringAt(input, "name");
            if (name === void 0) return refusal("empty_name");
            const me = authorOf(call) ?? "system";
            try {
              return { conversation: await storage().openGroup(name, me, stringsAt(input, "memberIds")) };
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          Messages: async (input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            if (conversationId === void 0) return refusal("no_such_conversation");
            if (!(await storage().participantsOf(conversationId)).includes(me)) {
              return refusal("not_a_participant");
            }
            const before = numberAt(input, "before");
            const limit = numberAt(input, "limit");
            return {
              messages: await storage().messagesOf(conversationId, {
                ...before === void 0 ? {} : { before },
                ...limit === void 0 ? {} : { limit }
              })
            };
          },
          Send: async (input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            if (conversationId === void 0) return refusal("no_such_conversation");
            const text2 = typeof asRecord(input).text === "string" ? asRecord(input).text : "";
            const messageId = stringAt(input, "messageId");
            const attachmentIds = stringsAt(input, "attachmentIds");
            try {
              const message = await storage().send({
                conversationId,
                authorId: me,
                text: text2,
                attachmentIds,
                ...messageId === void 0 ? {} : { messageId }
              });
              await storage().markRead(conversationId, me, message.seq);
              await announceMessage(message, await storage().participantsOf(conversationId));
              return { message };
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          MarkRead: async (input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            const through = numberAt(input, "through");
            if (conversationId === void 0 || through === void 0) {
              return refusal("no_such_conversation");
            }
            await storage().markRead(conversationId, me, through);
            return { unread: await storage().unreadFor(me) };
          },
          /**
           * Files travel in pieces over this same contract call, never over a URL.
           *
           * `@creativepetabyte/argus-chat-media` fixes the chunk size at 48 KiB so that a piece,
           * base64-encoded, still fits the 100kb a plugin call accepts — and `chat-tickets` already
           * ships this exact shape. Reusing it rather than inventing a second one is the difference
           * between one format and two that disagree about a boundary and corrupt a file.
           */
          CreateAttachment: async (input, call) => {
            if (authorOf(call) === void 0) return refusal(NO_CALLER);
            const size = asRecord(input).size;
            const name = stringAt(input, "name");
            const mimeType = stringAt(input, "mimeType");
            if (name === void 0 || mimeType === void 0 || typeof size !== "number") {
              return refusal("invalid_attachment");
            }
            try {
              return await storage().media.create(name, mimeType, size);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          WriteAttachment: async (input, call) => {
            if (authorOf(call) === void 0) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            const data = stringAt(input, "data");
            const offset = numberAt(input, "offset");
            if (attachmentId === void 0 || data === void 0 || offset === void 0) {
              return refusal("invalid_media_chunk");
            }
            try {
              return await storage().media.write(attachmentId, offset, data);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          /**
           * One piece of a file somebody already sent.
           *
           * Whoever asks must be in the conversation that message belongs to — checked here, where
           * the caller is known, rather than inside the store, which only knows about rows.
           */
          ReadAttachment: async (input, call) => {
            const me = authorOf(call);
            if (me === void 0) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            const messageId = stringAt(input, "messageId");
            const offset = numberAt(input, "offset");
            if (attachmentId === void 0 || messageId === void 0 || offset === void 0) {
              return refusal("invalid_request");
            }
            const conversationId = await storage().conversationOfMessage(messageId);
            if (conversationId === void 0) return refusal("no_such_conversation");
            if (!(await storage().participantsOf(conversationId)).includes(me)) {
              return refusal("not_a_participant");
            }
            try {
              return await storage().media.readChunk(attachmentId, messageId, offset);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          /** Drops an upload nobody sent yet, so a cancelled attachment leaves nothing behind. */
          DeleteAttachment: async (input, call) => {
            if (authorOf(call) === void 0) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            if (attachmentId === void 0) return refusal("invalid_request");
            try {
              return await storage().media.remove(attachmentId);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },
          /** Demanded by the handshake, and by anybody who wants to leave with what they wrote. */
          ExportTenantData: () => storage().exportAll(),
          DeleteTenantData: async () => {
            await storage().deleteAll();
            return {};
          }
        }
      },
      exportData: () => storage().exportAll(),
      deleteData: () => storage().deleteAll(),
      onShutdown: () => {
        store?.close();
        store = void 0;
      }
    };
  }
});
var plugin_default = plugin;

// src/main.ts
await runPlugin(plugin_default);
