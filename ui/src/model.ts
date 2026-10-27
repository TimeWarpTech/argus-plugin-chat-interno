/**
 * What the screen talks about, and the pure functions that shape it.
 *
 * Nothing here touches React or the network, which is why it can be tested with nothing running.
 */
import type { Attachment } from "@creativepetabyte/argus-chat-media";
import type { Words } from "./words";

export const CHAT = "chat.internal.v1.InternalChat";
/** A plugin may only ever listen to its own topic; the kernel refuses anyone naming another's. */
export const TOPIC = "chat.internal";

export interface Colleague {
  userId: string;
  name: string;
  role: string;
}

/**
 * The places inside this screen where ANOTHER plugin may put something.
 *
 * A name has to start with this plugin's id: the shell only hands a page the slots it owns
 * (`ownsSlotName`), which is what stops a plugin from opening a hole in somebody else's screen.
 * Nothing registers these anywhere — a name under our own id simply works, and a contribution
 * arrives as soon as some plugin declares `slot: "chat.internal.composer.actions"` in its manifest.
 *
 * Known limit, worth saying out loud: a contribution is given no context today, so it cannot be
 * told WHICH conversation is open. These three are therefore the places where that does not matter.
 */
export const SLOTS = {
  /** Beside the conversation's name — a badge, a status, a link out. */
  conversationHeader: `${TOPIC}.conversation.header`,
  /** Beside the box where somebody writes — an action that adds to a message. */
  composerActions: `${TOPIC}.composer.actions`,
  /** Under the list of conversations — anything that belongs to the chat as a whole. */
  railFooter: `${TOPIC}.rail.footer`,
} as const;

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  at: string;
  seq: number;
  /** Metadata only. The bytes come piece by piece, over the same contract call. */
  attachments: Attachment[];
}

export interface Conversation {
  id: string;
  kind: "direct" | "group";
  name?: string;
  participants: string[];
  lastMessage?: Message;
  unread: number;
}

/** The code in a refusal, or nothing when the answer was not one. */
export function refusalIn(answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const error = (answer as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

/** Up to two letters: as much as fits in the square, and as much as anybody reads. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A stable colour per person, so a colleague keeps the same square everywhere on the screen.
 *
 * From the user id rather than the name: renaming somebody must not move their colour, and two
 * people who share a first name should not share a square.
 */
export function hueOf(userId: string): number {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

/** Who a conversation is with, from the point of view of the person reading it. */
export function otherSideOf(conversation: Conversation, me: string | undefined): string {
  return conversation.participants.find((participant) => participant !== me) ?? conversation.id;
}

/**
 * The one line that stands for a message in the conversation list.
 *
 * A message may be nothing but a file -- that is how anybody sends a photo -- and then the file's
 * name is what somebody recognises it by. An empty line would say nothing at all.
 */
export function previewOf(message: Message | undefined): string {
  if (message === undefined) return "";
  if (message.text !== "") return message.text;
  return message.attachments.map((file) => file.name).join(", ");
}

/** A run of messages from one person, which is how a thread is read rather than line by line. */
export interface Run {
  authorId: string;
  messages: Message[];
}

export interface Day {
  key: string;
  label: string;
  runs: Run[];
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

/**
 * Groups a thread by day, and within a day by who is speaking.
 *
 * Repeating a name above every single line is the noise that makes a long conversation unreadable,
 * and a date only earns its place when the day actually changes.
 */
export function groupByDay(
  messages: readonly Message[],
  locale: string,
  words: Pick<Words, "today" | "yesterday">,
  now = new Date(),
): Day[] {
  const yesterday = new Date(now.getTime() - 86_400_000);
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const days: Day[] = [];

  for (const message of messages) {
    const when = new Date(message.at);
    const key = when.toDateString();
    let day = days.at(-1);
    if (day === undefined || day.key !== key) {
      day = { key, label: labelFor(when, now, yesterday, words, dayFormat), runs: [] };
      days.push(day);
    }
    const run = day.runs.at(-1);
    if (run !== undefined && run.authorId === message.authorId) run.messages.push(message);
    else day.runs.push({ authorId: message.authorId, messages: [message] });
  }
  return days;
}

function labelFor(
  when: Date,
  now: Date,
  yesterday: Date,
  words: Pick<Words, "today" | "yesterday">,
  format: Intl.DateTimeFormat,
): string {
  if (sameDay(when, now)) return words.today;
  if (sameDay(when, yesterday)) return words.yesterday;
  return format.format(when);
}
