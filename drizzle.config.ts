import { defineConfig } from "drizzle-kit";

/**
 * This plugin owns its database, so it owns its migrations: the kernel never touches this file.
 * `npm run db:generate` writes SQL into `drizzle/`, which ships with the plugin and is applied when
 * a company's database is opened.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
