/**
 * Everything the screen knows and everything it asks of the contract.
 *
 * Kept apart from the drawing so each has one job: this file never decides how anything looks, and
 * the components never decide what a call means.
 */
import type { PluginCall, PluginStream } from "@creativepetabyte/argus-sdk/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT, type Colleague, type Conversation, type Message, refusalIn, TOPIC } from "./model";
import type { Words } from "./words";

/** How long an arriving message stays lit. Long enough to notice, short enough not to nag. */
const LIT_MS = 1400;

interface Options {
  call: PluginCall | undefined;
  stream: PluginStream | undefined;
  words: Words;
}

export interface Chat {
  conversations: Conversation[];
  colleagues: Colleague[];
  directoryOff: boolean;
  openId: string | undefined;
  messages: Message[];
  /** The message that has just arrived, so a change is seen rather than guessed. */
  arrived: string | undefined;
  problem: string | undefined;
  openConversation(conversationId: string): void;
  openDirect(userId: string): Promise<void>;
  openGroup(name: string, memberIds: readonly string[]): Promise<void>;
  send(text: string, attachmentIds?: readonly string[]): Promise<boolean>;
}

export function useChat({ call, stream, words }: Options): Chat {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [directoryOff, setDirectoryOff] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [arrived, setArrived] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const seen = useRef(new Set<string>());

  /** Keeps the refusal, if there was one, and says whether the answer is usable. */
  const accepted = useCallback(
    (answer: unknown): boolean => {
      const said = words.refusalFor(refusalIn(answer));
      setProblem(said);
      return said === undefined;
    },
    [words],
  );

  const loadConversations = useCallback(async () => {
    const answer = await call?.(CHAT, "Conversations", {});
    if (!accepted(answer)) return;
    const list = (answer as { conversations?: Conversation[] } | undefined)?.conversations;
    if (Array.isArray(list)) setConversations(list);
  }, [call, accepted]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const answer = await call?.(CHAT, "Messages", { conversationId });
      if (!accepted(answer)) return;
      const list = (answer as { messages?: Message[] } | undefined)?.messages;
      if (!Array.isArray(list)) return;

      // Light only what this screen had not seen before, so opening a conversation for the first
      // time does not flash every line in it.
      const fresh = seen.current.size === 0 ? undefined : list.find(({ id }) => !seen.current.has(id));
      for (const message of list) seen.current.add(message.id);
      setMessages(list);
      if (fresh !== undefined) {
        setArrived(fresh.id);
        setTimeout(() => setArrived(undefined), LIT_MS);
      }

      const last = list.at(-1);
      if (last === undefined) return;
      await call?.(CHAT, "MarkRead", { conversationId, through: last.seq });
      await loadConversations();
    },
    [call, accepted, loadConversations],
  );

  useEffect(() => {
    void (async () => {
      const answer = await call?.(CHAT, "Colleagues", {});
      const list = (answer as { colleagues?: Colleague[] } | undefined)?.colleagues;
      setColleagues(Array.isArray(list) ? list : []);
      setDirectoryOff((answer as { directory?: string } | undefined)?.directory === "unavailable");
    })();
    void loadConversations();
  }, [call, loadConversations]);

  /** The stream is what keeps this screen current without anybody reloading anything. */
  useEffect(() => {
    if (stream === undefined) return;
    stream.watch([TOPIC]);
    return stream.on(TOPIC, () => {
      void loadConversations();
      if (openId !== undefined) void loadMessages(openId);
    });
  }, [stream, openId, loadConversations, loadMessages]);

  useEffect(() => {
    if (openId !== undefined) void loadMessages(openId);
  }, [openId, loadMessages]);

  const openOne = useCallback(
    async (method: "OpenDirect" | "OpenGroup", input: unknown) => {
      const answer = await call?.(CHAT, method, input);
      if (!accepted(answer)) return;
      const conversation = (answer as { conversation?: Conversation } | undefined)?.conversation;
      await loadConversations();
      if (conversation !== undefined) setOpenId(conversation.id);
    },
    [call, accepted, loadConversations],
  );

  return {
    conversations,
    colleagues,
    directoryOff,
    openId,
    messages,
    arrived,
    problem,
    openConversation: setOpenId,
    openDirect: (userId) => openOne("OpenDirect", { withUserId: userId }),
    openGroup: (name, memberIds) => openOne("OpenGroup", { name, memberIds: [...memberIds] }),
    async send(text, attachmentIds = []) {
      // A file with no words is a message; nothing at all is not.
      if (openId === undefined || (text.trim() === "" && attachmentIds.length === 0)) return false;
      const answer = await call?.(CHAT, "Send", {
        conversationId: openId,
        text,
        attachmentIds: [...attachmentIds],
      });
      if (!accepted(answer)) return false;
      await loadMessages(openId);
      await loadConversations();
      return true;
    },
  };
}
