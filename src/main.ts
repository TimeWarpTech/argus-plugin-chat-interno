import { runPlugin } from "@creativepetabyte/argus-sdk";
import plugin from "./plugin.js";

/**
 * The bundle goes to the kernel, which keeps it and says where it ended up.
 *
 * This plugin needs no web server of its own and no public address: it dials out like everything
 * else it does. `src/serve-ui.ts` is still here for developing the screen by itself, but it is not
 * how the product gets it.
 */
await runPlugin(plugin, { hostedBundle: { file: "ui/dist/ui.js" } });
