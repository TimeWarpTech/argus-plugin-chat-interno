/**
 * The internal chat: the people of one company talking to each other, inside the product.
 *
 * It is a plugin and not a part of the kernel for the reason every other one is: a company that does
 * not want it should not have it, and removing it must not stop the product booting. It holds its own
 * SQLite file, asks the kernel only for the staff directory, and announces every message it stores so
 * that an open screen learns of it without polling.
 *
 * What it does NOT do yet, deliberately and visibly: media. A plugin's screen has no way to upload a
 * file — the body limit on a plugin route is 100kb, which is a thumbnail, not an attachment. That is
 * issue #118 on the kernel, and the screen says so instead of offering a button that fails.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  definePlugin,
  eventsEmitScope,
  type PluginContext,
  type ServedCall,
} from "@creativepetabyte/argus-sdk";
import { openStore, type Message, type Store } from "./store.js";

export const PLUGIN_ID = "chat.internal";

/**
 * The kernel's read-only staff directory capability.
 *
 * Written out instead of imported: a plugin depends on the SDK and nothing else, exactly as the SDK
 * itself writes out `kernel.v1.CallRequested` rather than dragging the product into a plugin's
 * `node_modules`. What keeps the two honest is that the kernel refuses what does not match.
 */
const MEMBERS_READ = "kernel.members:read";

/** What this plugin SERVES. Its own screen is the main caller; another plugin may call it too. */
export const CHAT = "chat.internal.v1.InternalChat";

/**
 * What this plugin EMITS, on every message stored.
 *
 * The screen listens to this to redraw, and a plugin may only listen to its own topic — the kernel
 * refuses anyone naming somebody else's. So this is both the notification and the live update.
 */
export const MESSAGE_SENT = "chat.internal.v1.MessageSent";

const SCREEN_PATH = "chat-interno";
const BUNDLE = fileURLToPath(new URL("../ui/dist/ui.js", import.meta.url));
const BUNDLE_URL = process.env.PLUGIN_UI_URL ?? "http://localhost:4640/ui.js";

/**
 * The hash of the file THIS process has on disk, or nothing when it was never built.
 *
 * The kernel refuses the screen when what the browser downloaded does not match, which is why the
 * process and the bundle server have to read the same bytes — built together, never at two moments.
 *
 * `undefined` when there is no bundle, and then the manifest declares neither the page nor the
 * component: a named component with no bundle behind it is a blank region on somebody's screen. The
 * link stays, degraded, so the plugin is visibly installed rather than invisible.
 */
function integrity(): string | undefined {
  try {
    return `sha384-${createHash("sha384").update(readFileSync(BUNDLE)).digest("base64")}`;
  } catch {
    return undefined;
  }
}

const HASH = integrity();

/** An answer a screen can translate. The API returns codes, never sentences. */
type Refusal = { error: string };

const refusal = (error: string): Refusal => ({ error });

/** Codes this plugin refuses with, all of them translated by the screen. */
const NO_CALLER = "no_caller";

const asRecord = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

const stringAt = (input: unknown, key: string): string | undefined => {
  const value = asRecord(input)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const numberAt = (input: unknown, key: string): number | undefined => {
  const value = asRecord(input)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const stringsAt = (input: unknown, key: string): string[] => {
  const value = asRecord(input)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

/** Whatever the store threw, as a code. An unknown failure is never passed on raw. */
const codeOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z_]+$/.test(message) ? message : "chat_failed";
};

const plugin = definePlugin({
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
        essential: true,
      },
      {
        // The staff directory, which is the only thing this plugin asks of the kernel. Essential:
        // a chat that cannot name a single colleague has nobody to open a conversation with.
        //
        // Spelled out rather than built, because the SDK has no builder for it -- `eventsEmitScope`
        // and friends cover events and calls, and this one is the kernel's own capability.
        name: MEMBERS_READ,
        description: "Ver quem trabalha nesta empresa, para você escolher com quem falar",
        essential: true,
      },
    ],
    ...(HASH === undefined ? {} : { ui: { url: BUNDLE_URL, integrity: HASH } }),
    pages:
      HASH === undefined
        ? []
        : [{ path: SCREEN_PATH, title: "Chat interno", component: "ChatInternoPage" }],
    slots: [
      {
        id: `${PLUGIN_ID}:rail`,
        slot: "shell.nav.rail",
        // A plugin's page is mounted under `plugins/`, never at the top level -- the shell puts it
        // there so a plugin cannot shadow a screen of the product's own. The link has to say the
        // same, and it is relative: a leading `/app` lands on `/app/app/...`.
        content: { kind: "link", label: "Chat interno", icon: "message-circle", to: `plugins/${SCREEN_PATH}` },
      },
    ],
    messages: {
      "pt-BR": { title: "Chat interno" },
      en: { title: "Internal chat" },
    },
  },

  create(ctx: PluginContext) {
    /**
     * One store per company, opened here because `create` runs once per company. A `Map` at module
     * scope keyed by company is the leak this project lints for — and the one the previous system
     * shipped.
     */
    let store: Store | undefined;

    const storage = (): Store => {
      store ??= openStore(ctx.dataDir);
      return store;
    };

    if (ctx.dataDir === undefined) {
      // Said out loud rather than quietly kept in memory: the conversations will not survive a
      // restart, and somebody has to know that before they rely on them.
      ctx.log("no data directory: the chat is in memory and will not survive a restart");
    }

    /** Who the kernel says is calling, or nothing. Nothing is a refusal, never an invented author. */
    const authorOf = (call: ServedCall | undefined): string | undefined => call?.caller?.userId;

    const announceMessage = async (message: Message, participants: readonly string[]): Promise<void> => {
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
            participants: [...participants],
          },
          // Ordered by conversation: two messages in one conversation arrive in the order they were
          // written, while different conversations go in parallel.
          { orderKey: message.conversationId },
        );
      } catch (error) {
        // The message is stored. A relay that is away must not lose it or fail the send — the SDK
        // resends on its own, and the screen reloads on its next call.
        ctx.log(`could not announce a message: ${codeOf(error)}`);
      }
    };

    return {
      serves: {
        [CHAT]: {
          /** The colleagues, from the kernel's directory. Degrades on a host that offers none. */
          Colleagues: async (_input: unknown, call?: ServedCall) => {
            if (authorOf(call) === undefined) return refusal(NO_CALLER);
            if (ctx.members === undefined) return { colleagues: [], directory: "unavailable" };
            try {
              const page = await ctx.members.list({ pageSize: 100 });
              return { colleagues: page.members, nextOffset: page.nextOffset };
            } catch {
              return { colleagues: [], directory: "unavailable" };
            }
          },

          Conversations: (_input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            return { conversations: storage().conversationsOf(me), unread: storage().unreadFor(me) };
          },

          OpenDirect: (input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            const withUserId = stringAt(input, "withUserId");
            if (withUserId === undefined) return refusal("no_such_colleague");
            try {
              return { conversation: storage().openDirect(me, withUserId) };
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
          OpenGroup: (input: unknown, call?: ServedCall) => {
            const name = stringAt(input, "name");
            if (name === undefined) return refusal("empty_name");
            const me = authorOf(call) ?? "system";
            try {
              return { conversation: storage().openGroup(name, me, stringsAt(input, "memberIds")) };
            } catch (error) {
              return refusal(codeOf(error));
            }
          },

          Messages: (input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            if (conversationId === undefined) return refusal("no_such_conversation");
            if (!storage().participantsOf(conversationId).includes(me)) {
              return refusal("not_a_participant");
            }
            const before = numberAt(input, "before");
            const limit = numberAt(input, "limit");
            return {
              messages: storage().messagesOf(conversationId, {
                ...(before === undefined ? {} : { before }),
                ...(limit === undefined ? {} : { limit }),
              }),
            };
          },

          Send: async (input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            if (conversationId === undefined) return refusal("no_such_conversation");
            const text = typeof asRecord(input).text === "string" ? (asRecord(input).text as string) : "";
            const messageId = stringAt(input, "messageId");
            const attachmentIds = stringsAt(input, "attachmentIds");
            try {
              // The author is the person the KERNEL named. Whatever the input claims is ignored:
              // taking it from there is how anyone writes as anyone.
              const message = storage().send({
                conversationId,
                authorId: me,
                text,
                attachmentIds,
                ...(messageId === undefined ? {} : { messageId }),
              });
              // Sending is reading, for the sender: their own message must not come back unread.
              storage().markRead(conversationId, me, message.seq);
              await announceMessage(message, storage().participantsOf(conversationId));
              return { message };
            } catch (error) {
              return refusal(codeOf(error));
            }
          },

          MarkRead: (input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            const conversationId = stringAt(input, "conversationId");
            const through = numberAt(input, "through");
            if (conversationId === undefined || through === undefined) {
              return refusal("no_such_conversation");
            }
            storage().markRead(conversationId, me, through);
            return { unread: storage().unreadFor(me) };
          },

          /**
           * Files travel in pieces over this same contract call, never over a URL.
           *
           * `@creativepetabyte/argus-chat-media` fixes the chunk size at 48 KiB so that a piece,
           * base64-encoded, still fits the 100kb a plugin call accepts — and `chat-tickets` already
           * ships this exact shape. Reusing it rather than inventing a second one is the difference
           * between one format and two that disagree about a boundary and corrupt a file.
           */
          CreateAttachment: (input: unknown, call?: ServedCall) => {
            if (authorOf(call) === undefined) return refusal(NO_CALLER);
            const size = asRecord(input).size;
            const name = stringAt(input, "name");
            const mimeType = stringAt(input, "mimeType");
            if (name === undefined || mimeType === undefined || typeof size !== "number") {
              return refusal("invalid_attachment");
            }
            try {
              return storage().media.create(name, mimeType, size);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },

          WriteAttachment: (input: unknown, call?: ServedCall) => {
            if (authorOf(call) === undefined) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            const data = stringAt(input, "data");
            const offset = numberAt(input, "offset");
            if (attachmentId === undefined || data === undefined || offset === undefined) {
              return refusal("invalid_media_chunk");
            }
            try {
              return storage().media.write(attachmentId, offset, data);
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
          ReadAttachment: (input: unknown, call?: ServedCall) => {
            const me = authorOf(call);
            if (me === undefined) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            const messageId = stringAt(input, "messageId");
            const offset = numberAt(input, "offset");
            if (attachmentId === undefined || messageId === undefined || offset === undefined) {
              return refusal("invalid_request");
            }
            const conversationId = storage().conversationOfMessage(messageId);
            if (conversationId === undefined) return refusal("no_such_conversation");
            if (!storage().participantsOf(conversationId).includes(me)) {
              return refusal("not_a_participant");
            }
            try {
              return storage().media.readChunk(attachmentId, messageId, offset);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },

          /** Drops an upload nobody sent yet, so a cancelled attachment leaves nothing behind. */
          DeleteAttachment: (input: unknown, call?: ServedCall) => {
            if (authorOf(call) === undefined) return refusal(NO_CALLER);
            const attachmentId = stringAt(input, "attachmentId");
            if (attachmentId === undefined) return refusal("invalid_request");
            try {
              return storage().media.remove(attachmentId);
            } catch (error) {
              return refusal(codeOf(error));
            }
          },

          /** Demanded by the handshake, and by anybody who wants to leave with what they wrote. */
          ExportTenantData: () => storage().exportAll(),
          DeleteTenantData: () => {
            storage().deleteAll();
            return {};
          },
        },
      },

      exportData: () => storage().exportAll(),
      deleteData: () => storage().deleteAll(),
      onShutdown: () => {
        store?.close();
        store = undefined;
      },
    };
  },
});

export default plugin;
