/**
 * Where this plugin's screen is, and what exactly is at that address.
 *
 * Kept out of `plugin.ts` so that file stays about the chat. These facts belong to the DEPLOYMENT,
 * not to a company: the bundle is the same bytes for everyone who installs this plugin, which is the
 * whole reason there is one review, one hash and one server for it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * The address the operator approved.
 *
 * An origin on the operator's list (`PLUGIN_UI_ORIGINS`) and nowhere else: a bundle from an
 * unapproved origin is refused before a byte of it runs, because approval means somebody read it.
 * `serve-ui.ts` is what puts a build at this address in development.
 */
export const UI_URL = process.env.PLUGIN_UI_URL ?? "http://localhost:4640/ui.js";

/** The name of the export the page is drawn from. A NAME, resolved against the bundle — never code. */
export const PAGE_COMPONENT = "ChatInternoPage";

/**
 * The built file on disk, when there is one.
 *
 * Relative to this module, which only holds while the source layout survives the build. Compiled to
 * `dist/main.js` it still lands on `ui/dist/ui.js`; compiled to `dist/src/main.js` — what `tsc`
 * writes whenever a second root file appears — it lands on `dist/ui/dist/ui.js`, which is nowhere.
 * That is why this is the FALLBACK and `PLUGIN_UI_BUNDLE` overrides it.
 */
const BUNDLE_FILE =
  process.env.PLUGIN_UI_BUNDLE ?? fileURLToPath(new URL("../ui/dist/ui.js", import.meta.url));

const hashOf = (bytes: Uint8Array): string =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

/**
 * The hash of what is actually being SERVED, falling back to the file on disk.
 *
 * Fetching first is not belt-and-braces, it is the more honest answer: the kernel refuses the screen
 * unless what the browser downloads matches this hash, and what the browser downloads comes from
 * `UI_URL` — not from this process's disk. Reading only the file lets the two drift apart, which is
 * a screen that fails to load for everybody while the plugin reports itself healthy.
 *
 * `undefined` when there is no bundle anywhere, and then the manifest declares no page at all: a
 * named component with nothing behind it is a blank region on somebody's screen. It says so in the
 * log rather than starting quietly without a screen.
 */
export async function integrityOf(log: (line: string) => void): Promise<string | undefined> {
  try {
    const answer = await fetch(UI_URL);
    if (answer.ok) return hashOf(new Uint8Array(await answer.arrayBuffer()));
    log(`the screen's bundle answered ${answer.status} at ${UI_URL}; falling back to the file`);
  } catch {
    log(`nothing is serving the screen at ${UI_URL}; falling back to the file`);
  }

  try {
    return hashOf(await readFile(BUNDLE_FILE));
  } catch {
    log(`no screen: nothing at ${UI_URL} and no build at ${BUNDLE_FILE} (run \`npm run build:ui\`)`);
    return undefined;
  }
}
