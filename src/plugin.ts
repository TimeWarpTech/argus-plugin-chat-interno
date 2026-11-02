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

import { createAutomationProvider } from "@creativepetabyte/argus-automation-nodes";
import {
  definePlugin,
  emitOwnEvents,
  type PluginContext,
  readMembers,
  type ServedCall,
  screens,
} from "@creativepetabyte/argus-sdk";
import { AUTOMATION_NODES, automationActions } from "./automation.js";
import { automationTriggers } from "./automation-triggers.js";
import {
  CHAT,
  CONVERSATION_CLEARED,
  CONVERSATION_DELIVERED,
  CONVERSATION_READ,
  GROUP_ADMINS_CHANGED,
  GROUP_OPENED,
  GROUP_UPDATED,
  MESSAGE_DELETED,
  MESSAGE_SENT,
  PARTICIPANTS_ADDED,
  PARTICIPANTS_REMOVED,
  PLUGIN_ID,
  TYPING_CHANGED,
} from "./events.js";
import { type Message, openStore, type Store, SYSTEM_AUTHOR } from "./store.js";
import { TypingRegistry } from "./typing.js";

// Re-exported because callers and tests have always read them from here.
export { AUTOMATION_NODES } from "./automation.js";
export {
  CHAT,
  CONVERSATION_READ,
  GROUP_OPENED,
  MESSAGE_SENT,
  PARTICIPANTS_ADDED,
  PARTICIPANTS_REMOVED,
  PLUGIN_ID,
} from "./events.js";

const SCREEN_PATH = "chat-interno";

/**
 * The address the operator approved, and the one the browser downloads from.
 *
 * Nothing here hashes it: the RUNTIME pins what this address is serving, just before every
 * handshake — including after a reconnection, which a hash taken at startup cannot do.
 */
const UI_URL = process.env.PLUGIN_UI_URL ?? "http://localhost:4640/ui.js";

/** The name of the export the page is drawn from. A NAME, resolved against the bundle. */
const PAGE_COMPONENT = "ChatInternoPage";

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

/**
 * Why something failed, in full, FOR A LOG AND NOWHERE ELSE.
 *
 * `codeOf` is what a caller gets, and it is deliberately blind: anything that is not already a code
 * becomes `chat_failed`. That is right for an answer and wrong for a log -- an announcement that
 * never left was recorded as `chat_failed` for weeks, which says nothing about a relay that is away,
 * an instance with no id, or a payload the kernel refused. The cause goes to the operator's log; the
 * caller still only ever sees a code.
 */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const plugin = definePlugin({
  id: PLUGIN_ID,
  manifest: {
    serves: [CHAT, AUTOMATION_NODES],
    emits: [
      CONVERSATION_DELIVERED,
      CONVERSATION_CLEARED,
      TYPING_CHANGED,
      MESSAGE_SENT,
      MESSAGE_DELETED,
      GROUP_OPENED,
      GROUP_UPDATED,
      GROUP_ADMINS_CHANGED,
      PARTICIPANTS_ADDED,
      PARTICIPANTS_REMOVED,
      CONVERSATION_READ,
    ],
    requestedScopes: [
      emitOwnEvents(PLUGIN_ID, "Avisar as telas abertas de cada mensagem nova"),
      readMembers("Ver quem trabalha nesta empresa, para você escolher com quem falar"),
    ],
    ...screens({
      url: UI_URL,
      pages: [
        {
          path: SCREEN_PATH,
          title: { "pt-BR": "Chat interno", en: "Internal chat" },
          component: PAGE_COMPONENT,
          rail: { icon: "message-circle" },
        },
      ],
    }),
  },

  create(ctx: PluginContext) {
    /**
     * One store per company, opened here because `create` runs once per company. A `Map` at module
     * scope keyed by company is the leak this project lints for — and the one the previous system
     * shipped.
     */
    let store: Store | undefined;
    const typing = new TypingRegistry();

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

    /**
     * One event out, and never a failed call because of it.
     *
     * The operation is already stored when this runs: a relay that is away must not undo it. The SDK
     * resends on its own, and the screen reloads on its next call.
     */
    const announce = async (type: string, payload: Record<string, unknown>, orderKey: string): Promise<void> => {
      try {
        await ctx.emit(type, payload, { orderKey });
      } catch (error) {
        ctx.log(`could not announce ${type}: ${reasonOf(error)}`);
      }
    };

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
        ctx.log(`could not announce ${MESSAGE_SENT}: ${reasonOf(error)}`);
      }
    };

    /**
     * Named rather than inline, so the automation provider runs THESE methods and not copies.
     *
     * That is the point: a node is a method of this contract called with no caller, so whatever
     * a method refuses a person it refuses an automation too, with no second code path to keep
     * in step.
     */
    const chatMethods = {
      DeleteConversation: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (!me) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        if (!conversationId) return refusal("no_such_conversation");
        try {
          await storage().deleteConversation(conversationId, me);
          await announce(CONVERSATION_CLEARED, { conversationId, userId: me }, conversationId);
          return { deleted: true };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      LeaveGroup: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (!me) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        if (!conversationId) return refusal("no_such_conversation");
        try {
          const participants = await storage().leaveGroup(conversationId, me);
          typing.set(conversationId, me, false);
          await announce(
            PARTICIPANTS_REMOVED,
            { conversationId, memberIds: [me], participants, by: me, at: new Date().toISOString() },
            conversationId,
          );
          return { left: true, participants };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      SetTyping: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (!me) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        const active = asRecord(input).active;
        if (!conversationId || typeof active !== "boolean") return refusal("invalid_typing");
        if (!(await storage().participantsOf(conversationId)).includes(me)) return refusal("not_a_participant");
        const expiresAt = typing.set(conversationId, me, active);
        await announce(TYPING_CHANGED, { conversationId, userId: me, active, expiresAt }, conversationId);
        return { expiresAt };
      },

      Typing: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (!me) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        if (!conversationId) return refusal("no_such_conversation");
        const participants = await storage().participantsOf(conversationId);
        if (!participants.includes(me)) return refusal("not_a_participant");
        const now = Date.now();
        return {
          now,
          typing: typing.list(conversationId, now).filter((person) => participants.includes(person.userId)),
        };
      },

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

      Conversations: async (_input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        return {
          conversations: await storage().conversationsOf(me),
          unread: await storage().unreadFor(me),
        };
      },

      OpenDirect: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const withUserId = stringAt(input, "withUserId");
        if (withUserId === undefined) return refusal("no_such_colleague");
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
      OpenGroup: async (input: unknown, call?: ServedCall) => {
        const name = stringAt(input, "name");
        if (name === undefined) return refusal("empty_name");
        const me = authorOf(call) ?? SYSTEM_AUTHOR;
        try {
          const conversation = await storage().openGroup(name, me, stringsAt(input, "memberIds"));
          await announce(
            GROUP_OPENED,
            {
              conversationId: conversation.id,
              name: conversation.name ?? name,
              createdBy: conversation.createdBy,
              createdAt: conversation.createdAt,
              participants: await storage().participantsOf(conversation.id),
            },
            conversation.id,
          );
          return { conversation };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      /**
       * Who is in a group, after this change. A room's membership has no author to forge.
       *
       * Adding somebody to a room is not writing in it: nothing here records words, so a call
       * with nobody behind it is honest, and `by` says `system` when that is who asked.
       */
      AddMembers: async (input: unknown, call?: ServedCall) => {
        const conversationId = stringAt(input, "conversationId");
        if (conversationId === undefined) return refusal("no_such_conversation");
        const memberIds = stringsAt(input, "memberIds");
        try {
          const participants = await storage().addMembers(conversationId, memberIds, authorOf(call));
          await announce(
            PARTICIPANTS_ADDED,
            {
              conversationId,
              memberIds,
              participants,
              by: authorOf(call) ?? SYSTEM_AUTHOR,
              at: new Date().toISOString(),
            },
            conversationId,
          );
          return { conversationId, participants };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      RemoveMembers: async (input: unknown, call?: ServedCall) => {
        const conversationId = stringAt(input, "conversationId");
        if (conversationId === undefined) return refusal("no_such_conversation");
        const memberIds = stringsAt(input, "memberIds");
        try {
          const participants = await storage().removeMembers(conversationId, memberIds, authorOf(call));
          await announce(
            PARTICIPANTS_REMOVED,
            {
              conversationId,
              memberIds,
              participants,
              by: authorOf(call) ?? SYSTEM_AUTHOR,
              at: new Date().toISOString(),
            },
            conversationId,
          );
          return { conversationId, participants };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      /** A group's name, which belongs to the room and not to whoever typed it. */
      RenameGroup: async (input: unknown, call?: ServedCall) => {
        const conversationId = stringAt(input, "conversationId");
        const name = stringAt(input, "name");
        if (conversationId === undefined) return refusal("no_such_conversation");
        if (name === undefined) return refusal("empty_name");
        try {
          const conversation = await storage().renameGroup(conversationId, name, authorOf(call));
          await announce(GROUP_UPDATED, { conversationId, name: conversation.name }, conversationId);
          return { conversation };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      SetGroupAdmin: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        const memberId = stringAt(input, "memberId");
        const isAdmin = asRecord(input).isAdmin;
        if (!conversationId || !memberId || typeof isAdmin !== "boolean") return refusal("invalid_group_role");
        try {
          const admins = await storage().setGroupAdmin(conversationId, memberId, isAdmin, me);
          await announce(GROUP_ADMINS_CHANGED, { conversationId, memberId, isAdmin, admins, by: me }, conversationId);
          return { conversationId, admins };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      DeleteMessage: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const messageId = stringAt(input, "messageId");
        if (!messageId) return refusal("no_such_message");
        try {
          const message = await storage().deleteMessage(messageId, me);
          await announce(
            MESSAGE_DELETED,
            { conversationId: message.conversationId, messageId, deletedBy: me, deletedAt: message.deletedAt },
            message.id,
          );
          return { message };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      /**
       * Every conversation of THIS company, with no unread count, because nobody is asking.
       *
       * `Conversations` answers a person and refuses a call with no caller; this one answers the
       * company. The data is already scoped to one company by the folder this plugin was given,
       * so there is nothing here a caller could widen.
       */
      ListConversations: async () => ({ conversations: await storage().allConversations() }),

      /**
       * A conversation's messages by id, for a caller that is in no conversation.
       *
       * `Messages` checks that the asker is a participant, and so must refuse a call with
       * nobody behind it. This one cannot check that, and says so in the catalogue: it reads any
       * conversation of the company, which is why it exists for automations and not for people.
       */
      ConversationMessages: async (input: unknown) => {
        const conversationId = stringAt(input, "conversationId");
        if (conversationId === undefined) return refusal("no_such_conversation");
        const before = numberAt(input, "before");
        const limit = numberAt(input, "limit");
        return {
          conversationId,
          messages: await storage().messagesOf(conversationId, {
            ...(before === undefined ? {} : { before }),
            ...(limit === undefined ? {} : { limit }),
          }),
        };
      },

      /**
       * A message the system wrote, which is the one kind of writing nobody has to author.
       *
       * `Send` keeps refusing a call with no caller, and that refusal stays meaningful: this is a
       * different method, with a different author, and the author is a constant. Nothing reads an
       * author from the input -- `authorId` in the parameters is ignored, on purpose -- so an
       * automation can post but cannot post AS anybody.
       */
      SendAsSystem: async (input: unknown) => {
        const conversationId = stringAt(input, "conversationId");
        if (conversationId === undefined) return refusal("no_such_conversation");
        const text = typeof asRecord(input).text === "string" ? (asRecord(input).text as string) : "";
        const messageId = stringAt(input, "messageId");
        try {
          const message = await storage().sendAsSystem({
            conversationId,
            text,
            ...(messageId === undefined ? {} : { messageId }),
          });
          await announceMessage(message, await storage().participantsOf(conversationId));
          return { message };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      Messages: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        if (conversationId === undefined) return refusal("no_such_conversation");
        if (!(await storage().participantsOf(conversationId)).includes(me)) {
          return refusal("not_a_participant");
        }
        const before = numberAt(input, "before");
        const limit = numberAt(input, "limit");
        return {
          messages: await storage().messagesOf(conversationId, {
            userId: me,
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
          const message = await storage().send({
            conversationId,
            authorId: me,
            text,
            attachmentIds,
            ...(messageId === undefined ? {} : { messageId }),
          });
          // Sending is reading, for the sender: their own message must not come back unread.
          await storage().markRead(conversationId, me, message.seq);
          if (typing.list(conversationId).some((person) => person.userId === me)) {
            const expiresAt = typing.set(conversationId, me, false);
            await announce(TYPING_CHANGED, { conversationId, userId: me, active: false, expiresAt }, conversationId);
          }
          await announceMessage(message, await storage().participantsOf(conversationId));
          return { message };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      MarkRead: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        const through = numberAt(input, "through");
        if (conversationId === undefined || through === undefined || !Number.isInteger(through) || through < 0) {
          return refusal("no_such_conversation");
        }
        try {
          const changed = await storage().markRead(conversationId, me, through);
          if (changed)
            await announce(
              CONVERSATION_READ,
              { conversationId, userId: me, through, at: new Date().toISOString() },
              conversationId,
            );
          return { unread: await storage().unreadFor(me) };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      MarkDelivered: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (!me) return refusal(NO_CALLER);
        const conversationId = stringAt(input, "conversationId");
        const through = numberAt(input, "through");
        if (!conversationId || through === undefined || !Number.isInteger(through) || through < 0)
          return refusal("no_such_conversation");
        try {
          const changed = await storage().markDelivered(conversationId, me, through);
          if (changed)
            await announce(
              CONVERSATION_DELIVERED,
              { conversationId, userId: me, through, at: new Date().toISOString() },
              conversationId,
            );
          return { delivered: true };
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      /**
       * Files travel in pieces over this same contract call, never over a URL.
       *
       * `@creativepetabyte/argus-chat-media` fixes the chunk size at 48 KiB so that a piece,
       * base64-encoded, still fits the 100kb a plugin call accepts — and `chat-tickets` already
       * ships this exact shape. Reusing it rather than inventing a second one is the difference
       * between one format and two that disagree about a boundary and corrupt a file.
       */
      CreateAttachment: async (input: unknown, call?: ServedCall) => {
        if (authorOf(call) === undefined) return refusal(NO_CALLER);
        const size = asRecord(input).size;
        const name = stringAt(input, "name");
        const mimeType = stringAt(input, "mimeType");
        if (name === undefined || mimeType === undefined || typeof size !== "number") {
          return refusal("invalid_attachment");
        }
        try {
          return await storage().media.create(name, mimeType, size);
        } catch (error) {
          return refusal(codeOf(error));
        }
      },

      WriteAttachment: async (input: unknown, call?: ServedCall) => {
        if (authorOf(call) === undefined) return refusal(NO_CALLER);
        const attachmentId = stringAt(input, "attachmentId");
        const data = stringAt(input, "data");
        const offset = numberAt(input, "offset");
        if (attachmentId === undefined || data === undefined || offset === undefined) {
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
      ReadAttachment: async (input: unknown, call?: ServedCall) => {
        const me = authorOf(call);
        if (me === undefined) return refusal(NO_CALLER);
        const attachmentId = stringAt(input, "attachmentId");
        const messageId = stringAt(input, "messageId");
        const offset = numberAt(input, "offset");
        if (attachmentId === undefined || messageId === undefined || offset === undefined) {
          return refusal("invalid_request");
        }
        const conversationId = await storage().conversationOfMessage(messageId);
        if (conversationId === undefined) return refusal("no_such_conversation");
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
      DeleteAttachment: async (input: unknown, call?: ServedCall) => {
        if (authorOf(call) === undefined) return refusal(NO_CALLER);
        const attachmentId = stringAt(input, "attachmentId");
        if (attachmentId === undefined) return refusal("invalid_request");
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
      },
    };

    return {
      serves: {
        [CHAT]: chatMethods,
        /**
         * What the automation engine asks for: the catalogue, and a way to run one node.
         *
         * The engine holds no catalogue of its own -- it calls `Catalog` and validates the answer.
         * Everything offered here is declared in `automation.ts`, and only the methods that run with
         * nobody named as the author are: opening, renaming and staffing a room, reading what is in
         * the company's conversations, and writing AS THE SYSTEM. `Send`, `Messages`, `MarkRead`,
         * `OpenDirect` and the attachment methods are not offered, and still refuse.
         */
        [AUTOMATION_NODES]: createAutomationProvider(automationActions, automationTriggers, chatMethods),
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
