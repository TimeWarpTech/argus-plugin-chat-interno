/**
 * Everything the screen knows and everything it asks of the contract.
 *
 * Kept apart from the drawing so each has one job: this file never decides how anything looks, and
 * the components never decide what a call means.
 */
import type { PluginCall, PluginStream } from "@creativepetabyte/argus-sdk/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT, type Colleague, type Conversation, type Message, redactRepliesTo, refusalIn, TOPIC } from "./model";
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
  revision: number;
  typing: { userId: string; expiresAt: number }[];
  setTyping(active: boolean): void;
  colleagues: Colleague[];
  directoryOff: boolean;
  openId: string | undefined;
  messages: Message[];
  /** The message that has just arrived, so a change is seen rather than guessed. */
  arrived: string | undefined;
  problem: string | undefined;
  openConversation(conversationId: string): void;
  closeConversation(): void;
  openDirect(userId: string): Promise<boolean>;
  openGroup(name: string, memberIds: readonly string[]): Promise<boolean>;
  changeGroup(
    method: "RenameGroup" | "AddMembers" | "RemoveMembers" | "SetGroupAdmin" | "DeleteConversation" | "LeaveGroup",
    input: Record<string, unknown>,
  ): Promise<boolean>;
  revealHistory(messages: Message[]): void;
  deleteMessage(messageId: string): Promise<boolean>;
  send(text: string, attachmentIds?: readonly string[], replyToId?: string, conversationId?: string): Promise<boolean>;
  loadReply(messageId: string): Promise<boolean>;
}

export function useChat({ call, stream, words }: Options): Chat {
  const [typing, setTypingPeople] = useState<{ userId: string; expiresAt: number }[]>([]);
  const [revision, setRevision] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [directoryOff, setDirectoryOff] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [arrived, setArrived] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const seen = useRef(new Set<string>());
  const currentConversation = useRef<string | undefined>(undefined);
  const messageRequest = useRef(0);
  const conversationRequest = useRef(0);

  const typingSent = useRef<{ id: string; active: boolean; at: number } | undefined>(undefined);
  const typingQueue = useRef<Promise<unknown>>(Promise.resolve());
  const typingRequest = useRef(0);
  const loadTyping = useCallback(
    async (conversationId: string) => {
      const request = ++typingRequest.current;
      try {
        const answer = await call?.(CHAT, "Typing", { conversationId });
        const data = answer as { now?: number; typing?: { userId: string; expiresAt: number }[] } | undefined;
        if (request !== typingRequest.current || currentConversation.current !== conversationId) return;
        if (!data || !Array.isArray(data.typing) || typeof data.now !== "number") return;
        const now = Date.now();
        const serverNow = data.now;
        setTypingPeople(
          data.typing.map((person) => ({
            userId: person.userId,
            expiresAt: now + Math.max(0, Math.min(6000, person.expiresAt - serverNow)),
          })),
        );
      } catch {
        /* A missing activity signal must not interrupt a conversation. */
      }
    },
    [call],
  );
  const setTyping = useCallback(
    (active: boolean) => {
      if (!call || !openId) return;
      const now = Date.now();
      const last = typingSent.current;
      if (last?.id === openId && last.active === active && (!active || now - last.at < 2000)) return;
      typingSent.current = { id: openId, active, at: now };
      typingQueue.current = typingQueue.current
        .catch(() => {})
        .then(() => call(CHAT, "SetTyping", { conversationId: openId, active }))
        .catch(() => {});
    },
    [call, openId],
  );
  useEffect(() => {
    if (openId) void loadTyping(openId);
  }, [openId, loadTyping]);
  useEffect(() => {
    if (typing.length === 0) return;
    const timer = setTimeout(
      () => setTypingPeople((current) => current.filter((person) => person.expiresAt > Date.now())),
      Math.max(0, Math.min(...typing.map((person) => person.expiresAt)) - Date.now()) + 25,
    );
    return () => clearTimeout(timer);
  }, [typing]);

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
    const request = ++conversationRequest.current;
    const answer = await call?.(CHAT, "Conversations", {});
    if (request !== conversationRequest.current) return;
    if (!accepted(answer)) return;
    const list = (answer as { conversations?: Conversation[] } | undefined)?.conversations;
    if (Array.isArray(list)) {
      setConversations(list);
      if (
        currentConversation.current &&
        !list.some((conversation) => conversation.id === currentConversation.current)
      ) {
        currentConversation.current = undefined;
        setOpenId(undefined);
        setMessages([]);
        setTypingPeople([]);
      }
    }
  }, [call, accepted]);

  const loadMessages = useCallback(
    async (conversationId: string, replace = false, acknowledge = true) => {
      const request = ++messageRequest.current;
      const answer = await call?.(CHAT, "Messages", { conversationId });
      if (request !== messageRequest.current || currentConversation.current !== conversationId) return;
      if (!accepted(answer)) return;
      const list = (answer as { messages?: Message[] } | undefined)?.messages;
      if (!Array.isArray(list)) return;
      if (currentConversation.current !== conversationId) return;

      // Light only what this screen had not seen before, so opening a conversation for the first
      // time does not flash every line in it.
      const fresh = seen.current.size === 0 ? undefined : list.find(({ id }) => !seen.current.has(id));
      for (const message of list) seen.current.add(message.id);
      setMessages((current) => {
        const previous = replace ? [] : current.filter((message) => message.conversationId === conversationId);
        return [...new Map([...previous, ...list].map((message) => [message.id, message])).values()].sort(
          (a, b) => a.seq - b.seq,
        );
      });
      if (fresh !== undefined) {
        setArrived(fresh.id);
        setTimeout(() => setArrived(undefined), LIT_MS);
      }

      const last = list.at(-1);
      if (last === undefined || !acknowledge) return;
      await call?.(CHAT, "MarkDelivered", { conversationId, through: last.seq });
      if (currentConversation.current !== conversationId) return;
      if (document.visibilityState === "visible" && document.hasFocus())
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
    return stream.on(TOPIC, (event) => {
      if (event.type === "chat.internal.v1.TypingChanged") {
        if (openId && event.key === openId) void loadTyping(openId);
        return;
      }
      if (
        event.type === "chat.internal.v1.ConversationRead" ||
        event.type === "chat.internal.v1.ConversationDelivered"
      ) {
        void loadConversations();
        if (openId && event.key === openId) void loadMessages(openId, false, false);
        return;
      }
      setRevision((value) => value + 1);
      if (event.type === "chat.internal.v1.MessageDeleted") {
        setMessages((current) =>
          redactRepliesTo(
            current.map((message) =>
              message.id === event.key
                ? { ...message, text: "", attachments: [], deletedAt: new Date().toISOString() }
                : message,
            ),
            event.key,
          ),
        );
      }
      void loadConversations();
      if (openId !== undefined) void loadMessages(openId, event.type === "chat.internal.v1.ConversationCleared");
    });
  }, [stream, openId, loadConversations, loadMessages, loadTyping]);

  useEffect(() => {
    if (openId !== undefined) void loadMessages(openId);
  }, [openId, loadMessages]);

  useEffect(() => {
    if (!openId) return;
    const visible = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) void loadMessages(openId);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [openId, loadMessages]);

  const openOne = useCallback(
    async (method: "OpenDirect" | "OpenGroup", input: unknown) => {
      const answer = await call?.(CHAT, method, input);
      if (!accepted(answer)) return false;
      const conversation = (answer as { conversation?: Conversation } | undefined)?.conversation;
      await loadConversations();
      if (conversation === undefined) return false;
      currentConversation.current = conversation.id;
      setMessages([]);
      setTypingPeople([]);
      seen.current.clear();
      setOpenId(conversation.id);
      return true;
    },
    [call, accepted, loadConversations],
  );

  return {
    conversations,
    revision,
    typing,
    setTyping,
    colleagues,
    directoryOff,
    openId,
    messages,
    arrived,
    problem,
    openConversation: (id) => {
      currentConversation.current = id;
      setMessages([]);
      setTypingPeople([]);
      seen.current.clear();
      setOpenId(id);
    },
    closeConversation: () => {
      currentConversation.current = undefined;
      setOpenId(undefined);
      setMessages([]);
      setTypingPeople([]);
    },
    openDirect: (userId) => openOne("OpenDirect", { withUserId: userId }),
    openGroup: (name, memberIds) => openOne("OpenGroup", { name, memberIds: [...memberIds] }),
    revealHistory: (history) =>
      setMessages((current) =>
        [...new Map([...history, ...current].map((message) => [message.id, message])).values()].sort(
          (a, b) => a.seq - b.seq,
        ),
      ),
    async changeGroup(method, input) {
      if (!call) return false;
      try {
        const answer = await call(CHAT, method, input);
        if (!answer || !accepted(answer)) return false;
        if (
          (method === "DeleteConversation" || method === "LeaveGroup") &&
          currentConversation.current === input.conversationId
        ) {
          currentConversation.current = undefined;
          setOpenId(undefined);
          setMessages([]);
          setTypingPeople([]);
        }
        await loadConversations();
        return true;
      } catch {
        setProblem(words.refusalFor("chat_failed"));
        return false;
      }
    },
    async deleteMessage(messageId) {
      if (!call) return false;
      try {
        const answer = await call(CHAT, "DeleteMessage", { messageId });
        if (!accepted(answer)) return false;
        const message = (answer as { message?: Message })?.message;
        if (!message) return false;
        setMessages((current) =>
          redactRepliesTo(
            current.map((item) => (item.id === message.id ? message : item)),
            message.id,
          ),
        );
        setRevision((value) => value + 1);
        await loadConversations();
        return true;
      } catch {
        setProblem(words.refusalFor("chat_failed"));
        return false;
      }
    },
    async loadReply(messageId) {
      const id = currentConversation.current;
      if (!call || !id) return false;
      let history = messages;
      while (!history.some((message) => message.id === messageId)) {
        const oldest = history[0]?.seq;
        const answer = await call(CHAT, "Messages", {
          conversationId: id,
          limit: 200,
          ...(oldest === undefined ? {} : { before: oldest }),
        });
        if (currentConversation.current !== id || !accepted(answer)) return false;
        const page = (answer as { messages?: Message[] })?.messages;
        if (!Array.isArray(page) || page.length === 0) {
          setProblem(words.replyUnavailable);
          return false;
        }
        if (oldest !== undefined && (page[0]?.seq ?? oldest) >= oldest) return false;
        history = [...page, ...history];
      }
      setMessages((current) =>
        [...new Map([...history, ...current].map((message) => [message.id, message])).values()].sort(
          (a, b) => a.seq - b.seq,
        ),
      );
      return true;
    },
    async send(text, attachmentIds = [], replyToId, conversationId = openId) {
      // A file with no words is a message; nothing at all is not.
      if (conversationId === undefined || (text.trim() === "" && attachmentIds.length === 0)) return false;
      const answer = await call?.(CHAT, "Send", {
        conversationId,
        text,
        attachmentIds: [...attachmentIds],
        ...(replyToId === undefined ? {} : { replyToId }),
      });
      if (!accepted(answer)) return false;
      const message = (answer as { message?: Message } | undefined)?.message;
      if (message && currentConversation.current === conversationId) {
        setMessages((current) =>
          [...new Map([...current, message].map((item) => [item.id, item])).values()].sort((a, b) => a.seq - b.seq),
        );
      }
      // A failed refresh after Send succeeded must never turn a confirmed message into a retry.
      await Promise.allSettled([loadMessages(conversationId), loadConversations()]);
      return true;
    },
  };
}
