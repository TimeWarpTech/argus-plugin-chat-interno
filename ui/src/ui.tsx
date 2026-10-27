/**
 * The internal chat's screen: a conversation list beside an open thread, the shape everybody already
 * knows from a messaging app, so nobody has to learn where anything is.
 *
 * It asks its own contract for everything and listens to its own topic to redraw. It never fetches —
 * `call` is the only door, and the kernel decides who the caller is, which is why nothing sent from
 * here carries an author.
 */
import {
  type Attachment,
  MAX_MEDIA_BYTES,
  type MediaCall,
  uploadMedia,
} from "@creativepetabyte/argus-chat-media";
import type { DomNode, PluginHostProps } from "@creativepetabyte/argus-sdk/ui";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Attachments, sizeOf } from "./attachments";
import {
  CHAT,
  type Colleague,
  type Conversation,
  type Day,
  groupByDay,
  hueOf,
  initialsOf,
  type Message,
  otherSideOf,
  previewOf,
  SLOTS,
} from "./model";
import styles from "./style.css?inline";
import { useChat } from "./use-chat";
import { wordsFor, type Words } from "./words";

export const css = styles;

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
  const [query, setQuery] = useState("");

  /**
   * Asking this plugin's own contract, in the shape the media helpers expect.
   *
   * `undefined` before the host hands a `call` down, and the screen simply does not offer files
   * until it has one.
   */
  const mediaCall = useMemo(
    () => (call === undefined ? undefined : (method: string, input: Record<string, unknown>) =>
      call(CHAT, method, input)),
    [call],
  );

  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const nameOf = (userId: string): string =>
    chat.colleagues.find((colleague) => colleague.userId === userId)?.name ?? userId;

  const titleOf = (conversation: Conversation): string =>
    conversation.kind === "group"
      ? (conversation.name ?? words.group)
      : nameOf(otherSideOf(conversation, me));

  /** A group is drawn by its own id, a direct conversation by whoever is on the other side. */
  const faceOf = (conversation: Conversation): string =>
    conversation.kind === "group" ? conversation.id : otherSideOf(conversation, me);

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  const shown = chat.conversations.filter((conversation) => matches(titleOf(conversation)));
  /** Colleagues worth offering: not me, nobody I already have a thread with, matching the search. */
  const spokenTo = new Set(
    chat.conversations
      .filter((conversation) => conversation.kind === "direct")
      .flatMap((conversation) => conversation.participants),
  );
  const offered = chat.colleagues.filter(
    (colleague) => colleague.userId !== me && !spokenTo.has(colleague.userId) && matches(colleague.name),
  );

  const open = chat.conversations.find((conversation) => conversation.id === chat.openId);
  const unreadTotal = chat.conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const days = useMemo(() => groupByDay(chat.messages, locale, words), [chat.messages, locale, words]);

  return (
    <div className="ci">
      <aside className="ci-rail">
        <div className="ci-search">
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

        <div className="ci-list">
          {shown.length === 0 && offered.length === 0 && (
            <p className="ci-quiet">
              {needle !== "" ? words.noMatch : chat.directoryOff ? words.directoryOff : words.startHere}
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
              onOpen={() => chat.openConversation(conversation.id)}
            />
          ))}

          {offered.map((colleague) => (
            <ColleagueRow
              key={colleague.userId}
              colleague={colleague}
              onOpen={() => {
                setQuery("");
                void chat.openDirect(colleague.userId);
              }}
            />
          ))}
        </div>

        <div className="ci-slot">{renderSlot?.(SLOTS.railFooter)}</div>

        <NewGroup
          colleagues={chat.colleagues.filter((colleague) => colleague.userId !== me)}
          words={words}
          onCreate={(name, members) => chat.openGroup(name, members)}
        />
      </aside>

      <section className="ci-thread">
        {open === undefined ? (
          <p className="ci-nothing">{words.pick}</p>
        ) : (
          <>
            <header className="ci-who">
              <Avatar name={titleOf(open)} person={faceOf(open)} size="md" />
              <span className="ci-who-text">
                <span className="ci-who-name">{titleOf(open)}</span>
                <span className="ci-who-meta">
                  {open.kind === "group"
                    ? words.people.replace("{n}", number.format(open.participants.length))
                    : (chat.colleagues.find((colleague) => colleague.userId === otherSideOf(open, me))
                        ?.role ?? "")}
                </span>
              </span>
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
              days={days}
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
              words={words}
              locale={locale}
              mediaCall={mediaCall}
              extra={renderSlot?.(SLOTS.composerActions)}
              onSend={(text, attachmentIds) => chat.send(text, attachmentIds)}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Avatar({
  name,
  person,
  size = "sm",
}: {
  name: string;
  person: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`ci-avatar ci-avatar-${size}`}
      style={{ ["--person" as string]: `${hueOf(person)}` }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
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
}) {
  return (
    <button type="button" className={`ci-entry${open ? " is-open" : ""}`} onClick={onOpen}>
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
                {previewOf(last)}
              </>
            )}
          </span>
          {unread > 0 && <span className="ci-count">{number.format(unread)}</span>}
        </span>
      </span>
    </button>
  );
}

function ColleagueRow({ colleague, onOpen }: { colleague: Colleague; onOpen(): void }) {
  return (
    <button type="button" className="ci-entry is-new" onClick={onOpen}>
      <Avatar name={colleague.name} person={colleague.userId} />
      <span className="ci-entry-text">
        <span className="ci-entry-name">{colleague.name}</span>
        <span className="ci-entry-last">{colleague.role}</span>
      </span>
    </button>
  );
}

function Thread({
  days,
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
  me: string | undefined;
  group: boolean;
  arrived: string | undefined;
  nameOf(userId: string): string;
  time: Intl.DateTimeFormat;
  mediaCall: MediaCall | undefined;
  words: Words;
  locale: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  // Jump to the end whenever the thread grows: a chat is read from the bottom.
  useMemo(() => {
    queueMicrotask(() => bottom.current?.scrollIntoView({ block: "end" }));
  }, [days]);

  return (
    <div className="ci-log">
      {days.map((day) => (
        <div className="ci-day" key={day.key}>
          <p className="ci-date">{day.label}</p>
          {day.runs.map((run) => {
            const mine = run.authorId === me;
            const first = run.messages[0];
            return (
              <div
                className={`ci-run${mine ? " is-mine" : ""}`}
                key={first === undefined ? run.authorId : first.id}
              >
                {/* A name only in a group, and only once per run: in a conversation between two
                    people it is on every line without telling anybody anything. */}
                {group && !mine && <p className="ci-said">{nameOf(run.authorId)}</p>}
                {run.messages.map((message) => (
                  <div className={`ci-bubble${message.id === arrived ? " is-new" : ""}`} key={message.id}>
                    {message.attachments.length > 0 && mediaCall !== undefined && (
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
                    {message.text !== "" && <span className="ci-text">{message.text}</span>}
                    <time className="ci-at" dateTime={message.at}>
                      {time.format(new Date(message.at))}
                    </time>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      <div ref={bottom} />
    </div>
  );
}

function Composer({
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
}) {
  const [draft, setDraft] = useState("");
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

  const nothingToSend = draft.trim() === "" && waiting === undefined;

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
          const text = draft;
          const carried = waiting;
          setDraft("");
          setWaiting(undefined);
          const sent = await onSend(text, carried === undefined ? [] : [carried.id]);
          if (!sent) {
            setDraft(text);
            setWaiting(carried);
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={words.write}
        />
        <button type="submit" className="ci-go" disabled={nothingToSend} aria-label={words.send}>
          {words.send}
        </button>
      </form>
      <p className="ci-note">{words.sizeLimit.replace("{size}", sizeOf(MAX_MEDIA_BYTES, locale))}</p>
    </div>
  );
}

function NewGroup({
  colleagues,
  words,
  onCreate,
}: {
  colleagues: Colleague[];
  words: Words;
  onCreate(name: string, members: readonly string[]): Promise<void>;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  if (!naming) {
    return (
      <button type="button" className="ci-foot" onClick={() => setNaming(true)}>
        {words.newGroup}
      </button>
    );
  }

  return (
    <div className="ci-new-group">
      <input
        className="ci-field"
        placeholder={words.groupName}
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={words.groupName}
      />
      <div className="ci-chips">
        {colleagues.map((colleague) => {
          const on = picked.includes(colleague.userId);
          return (
            <button
              key={colleague.userId}
              type="button"
              className={`ci-chip${on ? " is-picked" : ""}`}
              aria-pressed={on}
              onClick={() =>
                setPicked((current) =>
                  on ? current.filter((id) => id !== colleague.userId) : [...current, colleague.userId],
                )
              }
            >
              {colleague.name}
            </button>
          );
        })}
      </div>
      <div className="ci-actions">
        <button
          type="button"
          className="ci-go"
          disabled={name.trim() === ""}
          onClick={async () => {
            await onCreate(name, picked);
            setNaming(false);
            setName("");
            setPicked([]);
          }}
        >
          {words.create}
        </button>
        <button type="button" className="ci-plain" onClick={() => setNaming(false)}>
          {words.cancel}
        </button>
      </div>
    </div>
  );
}
