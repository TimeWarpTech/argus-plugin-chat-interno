/**
 * The internal chat's screen: a conversation list beside an open thread, the shape everybody already
 * knows from a messaging app, so nobody has to learn where anything is.
 *
 * It asks its own contract for everything and listens to its own topic to redraw. It never fetches —
 * `call` is the only door, and the kernel decides who the caller is, which is why nothing sent from
 * here carries an author.
 */
import { type Attachment, MAX_MEDIA_BYTES, type MediaCall, uploadMedia } from "@creativepetabyte/argus-chat-media";
import type { DomNode, PluginHostProps } from "@creativepetabyte/argus-sdk/ui";
import { type MouseEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_TEXT } from "../../shared/limits.js";
import { Attachments, sizeOf } from "./attachments";
import { Avatar, ConfirmDialog, Icon, InfoDialog, ReceiptMark } from "./components";
import { fitMessageInsertion } from "./composer-model";
import { ContextMenu, type MenuAction, type MenuPosition } from "./context-menu";
import {
  CHAT,
  type Colleague,
  type Conversation,
  type Day,
  groupByDay,
  type Message,
  otherSideOf,
  previewOf,
  SLOTS,
} from "./model";
import { ConversationPanel, NewChat, type PanelView } from "./panels";
import styles from "./style.css?inline";
import { useChat } from "./use-chat";
import { type Words, wordsFor } from "./words";

export const css = styles;
export { ChatInternoNavigation } from "./navigation";

export function ChatInternoPage({
  call,
  stream,
  me,
  locale = "pt-BR",
  renderSlot,
  // The second parameter says what a slot renders to. The host draws React here, so saying so is
  // what lets a contribution be placed in this tree instead of being cast on every use.
}: PluginHostProps<DomNode, ReactNode>) {
  const words = useMemo(() => wordsFor(locale), [locale]);
  const chat = useChat({ call, stream, words });
  const [conversationMenu, setConversationMenu] = useState<{ conversation: Conversation; position: MenuPosition }>();
  const [conversationAction, setConversationAction] = useState<{
    conversation: Conversation;
    method: "DeleteConversation" | "LeaveGroup";
  }>();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionProblem, setActionProblem] = useState(false);
  const [query, setQuery] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [panel, setPanel] = useState<{ id: string; view: PanelView }>();
  const [focusMessage, setFocusMessage] = useState<string>();
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");

  /**
   * Asking this plugin's own contract, in the shape the media helpers expect.
   *
   * `undefined` before the host hands a `call` down, and the screen simply does not offer files
   * until it has one.
   */
  const mediaCall = useMemo(
    () =>
      call === undefined ? undefined : (method: string, input: Record<string, unknown>) => call(CHAT, method, input),
    [call],
  );

  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const nameOf = (userId: string): string =>
    chat.colleagues.find((colleague) => colleague.userId === userId)?.name ?? userId;

  const titleOf = (conversation: Conversation): string =>
    conversation.kind === "group" ? (conversation.name ?? words.group) : nameOf(otherSideOf(conversation, me));

  /** A group is drawn by its own id, a direct conversation by whoever is on the other side. */
  const faceOf = (conversation: Conversation): string =>
    conversation.kind === "group" ? conversation.id : otherSideOf(conversation, me);

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  const shown = chat.conversations.filter(
    (conversation) =>
      matches(titleOf(conversation)) &&
      (filter !== "unread" || conversation.unread > 0) &&
      (filter !== "groups" || conversation.kind === "group"),
  );
  const open = chat.conversations.find((conversation) => conversation.id === chat.openId);
  const panelView = open?.id === panel?.id ? panel?.view : undefined;
  const typingNames = chat.typing
    .filter((person) => person.userId !== me && open?.participants.includes(person.userId))
    .map((person) => nameOf(person.userId));
  const typingLabel =
    typingNames.length === 0
      ? undefined
      : open?.kind === "direct"
        ? words.typing
        : words.peopleTyping.replace(
            "{names}",
            new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(typingNames),
          );
  const unreadTotal = chat.conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const days = useMemo(() => groupByDay(chat.messages, locale, words), [chat.messages, locale, words]);

  const conversationActions: MenuAction[] = conversationMenu
    ? [
        {
          id: "info",
          label: conversationMenu.conversation.kind === "group" ? words.groupInfo : words.contactInfo,
          icon: "info",
          run: () => {
            if (chat.openId !== conversationMenu.conversation.id)
              chat.openConversation(conversationMenu.conversation.id);
            setPanel({ id: conversationMenu.conversation.id, view: "info" });
          },
        },
        {
          id: "search",
          label: words.searchMessages,
          icon: "search",
          run: () => {
            if (chat.openId !== conversationMenu.conversation.id)
              chat.openConversation(conversationMenu.conversation.id);
            setPanel({ id: conversationMenu.conversation.id, view: "search" });
          },
        },
        ...(chat.openId === conversationMenu.conversation.id
          ? [
              {
                id: "close",
                label: words.closeChat,
                icon: "close" as const,
                run: () => {
                  chat.closeConversation();
                  setPanel(undefined);
                },
              },
            ]
          : []),
        {
          id: "delete",
          label: words.deleteConversation,
          icon: "trash",
          danger: true,
          run: () => {
            setActionProblem(false);
            setConversationAction({ conversation: conversationMenu.conversation, method: "DeleteConversation" });
          },
        },
        ...(conversationMenu.conversation.kind === "group"
          ? [
              {
                id: "leave",
                label: words.leaveGroup,
                icon: "logout" as const,
                danger: true,
                run: () => {
                  setActionProblem(false);
                  setConversationAction({ conversation: conversationMenu.conversation, method: "LeaveGroup" });
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className={`ci${creatingGroup || startingChat ? " is-creating-group" : ""}${panelView ? " has-panel" : ""}`}>
      <aside className="ci-rail">
        {creatingGroup ? (
          <NewGroup
            colleagues={chat.colleagues.filter((colleague) => colleague.userId !== me)}
            directoryOff={chat.directoryOff}
            words={words}
            onCancel={() => setCreatingGroup(false)}
            onCreate={(name, members) => chat.openGroup(name, members)}
          />
        ) : startingChat ? (
          <NewChat
            colleagues={chat.colleagues.filter((person) => person.userId !== me)}
            words={words}
            directoryOff={chat.directoryOff}
            onClose={() => setStartingChat(false)}
            onGroup={() => {
              setStartingChat(false);
              setCreatingGroup(true);
            }}
            onOpen={async (userId) => {
              const opened = await chat.openDirect(userId);
              if (opened) setStartingChat(false);
              return opened;
            }}
          />
        ) : (
          <>
            <header className="ci-rail-head">
              <h1>{words.chats}</h1>
              <div className="ci-toolbar">
                <button
                  type="button"
                  className="ci-icon-button"
                  title={words.newChat}
                  aria-label={words.newChat}
                  onClick={() => setStartingChat(true)}
                >
                  <Icon name="chat" />
                </button>
                <button
                  type="button"
                  className="ci-icon-button"
                  title={words.newGroup}
                  aria-label={words.newGroup}
                  onClick={() => setCreatingGroup(true)}
                >
                  <Icon name="group" />
                </button>
              </div>
            </header>
            <div className="ci-search">
              <Icon name="search" />
              <input
                className="ci-search-field"
                type="search"
                placeholder={words.search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={words.search}
              />
              {unreadTotal > 0 && <span className="ci-total">{number.format(unreadTotal)}</span>}
            </div>

            <nav className="ci-filters" aria-label={words.chatFilters}>
              {(["all", "unread", "groups"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`ci-filter${filter === value ? " is-active" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {words[value]}
                </button>
              ))}
            </nav>
            <div className="ci-list">
              {shown.length === 0 && (
                <p className="ci-quiet">
                  {needle !== ""
                    ? words.noConversationsFound
                    : filter === "unread"
                      ? words.noUnread
                      : filter === "groups"
                        ? words.noGroups
                        : words.startHere}
                </p>
              )}

              {shown.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  name={titleOf(conversation)}
                  face={faceOf(conversation)}
                  last={conversation.lastMessage}
                  mineLast={conversation.lastMessage?.authorId === me}
                  unread={conversation.unread}
                  open={conversation.id === chat.openId}
                  time={time}
                  number={number}
                  words={words}
                  onMenu={(position) => setConversationMenu({ conversation, position })}
                  onOpen={() => chat.openConversation(conversation.id)}
                />
              ))}
            </div>

            <div className="ci-slot">{renderSlot?.(SLOTS.railFooter)}</div>
          </>
        )}
      </aside>

      <section className="ci-thread">
        {open === undefined ? (
          <div className="ci-nothing">
            <div className="ci-empty-icon">
              <Icon name="chat" />
            </div>
            <h2>{words.internalChat}</h2>
            <p>{words.pick}</p>
            <span>{words.emptyHint}</span>
          </div>
        ) : (
          <>
            <header className="ci-who">
              <button
                type="button"
                className="ci-icon-button ci-mobile-back"
                aria-label={words.back}
                onClick={() => chat.closeConversation()}
              >
                <Icon name="back" />
              </button>
              <button
                type="button"
                className="ci-conversation-title"
                aria-label={open.kind === "group" ? words.groupInfo : words.contactInfo}
                aria-expanded={panelView === "info"}
                onClick={() => setPanel({ id: open.id, view: "info" })}
              >
                <Avatar name={titleOf(open)} person={faceOf(open)} size="md" />
                <span className="ci-who-text">
                  <span className="ci-who-name">{titleOf(open)}</span>
                  <span className={`ci-who-meta${typingLabel ? " is-typing" : ""}`} role="status">
                    {typingLabel ??
                      (open.kind === "group"
                        ? words.people.replace("{n}", number.format(open.participants.length))
                        : (chat.colleagues.find((colleague) => colleague.userId === otherSideOf(open, me))?.role ??
                          ""))}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="ci-icon-button"
                aria-label={words.searchMessages}
                title={words.searchMessages}
                onClick={() => setPanel({ id: open.id, view: "search" })}
              >
                <Icon name="search" />
              </button>
              {/* Somebody else's contribution, drawn in its own shadow root and its own error
                  boundary -- a plugin that throws in here takes down its own square, not the chat. */}
              <span className="ci-slot">{renderSlot?.(SLOTS.conversationHeader)}</span>
            </header>

            {chat.problem !== undefined && (
              <p className="ci-problem" role="status">
                {chat.problem}
              </p>
            )}

            <Thread
              key={`thread:${open.id}`}
              canModerate={open.admins?.includes(me ?? "") ?? false}
              onDelete={chat.deleteMessage}
              days={days}
              focusMessage={focusMessage}
              me={me}
              group={open.kind === "group"}
              arrived={chat.arrived}
              nameOf={nameOf}
              time={time}
              mediaCall={mediaCall}
              words={words}
              locale={locale}
            />

            <Composer
              key={`composer:${open.id}`}
              onTyping={chat.setTyping}
              words={words}
              locale={locale}
              mediaCall={mediaCall}
              extra={renderSlot?.(SLOTS.composerActions)}
              onSend={(text, attachmentIds) => chat.send(text, attachmentIds)}
            />
          </>
        )}
      </section>
      {open && panelView && (
        <ConversationPanel
          key={open.id}
          conversation={open}
          historyRevision={chat.revision}
          title={titleOf(open)}
          colleagues={chat.colleagues}
          me={me}
          words={words}
          locale={locale}
          view={panelView}
          mediaCall={mediaCall}
          onView={(view) => setPanel({ id: open.id, view })}
          onClose={() => setPanel(undefined)}
          onChange={chat.changeGroup}
          onDirect={async (userId) => {
            const opened = await chat.openDirect(userId);
            if (opened) setPanel(undefined);
            return opened;
          }}
          onJump={(message, history) => {
            chat.revealHistory(history);
            setFocusMessage(message.id);
            setPanel(undefined);
          }}
        />
      )}
      {conversationMenu && (
        <ContextMenu
          position={conversationMenu.position}
          label={words.conversationActions}
          actions={conversationActions}
          onClose={() => setConversationMenu(undefined)}
        />
      )}
      {conversationAction && (
        <ConfirmDialog
          title={conversationAction.method === "LeaveGroup" ? words.leaveGroup : words.deleteConversation}
          description={conversationAction.method === "LeaveGroup" ? words.leaveGroupHint : words.deleteConversationHint}
          confirmLabel={
            actionBusy
              ? words.saving
              : conversationAction.method === "LeaveGroup"
                ? words.leaveGroup
                : words.deleteConversation
          }
          cancelLabel={words.cancel}
          busy={actionBusy}
          error={actionProblem ? words.refusalFor("chat_failed") : undefined}
          onCancel={() => setConversationAction(undefined)}
          onConfirm={async () => {
            if (actionBusy) return;
            setActionBusy(true);
            setActionProblem(false);
            try {
              if (
                await chat.changeGroup(conversationAction.method, {
                  conversationId: conversationAction.conversation.id,
                })
              )
                setConversationAction(undefined);
              else setActionProblem(true);
            } finally {
              setActionBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ConversationRow({
  name,
  face,
  last,
  mineLast,
  unread,
  open,
  time,
  number,
  words,
  onOpen,
  onMenu,
}: {
  name: string;
  face: string;
  last: Message | undefined;
  mineLast: boolean;
  unread: number;
  open: boolean;
  time: Intl.DateTimeFormat;
  number: Intl.NumberFormat;
  words: Words;
  onOpen(): void;
  onMenu(position: MenuPosition): void;
}) {
  return (
    <div className="ci-conversation-row">
      <button
        type="button"
        className={`ci-entry${open ? " is-open" : ""}`}
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY, source: event.currentTarget });
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            onMenu({ x: bounds.right - 16, y: bounds.top + 16, source: event.currentTarget });
          }
        }}
      >
        <Avatar name={name} person={face} />
        <span className="ci-entry-text">
          <span className="ci-entry-top">
            <span className="ci-entry-name">{name}</span>
            {last !== undefined && <time dateTime={last.at}>{time.format(new Date(last.at))}</time>}
          </span>
          <span className="ci-entry-bottom">
            <span className="ci-entry-last">
              {last !== undefined && (
                <>
                  {mineLast && <span className="ci-entry-mine">{words.you}: </span>}
                  {mineLast && <ReceiptMark message={last} words={words} />}
                  {last.deletedAt ? words.messageDeleted : previewOf(last)}
                </>
              )}
            </span>
            {unread > 0 && <span className="ci-count">{number.format(unread)}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="ci-icon-button ci-row-menu"
        aria-label={words.conversationActions}
        title={words.conversationActions}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onMenu({ x: bounds.right, y: bounds.bottom, source: event.currentTarget });
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

function Thread({
  days,
  canModerate,
  onDelete,
  focusMessage,
  me,
  group,
  arrived,
  nameOf,
  time,
  mediaCall,
  words,
  locale,
}: {
  days: Day[];
  canModerate: boolean;
  onDelete(messageId: string): Promise<boolean>;
  focusMessage: string | undefined;
  me: string | undefined;
  group: boolean;
  arrived: string | undefined;
  nameOf(userId: string): string;
  time: Intl.DateTimeFormat;
  mediaCall: MediaCall | undefined;
  words: Words;
  locale: string;
}) {
  const [messageMenu, setMessageMenu] = useState<{ message: Message; position: MenuPosition }>();
  const [messageInfo, setMessageInfo] = useState<Message>();
  const [copyProblem, setCopyProblem] = useState(false);
  const openMessageMenu = (event: MouseEvent<HTMLElement>, message: Message, atCursor: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMessageMenu({
      message,
      position: {
        x: atCursor ? event.clientX : bounds.right,
        y: atCursor ? event.clientY : bounds.bottom,
        source: event.currentTarget,
      },
    });
  };
  const [deleting, setDeleting] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteTitle = useId();
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  const bottom = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusMessage) focused.current?.scrollIntoView({ block: "center" });
  }, [focusMessage]);
  /**
   * Jump to the end whenever the thread grows: a chat is read from the bottom.
   *
   * An effect, not a memo. A memo body runs DURING render, so the node it scrolled to was the one
   * from the previous paint -- the `queueMicrotask` here was working around exactly that. And the
   * key is the last message, not the whole `days` array: `days` is regrouped when the locale or the
   * wording changes too, and changing language should not yank somebody away from what they were
   * reading further up.
   */
  const lastMessageId = days.at(-1)?.runs.at(-1)?.messages.at(-1)?.id;
  useEffect(() => {
    if (lastMessageId !== undefined) bottom.current?.scrollIntoView({ block: "end" });
  }, [lastMessageId]);

  const currentInfo = messageInfo
    ? (days
        .flatMap((day) => day.runs.flatMap((run) => run.messages))
        .find((message) => message.id === messageInfo.id) ?? messageInfo)
    : undefined;
  const messageActions: MenuAction[] = messageMenu
    ? [
        { id: "info", label: words.messageInfo, icon: "info", run: () => setMessageInfo(messageMenu.message) },
        ...(!messageMenu.message.deletedAt && messageMenu.message.text
          ? [
              {
                id: "copy",
                label: words.copyText,
                icon: "copy" as const,
                run: () => {
                  setCopyProblem(false);
                  if (!navigator.clipboard?.writeText) {
                    setCopyProblem(true);
                    return;
                  }
                  void navigator.clipboard.writeText(messageMenu.message.text).catch(() => setCopyProblem(true));
                },
              },
            ]
          : []),
        ...(!messageMenu.message.deletedAt && (messageMenu.message.authorId === me || canModerate)
          ? [
              {
                id: "delete",
                label: words.deleteForEveryone,
                icon: "trash" as const,
                danger: true,
                run: () => {
                  setDeleteProblem(false);
                  setDeleting(messageMenu.message);
                },
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="ci-log">
      {copyProblem && (
        <p className="ci-problem" role="status">
          {words.copyFailed}
        </p>
      )}
      {days.map((day) => (
        <div className="ci-day" key={day.key}>
          <p className="ci-date">{day.label}</p>
          {day.runs.map((run) => {
            const mine = run.authorId === me;
            const first = run.messages[0];
            return (
              <div className={`ci-run${mine ? " is-mine" : ""}`} key={first === undefined ? run.authorId : first.id}>
                {/* A name only in a group, and only once per run: in a conversation between two
                    people it is on every line without telling anybody anything. */}
                {group && !mine && <p className="ci-said">{nameOf(run.authorId)}</p>}
                {run.messages.map((message) => (
                  <article
                    ref={message.id === focusMessage ? focused : undefined}
                    className={`ci-bubble${message.id === arrived ? " is-new" : ""}${message.id === focusMessage ? " is-found" : ""}`}
                    key={message.id}
                    aria-label={words.messageInfo}
                    onContextMenu={(event) => openMessageMenu(event, message, true)}
                  >
                    <button
                      type="button"
                      className="ci-message-actions"
                      aria-label={words.messageActions}
                      title={words.messageActions}
                      onClick={(event) => openMessageMenu(event, message, false)}
                    >
                      <Icon name="more" />
                    </button>
                    {message.deletedAt && <span className="ci-deleted-message">{words.messageDeleted}</span>}
                    {!message.deletedAt && message.attachments.length > 0 && mediaCall !== undefined && (
                      <span className="ci-files">
                        <Attachments
                          files={message.attachments}
                          messageId={message.id}
                          call={mediaCall}
                          words={words}
                          locale={locale}
                        />
                      </span>
                    )}
                    {!message.deletedAt && message.text !== "" && <span className="ci-text">{message.text}</span>}
                    <time className="ci-at" dateTime={message.at}>
                      {time.format(new Date(message.at))}
                      {mine && <ReceiptMark message={message} words={words} />}
                    </time>
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {messageMenu && (
        <ContextMenu
          position={messageMenu.position}
          label={words.messageActions}
          actions={messageActions}
          onClose={() => setMessageMenu(undefined)}
        />
      )}
      {currentInfo && (
        <InfoDialog
          title={words.messageInfo}
          closeLabel={words.close}
          onClose={() => setMessageInfo(undefined)}
          fields={[
            [words.messageAuthor, nameOf(currentInfo.authorId)],
            [
              words.messageSentAt,
              new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(currentInfo.at),
              ),
            ],
            ...(currentInfo.receipts && !currentInfo.deletedAt
              ? [
                  [
                    words.readBy,
                    currentInfo.receipts
                      .filter((receipt) => receipt.read)
                      .map((receipt) => nameOf(receipt.userId))
                      .join(", ") || words.waitingRead,
                  ] as [string, string],
                  [
                    words.deliveredTo,
                    currentInfo.receipts
                      .filter((receipt) => receipt.delivered)
                      .map((receipt) => nameOf(receipt.userId))
                      .join(", ") || words.waitingRead,
                  ] as [string, string],
                ]
              : []),
            ...(currentInfo.deletedAt ? [[words.messageStatus, words.messageDeleted] as [string, string]] : []),
          ]}
        />
      )}
      <div ref={bottom} />
      <dialog
        ref={dialog}
        className="ci-delete-dialog"
        aria-labelledby={deleteTitle}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(undefined);
        }}
        onClose={() => setDeleting(undefined)}
      >
        <h2 id={deleteTitle}>{words.deleteForEveryone}</h2>
        <p>{words.deleteMessageHint}</p>
        {deleteProblem && (
          <p className="ci-problem" role="alert">
            {words.refusalFor("chat_failed")}
          </p>
        )}
        <div className="ci-actions">
          <button type="button" className="ci-plain" disabled={busy} onClick={() => setDeleting(undefined)}>
            {words.cancel}
          </button>
          <button
            type="button"
            className="ci-go ci-danger"
            disabled={busy}
            onClick={async () => {
              if (!deleting || busy) return;
              setBusy(true);
              try {
                if (await onDelete(deleting.id)) setDeleting(undefined);
                else setDeleteProblem(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? words.saving : words.deleteForEveryone}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Composer({
  onTyping,
  words,
  locale,
  mediaCall,
  extra,
  onSend,
}: {
  words: Words;
  locale: string;
  mediaCall: MediaCall | undefined;
  extra: ReactNode;
  onSend(text: string, attachmentIds: readonly string[]): Promise<boolean>;
  onTyping(active: boolean): void;
}) {
  const draft = useRef("");
  const draftInput = useRef<HTMLInputElement>(null);
  const [draftLength, setDraftLength] = useState(0);
  const [blockedCharacters, setBlockedCharacters] = useState(0);
  const [hasText, setHasText] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(typingTimer.current);
      onTyping(false);
    },
    [onTyping],
  );
  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    onTyping(false);
  };
  const updateDraft = (value: string) => {
    draft.current = value;
    setDraftLength(value.length);
    setHasText(value.trim() !== "");
    clearTimeout(typingTimer.current);
    onTyping(value.trim() !== "");
    if (value.trim() !== "") typingTimer.current = setTimeout(() => onTyping(false), 2500);
  };
  const insertText = (input: HTMLInputElement, inserted: string) => {
    const fitted = fitMessageInsertion(
      input.value,
      input.selectionStart ?? input.value.length,
      input.selectionEnd ?? input.value.length,
      inserted,
    );
    if (fitted.blocked === 0) return false;
    input.value = fitted.value;
    input.setSelectionRange(fitted.caret, fitted.caret);
    updateDraft(fitted.value);
    stopTyping();
    setBlockedCharacters(fitted.blocked);
    return true;
  };
  /** The file already uploaded, waiting for the message that will carry it. */
  const [waiting, setWaiting] = useState<Attachment>();
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);

  /**
   * Uploads as soon as a file is chosen, before anybody presses send.
   *
   * The bytes go in 48 KiB pieces over the contract call, so by the time there is a message to send
   * the file is already on the other side and the message only has to name it.
   */
  const take = async (file: File) => {
    if (mediaCall === undefined) return;
    setProblem(undefined);
    if (file.size > MAX_MEDIA_BYTES) {
      setProblem(words.tooBig);
      return;
    }
    setUploading(true);
    try {
      const attachment = await uploadMedia(mediaCall, {
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      setWaiting(attachment);
    } catch (error) {
      const code = error instanceof Error ? error.message : undefined;
      setProblem(words.refusalFor(code) ?? words.fileFailed);
    } finally {
      setUploading(false);
    }
  };

  const drop = async () => {
    // Tell the other side to forget it, so a cancelled attachment leaves nothing behind.
    if (waiting !== undefined && mediaCall !== undefined) {
      await mediaCall("DeleteAttachment", { attachmentId: waiting.id }).catch(() => {});
    }
    setWaiting(undefined);
  };

  const nothingToSend = !hasText && waiting === undefined;

  return (
    <div className="ci-composer">
      {problem !== undefined && <p className="ci-problem">{problem}</p>}
      {waiting !== undefined && (
        <p className="ci-waiting">
          <span>{words.attached.replace("{name}", waiting.name)}</span>
          <button type="button" className="ci-plain" onClick={() => void drop()}>
            {words.removeFile}
          </button>
        </p>
      )}
      <form
        className="ci-compose"
        onSubmit={async (event) => {
          event.preventDefault();
          if (draft.current.length > MAX_TEXT) {
            setBlockedCharacters(draft.current.length - MAX_TEXT);
            return;
          }
          if (nothingToSend || sending || uploading) return;
          stopTyping();
          const text = draft.current;
          const carried = waiting;
          draft.current = "";
          if (draftInput.current) draftInput.current.value = "";
          setHasText(false);
          setDraftLength(0);
          setWaiting(undefined);
          setSending(true);
          let sent = false;
          try {
            sent = await onSend(text, carried === undefined ? [] : [carried.id]);
          } catch {
            setProblem(words.refusalFor("chat_failed"));
          } finally {
            if (!sent) {
              const restored = draft.current ? `${text}\n${draft.current}` : text;
              draft.current = restored;
              if (draftInput.current) draftInput.current.value = restored;
              setHasText(restored.trim() !== "");
              setDraftLength(restored.length);
              if (restored.length > MAX_TEXT) setBlockedCharacters(restored.length - MAX_TEXT);
              setWaiting(carried);
            }
            setSending(false);
          }
        }}
      >
        {mediaCall !== undefined && (
          <>
            <input
              ref={picker}
              className="ci-picker"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) void take(file);
              }}
              aria-label={words.attach}
            />
            <button
              type="button"
              className="ci-clip"
              title={words.attach}
              aria-label={words.attach}
              disabled={uploading}
              onClick={() => picker.current?.click()}
            >
              {uploading ? "…" : "+"}
            </button>
          </>
        )}
        {/* Where another plugin may add an action of its own, beside the box. */}
        {extra !== undefined && extra !== null && <span className="ci-slot">{extra}</span>}
        <input
          className="ci-field"
          placeholder={uploading ? words.uploading : words.write}
          ref={draftInput}
          defaultValue=""
          onBlur={stopTyping}
          maxLength={MAX_TEXT}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text/plain");
            if (text && insertText(event.currentTarget, text)) event.preventDefault();
          }}
          onBeforeInput={(event) => {
            const data = event.data;
            if (data && !(event.nativeEvent as InputEvent).isComposing && insertText(event.currentTarget, data))
              event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              event.key.length === 1 &&
              !event.nativeEvent.isComposing
            ) {
              const input = event.currentTarget;
              if (
                input.value.length - ((input.selectionEnd ?? 0) - (input.selectionStart ?? 0)) + event.key.length >
                MAX_TEXT
              ) {
                event.preventDefault();
                stopTyping();
                setBlockedCharacters(event.key.length);
              }
            }
          }}
          onChange={(event) => {
            if (draft.current.length > MAX_TEXT && event.target.value.length < draft.current.length) {
              updateDraft(event.target.value);
              return;
            }
            const fitted = fitMessageInsertion("", 0, 0, event.target.value);
            if (fitted.blocked > 0) {
              event.target.value = fitted.value;
              stopTyping();
              setBlockedCharacters(fitted.blocked);
            }
            updateDraft(fitted.value);
          }}
          aria-label={words.write}
        />
        <button
          type="submit"
          className="ci-go"
          disabled={nothingToSend || sending || uploading}
          aria-label={words.send}
        >
          {words.send}
        </button>
      </form>
      {draftLength >= MAX_TEXT - 500 && (
        <p className="ci-text-count">
          {new Intl.NumberFormat(locale).format(draftLength)} / {new Intl.NumberFormat(locale).format(MAX_TEXT)}
        </p>
      )}
      {blockedCharacters > 0 && (
        <InfoDialog
          title={words.textLimitTitle}
          description={words.textLimitHint}
          closeLabel={words.keepEditing}
          fields={[
            [words.textLimit, new Intl.NumberFormat(locale).format(MAX_TEXT)],
            [words.extraCharacters, new Intl.NumberFormat(locale).format(blockedCharacters)],
          ]}
          onClose={() => {
            setBlockedCharacters(0);
            draftInput.current?.focus();
          }}
        />
      )}
      <p className="ci-note">{words.sizeLimit.replace("{size}", sizeOf(MAX_MEDIA_BYTES, locale))}</p>
    </div>
  );
}

function NewGroup({
  colleagues,
  directoryOff,
  words,
  onCancel,
  onCreate,
}: {
  colleagues: Colleague[];
  directoryOff: boolean;
  words: Words;
  onCancel(): void;
  onCreate(name: string, members: readonly string[]): Promise<boolean>;
}) {
  const [step, setStep] = useState<"members" | "name">("members");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const nameId = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "members" || step === "name") field.current?.focus();
  }, [step]);
  const selected = colleagues.filter((person) => picked.includes(person.userId));
  const shown = colleagues.filter((person) =>
    `${person.name} ${person.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <form
      className="ci-group-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || picked.length === 0) return;
        if (step === "members") {
          setStep("name");
          return;
        }
        if (name.trim() === "") return;
        setBusy(true);
        setProblem(false);
        try {
          if (await onCreate(name.trim(), picked)) onCancel();
          else setProblem(true);
        } catch {
          setProblem(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="ci-group-head">
        <button
          type="button"
          className="ci-icon-button"
          aria-label={words.back}
          disabled={busy}
          onClick={() => (step === "name" ? setStep("members") : onCancel())}
        >
          <Icon name="back" />
        </button>
        <div>
          <h2>{step === "members" ? words.addMembers : words.newGroup}</h2>
          <p>{step === "members" ? words.selectMembers : words.groupDetails}</p>
        </div>
      </header>
      {step === "members" ? (
        <>
          {selected.length > 0 && (
            <div className="ci-selected">
              {selected.map((person) => (
                <button
                  type="button"
                  className="ci-selected-person"
                  key={person.userId}
                  onClick={() => toggle(person.userId)}
                  aria-label={`${words.removeMember}: ${person.name}`}
                >
                  <Avatar name={person.name} person={person.userId} />
                  <span>{person.name}</span>
                  <Icon name="close" />
                </button>
              ))}
            </div>
          )}
          <div className="ci-search">
            <Icon name="search" />
            <input
              ref={field}
              className="ci-search-field"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={words.searchMembers}
              aria-label={words.searchMembers}
            />
          </div>
          <p className="ci-section-label">{words.colleagues}</p>
          <div className="ci-list">
            {shown.length === 0 && <p className="ci-quiet">{directoryOff ? words.directoryOff : words.noMatch}</p>}
            {shown.map((person) => (
              <button
                type="button"
                className={`ci-entry ci-member${picked.includes(person.userId) ? " is-picked" : ""}`}
                key={person.userId}
                aria-pressed={picked.includes(person.userId)}
                onClick={() => toggle(person.userId)}
              >
                <Avatar name={person.name} person={person.userId} />
                <span className="ci-entry-text">
                  <span className="ci-entry-name">{person.name}</span>
                  <span className="ci-entry-last">{person.role}</span>
                </span>
                <span className="ci-checkbox">{picked.includes(person.userId) && <Icon name="check" />}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="ci-group-details">
          <div className="ci-group-avatar">
            <Icon name="group" />
          </div>
          <label className="ci-label" htmlFor={nameId}>
            {words.groupName}
          </label>
          <input
            ref={field}
            id={nameId}
            className="ci-field ci-name-field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={words.groupNameHint}
            required
          />
          <p className="ci-group-hint">{words.groupHint}</p>
          <p className="ci-section-label">{words.people.replace("{n}", String(picked.length + 1))}</p>
          <p className="ci-group-hint">{words.includingYou}</p>
          <div className="ci-member-preview">
            {selected.map((person) => (
              <div key={person.userId}>
                <Avatar name={person.name} person={person.userId} />
                <span>{person.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {problem && (
        <p className="ci-problem" role="alert">
          {words.refusalFor("chat_failed")}
        </p>
      )}
      <footer className="ci-group-footer">
        <span>{words.selectedMembers.replace("{n}", String(picked.length))}</span>
        <button
          type="submit"
          className="ci-group-next"
          disabled={busy || picked.length === 0 || (step === "name" && name.trim() === "")}
          aria-label={step === "members" ? words.next : words.create}
          title={step === "members" ? words.next : words.create}
        >
          {busy ? <span className="ci-spinner" /> : <Icon name={step === "members" ? "next" : "check"} />}
        </button>
      </footer>
    </form>
  );
}
