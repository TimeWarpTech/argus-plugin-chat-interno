/**
 * The schema moves, and a database written last week has to keep opening.
 *
 * This plugin owns its database: the kernel knows nothing about the file and will never migrate it.
 * So the migrations ship with the plugin and run when a company's database is opened — and these
 * tests are the ones that fail the day that stops being true.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore } from "../src/store.js";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "chat-interno-migrations-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const applied = (): string[] => {
  const raw = new DatabaseSync(join(folder, "chat-interno.db"));
  try {
    return (raw.prepare("SELECT name FROM _migrations ORDER BY name").all() as { name: string }[]).map(
      (row) => row.name,
    );
  } finally {
    raw.close();
  }
};

describe("opening a database", () => {
  it("applies every migration the plugin ships", () => {
    const store = openStore(folder);
    store.close();

    const shipped = readdirSync(fileURLToPath(new URL("../drizzle", import.meta.url)))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(applied()).toEqual(shipped);
    expect(shipped.length).toBeGreaterThan(0);
  });

  it("runs each one once, however many times the plugin restarts", async () => {
    const first = openStore(folder);
    const conversation = await first.openDirect("ana", "bruno");
    await first.send({ conversationId: conversation.id, authorId: "ana", text: "de ontem" });
    first.close();
    const afterFirstBoot = applied();

    // Exactly what a restart is: the same folder, opened again.
    const second = openStore(folder);
    const kept = await second.messagesOf(conversation.id);
    second.close();

    expect(applied()).toEqual(afterFirstBoot);
    expect(kept.map((message) => message.text)).toEqual(["de ontem"]);
  });

  it("writes the file where the company's folder is, and nowhere else", () => {
    const store = openStore(folder);
    store.close();
    expect(existsSync(join(folder, "chat-interno.db"))).toBe(true);
  });
});

describe("a database that already had the tables", () => {
  /**
   * The real case, and the one that broke: this plugin created its tables by hand before it had
   * migrations at all. The first migration is a `CREATE TABLE`, so running it against such a file
   * fails with "table already exists" -- and every conversation in it becomes unreadable.
   */
  it("is adopted instead of refused, and keeps everything in it", async () => {
    const path = join(folder, "chat-interno.db");
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, pair_key TEXT UNIQUE
      );
      CREATE TABLE participants (
        conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
        read_through INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conversation_id, user_id)
      );
      CREATE TABLE messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
        received INTEGER NOT NULL DEFAULT 0, message_id TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE attachment_chunks (
        attachment_id TEXT NOT NULL, offset INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (attachment_id, offset)
      );
    `);
    old.exec(
      "INSERT INTO conversations VALUES ('c-1','direct',NULL,'ana','2026-10-01T10:00:00.000Z','ana' || char(0) || 'bruno')",
    );
    old.exec("INSERT INTO participants (conversation_id,user_id) VALUES ('c-1','ana'),('c-1','bruno')");
    old.exec(
      "INSERT INTO messages (id,conversation_id,author_id,text,at) VALUES ('m-1','c-1','ana','de antes','2026-10-01T10:00:00.000Z')",
    );
    old.close();

    const store = openStore(folder);
    const kept = await store.messagesOf("c-1");
    const mine = await store.conversationsOf("ana");
    // It must keep working afterwards, not merely open.
    const fresh = await store.send({ conversationId: "c-1", authorId: "bruno", text: "depois" });
    store.close();

    expect(kept.map((message) => message.text)).toEqual(["de antes"]);
    expect(mine).toHaveLength(1);
    expect(fresh.seq).toBeGreaterThan(0);
  });
});

describe("a database from an older version", () => {
  it("is brought up to date instead of being refused", async () => {
    // A database that only ever saw the first migration -- which is what any installation looks
    // like the moment a new one is added.
    const raw = new DatabaseSync(join(folder, "chat-interno.db"));
    raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const shipped = readdirSync(fileURLToPath(new URL("../drizzle", import.meta.url)))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const [first] = shipped;
    if (first === undefined) throw new Error("the plugin ships no migrations");
    raw.close();

    // Opening it runs everything that has not run, in order, and the chat works afterwards.
    const store = openStore(folder);
    const conversation = await store.openDirect("ana", "bruno");
    const message = await store.send({ conversationId: conversation.id, authorId: "ana", text: "oi" });
    store.close();

    expect(applied()).toEqual(shipped);
    expect(message.seq).toBeGreaterThan(0);
  });
});
