/**
 * Drizzle over `node:sqlite`, and the migrations that bring an old file up to date.
 *
 * There is no Drizzle driver for `node:sqlite`, and the two that exist do not fit: `better-sqlite3`
 * is a native dependency somebody installing this plugin would have to build, and `bun-sqlite` only
 * runs under Bun while this process runs under Node. `sqlite-proxy` is the one made for this — it
 * asks only for a function that runs SQL — so the plugin keeps the runtime's own SQLite and still
 * gets a typed schema and generated migrations.
 *
 * The cost is that every query is a promise. That is the whole reason the store is async.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface Database {
  db: Db;
  /** For the two things Drizzle cannot express over a proxy: transactions and PRAGMA. */
  raw: DatabaseSync;
  /**
   * Runs `work` with the database to itself, inside one transaction.
   *
   * Both halves matter. SQLite gives the transaction; the queue gives the isolation, because over
   * the proxy every query is a promise and an `await` between BEGIN and COMMIT lets another call
   * run — which is how two uploads would interleave inside one transaction and commit each other's
   * half. Calls are serialised per company, which is the only place a database is shared.
   */
  write<T>(work: () => Promise<T>): Promise<T>;
  close(): void;
}

/** Where `drizzle-kit generate` writes the SQL. Shipped with the plugin, applied on open. */
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Opens this company's database and brings it up to date.
 *
 * `undefined` is not an oversight: the runtime hands a folder only when the process was given one,
 * and inventing a path would promise a durability it does not have. With nowhere to write, the chat
 * runs in memory — usable, and lost on restart. The caller says so out loud.
 */
export function openDatabase(folder: string | undefined): Database {
  const raw = new DatabaseSync(folder === undefined ? ":memory:" : join(folder, "chat-interno.db"));
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  migrate(raw);

  const db = drizzle<typeof schema>(
    async (sql, params, method) => {
      const statement = raw.prepare(sql);
      // `run` is for statements that answer nothing; asking them for rows throws.
      if (method === "run") {
        statement.run(...(params as never[]));
        return { rows: [] };
      }
      const rows = statement.all(...(params as never[])) as Record<string, unknown>[];
      // The proxy wants positional rows, and `get` wants one row rather than a list of them.
      const positional = rows.map((row) => Object.values(row));
      return { rows: method === "get" ? (positional[0] ?? []) : positional };
    },
    { schema },
  );

  /** The tail of the queue: each write waits for the previous one, whatever happened to it. */
  let queue: Promise<unknown> = Promise.resolve();

  const write = <T>(work: () => Promise<T>): Promise<T> => {
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
    // The queue must not stop at the first failure, so it follows the settled promise either way.
    queue = mine.catch(() => {});
    return mine;
  };

  return { db, raw, write, close: () => raw.close() };
}

/**
 * Applies every migration this plugin ships, once each.
 *
 * Drizzle's own migrator does not work over the proxy, so this is the same idea in the open: a table
 * remembering what ran, and each file applied in name order inside one transaction. A failure stops
 * the plugin rather than leaving a half-migrated database that reads fine until it does not.
 */
const hasTable = (raw: DatabaseSync, name: string): boolean =>
  raw.prepare("SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined;

function migrate(raw: DatabaseSync): void {
  raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    (raw.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((row) => row.name),
  );
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  /**
   * A database that already has the tables is adopted, not rebuilt.
   *
   * This plugin created its schema by hand before it had migrations, so such files exist. The first
   * migration is a plain `CREATE TABLE`, which fails against them with "table already exists" — and
   * then every conversation in that file becomes unreachable. Recording it as done instead is the
   * usual baseline: the schema is the same one it would have created.
   */
  const first = files[0];
  if (first !== undefined && done.size === 0 && hasTable(raw, "conversations")) {
    raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      first,
      new Date().toISOString(),
    );
    done.add(first);
  }

  for (const name of files) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS, name), "utf8");
    raw.exec("BEGIN IMMEDIATE");
    try {
      // drizzle-kit separates statements with this marker; `exec` would choke on the breakpoints.
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed !== "") raw.exec(trimmed);
      }
      raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        name,
        new Date().toISOString(),
      );
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
}
