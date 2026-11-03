/**
 * The names this plugin answers to, in a module of their own.
 *
 * Split out of `plugin.ts` so that `automation-triggers.ts` can name the event without importing the
 * plugin that imports it back. `plugin.ts` re-exports all three, which is where callers read them.
 */

export const PLUGIN_ID = "chat.internal";

/** What this plugin SERVES. Its own screen is the main caller; another plugin may call it too. */
export const CHAT = "chat.internal.v1.InternalChat";

/**
 * What this plugin EMITS, on every message stored.
 *
 * The screen listens to this to redraw, and a plugin may only listen to its own topic — the kernel
 * refuses anyone naming somebody else's. So this is both the notification and the live update.
 */
export const MESSAGE_SENT = "chat.internal.v1.MessageSent";

/**
 * The rest of what happens in a chat, announced for the same two reasons.
 *
 * A screen already open needs to learn that a room appeared, that somebody joined or left it, or
 * that a badge dropped — and an automation needs somewhere to start. One event serves both: there is
 * no second, private channel for the screen.
 */
export const GROUP_OPENED = "chat.internal.v1.GroupOpened";
export const GROUP_UPDATED = "chat.internal.v1.GroupUpdated";
export const GROUP_ADMINS_CHANGED = "chat.internal.v1.GroupAdminsChanged";
export const MESSAGE_DELETED = "chat.internal.v1.MessageDeleted";
export const TYPING_CHANGED = "chat.internal.v1.TypingChanged";
export const CONVERSATION_CLEARED = "chat.internal.v1.ConversationCleared";
export const PARTICIPANTS_ADDED = "chat.internal.v1.ParticipantsAdded";
export const PARTICIPANTS_REMOVED = "chat.internal.v1.ParticipantsRemoved";
export const CONVERSATION_READ = "chat.internal.v1.ConversationRead";
export const CONVERSATION_DELIVERED = "chat.internal.v1.ConversationDelivered";
