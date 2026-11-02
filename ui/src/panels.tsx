import type { MediaCall } from "@creativepetabyte/argus-chat-media";
import { useEffect, useRef, useState } from "react";
import { Attachments } from "./attachments";
import { Avatar, ConfirmDialog, Icon } from "./components";
import type { Colleague, Conversation, Message } from "./model";
import { refusalIn } from "./model";
import type { Words } from "./words";

export type PanelView = "info" | "search" | "media";
type GroupMethod =
  | "RenameGroup"
  | "AddMembers"
  | "RemoveMembers"
  | "SetGroupAdmin"
  | "DeleteConversation"
  | "LeaveGroup";

function PanelHeader({ title, words, onClose }: { title: string; words: Words; onClose(): void }) {
  return (
    <header className="ci-panel-head">
      <button type="button" className="ci-icon-button" aria-label={words.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      <h2>{title}</h2>
    </header>
  );
}

export function NewChat({
  colleagues,
  words,
  directoryOff,
  onClose,
  onGroup,
  onOpen,
}: {
  colleagues: Colleague[];
  words: Words;
  directoryOff: boolean;
  onClose(): void;
  onGroup(): void;
  onOpen(id: string): Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const shown = colleagues.filter((person) =>
    person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="ci-group-panel">
      <PanelHeader title={words.newChat} words={words} onClose={onClose} />
      <div className="ci-search">
        <Icon name="search" />
        <input
          ref={field}
          type="search"
          className="ci-search-field"
          placeholder={words.searchMembers}
          aria-label={words.searchMembers}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <button type="button" className="ci-entry ci-panel-action" onClick={onGroup}>
        <span className="ci-action-icon">
          <Icon name="group" />
        </span>
        {words.newGroup}
      </button>
      <p className="ci-section-label">{words.colleagues}</p>
      {problem && (
        <p className="ci-problem" role="alert">
          {words.refusalFor("chat_failed")}
        </p>
      )}
      <div className="ci-list">
        {shown.length === 0 && <p className="ci-quiet">{directoryOff ? words.directoryOff : words.noMatch}</p>}
        {shown.map((person) => (
          <button
            type="button"
            className="ci-entry"
            key={person.userId}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setProblem(false);
              try {
                if (!(await onOpen(person.userId))) setProblem(true);
              } catch {
                setProblem(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Avatar name={person.name} person={person.userId} />
            <span className="ci-entry-text">
              <span className="ci-entry-name">{person.name}</span>
              <span className="ci-entry-last">{person.role}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConversationPanel({
  historyRevision,
  conversation,
  title,
  colleagues,
  me,
  words,
  locale,
  view,
  mediaCall,
  onView,
  onClose,
  onChange,
  onDirect,
  onJump,
}: {
  conversation: Conversation;
  historyRevision: number;
  title: string;
  colleagues: Colleague[];
  me: string | undefined;
  words: Words;
  locale: string;
  view: PanelView;
  mediaCall: MediaCall | undefined;
  onView(view: PanelView): void;
  onClose(): void;
  onChange(method: GroupMethod, input: Record<string, unknown>): Promise<boolean>;
  onDirect(id: string): Promise<boolean>;
  onJump(message: Message, history: Message[]): void;
}) {
  const canManage = conversation.kind === "group" && (conversation.admins?.includes(me ?? "") ?? false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(title);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string>();
  const [closing, setClosing] = useState<"DeleteConversation" | "LeaveGroup">();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (view === "info" && (editing || adding)) field.current?.focus();
  }, [view, editing, adding]);
  const personOf = (id: string) =>
    colleagues.find((person) => person.userId === id) ?? { userId: id, name: id === me ? words.you : id, role: "" };
  const run = async (method: GroupMethod, input: Record<string, unknown>, done: () => void) => {
    setBusy(true);
    setProblem(false);
    try {
      if (await onChange(method, { conversationId: conversation.id, ...input })) done();
      else setProblem(true);
    } catch {
      setProblem(true);
    } finally {
      setBusy(false);
    }
  };
  const matches = (person: Colleague) =>
    `${person.name} ${person.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const candidates = colleagues.filter((person) => !conversation.participants.includes(person.userId));
  return (
    <aside className="ci-details-panel" aria-label={words.conversationDetails}>
      <PanelHeader
        title={
          view === "search"
            ? words.searchMessages
            : view === "media"
              ? words.sharedMedia
              : adding
                ? words.addMembers
                : conversation.kind === "group"
                  ? words.groupInfo
                  : words.contactInfo
        }
        words={words}
        onClose={onClose}
      />
      {problem && (
        <p className="ci-problem" role="alert">
          {words.refusalFor("chat_failed")}
        </p>
      )}
      {view !== "info" ? (
        <HistoryPanel
          revision={historyRevision}
          key={`${conversation.id}:${view}`}
          view={view}
          conversationId={conversation.id}
          mediaCall={mediaCall}
          words={words}
          locale={locale}
          nameOf={(id) => personOf(id).name}
          onBack={() => onView("info")}
          onJump={onJump}
        />
      ) : adding ? (
        <>
          <div className="ci-search">
            <Icon name="search" />
            <input
              ref={field}
              type="search"
              className="ci-search-field"
              aria-label={words.searchMembers}
              placeholder={words.searchMembers}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="ci-list">
            {candidates.filter(matches).map((person) => (
              <button
                type="button"
                key={person.userId}
                className={`ci-entry ci-member${picked.includes(person.userId) ? " is-picked" : ""}`}
                aria-pressed={picked.includes(person.userId)}
                disabled={busy}
                onClick={() =>
                  setPicked((current) =>
                    current.includes(person.userId)
                      ? current.filter((id) => id !== person.userId)
                      : [...current, person.userId],
                  )
                }
              >
                <Avatar name={person.name} person={person.userId} />
                <span className="ci-entry-text">
                  <span className="ci-entry-name">{person.name}</span>
                  <span className="ci-entry-last">{person.role}</span>
                </span>
                <span className="ci-checkbox">{picked.includes(person.userId) && <Icon name="check" />}</span>
              </button>
            ))}
            {candidates.filter(matches).length === 0 && <p className="ci-quiet">{words.noAvailableMembers}</p>}
          </div>
          <footer className="ci-panel-footer">
            <button
              type="button"
              className="ci-plain"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setQuery("");
                setPicked([]);
              }}
            >
              {words.cancel}
            </button>
            <button
              type="button"
              className="ci-go"
              disabled={busy || picked.length === 0}
              onClick={() =>
                void run("AddMembers", { memberIds: picked }, () => {
                  setAdding(false);
                  setPicked([]);
                  setQuery("");
                })
              }
            >
              {busy ? words.saving : words.addSelected.replace("{n}", String(picked.length))}
            </button>
          </footer>
        </>
      ) : (
        <div className="ci-panel-scroll">
          <section className="ci-info-hero">
            <Avatar name={title} person={conversation.id} />
            {editing ? (
              <form
                className="ci-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() && !busy) void run("RenameGroup", { name: name.trim() }, () => setEditing(false));
                }}
              >
                <input
                  ref={field}
                  className="ci-field"
                  aria-label={words.groupName}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  disabled={busy}
                />
                <div className="ci-actions">
                  <button type="button" className="ci-plain" disabled={busy} onClick={() => setEditing(false)}>
                    {words.cancel}
                  </button>
                  <button className="ci-go" type="submit" disabled={busy || !name.trim()}>
                    {words.save}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h3>{title}</h3>
                {canManage && (
                  <button
                    type="button"
                    className="ci-plain ci-edit-name"
                    onClick={() => {
                      setName(title);
                      setEditing(true);
                    }}
                  >
                    {words.editGroupName}
                  </button>
                )}
              </>
            )}
            <p>
              {conversation.kind === "group"
                ? `${words.group} · ${words.people.replace("{n}", String(conversation.participants.length))}`
                : personOf(conversation.participants.find((id) => id !== me) ?? "").role}
            </p>
            {conversation.createdAt && (
              <p className="ci-info-date">
                {words.createdOn.replace(
                  "{date}",
                  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(conversation.createdAt)),
                )}
              </p>
            )}
          </section>
          <section className="ci-info-section">
            <button type="button" className="ci-info-link" onClick={() => onView("media")}>
              <span>{words.sharedMedia}</span>
              <Icon name="next" />
            </button>
            <button type="button" className="ci-info-link" onClick={() => onView("search")}>
              <span>{words.searchMessages}</span>
              <Icon name="search" />
            </button>
          </section>
          <section className="ci-info-section">
            <p className="ci-section-label">{words.people.replace("{n}", String(conversation.participants.length))}</p>
            {canManage && (
              <button
                type="button"
                className="ci-entry ci-panel-action"
                onClick={() => {
                  setQuery("");
                  setAdding(true);
                }}
              >
                <span className="ci-action-icon">
                  <Icon name="group" />
                </span>
                {words.addMembers}
              </button>
            )}
            <div className="ci-search">
              <Icon name="search" />
              <input
                type="search"
                className="ci-search-field"
                placeholder={words.searchMembers}
                aria-label={words.searchMembers}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {conversation.participants
              .map(personOf)
              .filter(matches)
              .map((person) => (
                <div className="ci-participant" key={person.userId}>
                  <button
                    type="button"
                    className="ci-entry"
                    disabled={person.userId === me || busy}
                    title={words.messagePerson}
                    onClick={async () => {
                      setBusy(true);
                      setProblem(false);
                      try {
                        if (!(await onDirect(person.userId))) setProblem(true);
                      } catch {
                        setProblem(true);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Avatar name={person.name} person={person.userId} />
                    <span className="ci-entry-text">
                      <span className="ci-entry-name">{person.userId === me ? words.you : person.name}</span>
                      <span className="ci-entry-last">{person.role}</span>
                    </span>
                  </button>
                  {conversation.admins?.includes(person.userId) && (
                    <span className="ci-creator-badge">{words.groupAdmin}</span>
                  )}
                  {person.userId === conversation.createdBy && (
                    <span className="ci-creator-badge">{words.groupCreator}</span>
                  )}
                  {canManage && person.userId !== "system" && (
                    <details className="ci-person-menu">
                      <summary aria-label={`${words.memberOptions}: ${person.name}`}>...</summary>
                      <div>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            (conversation.admins?.includes(person.userId) &&
                              conversation.admins.filter((id) => id !== "system").length <= 1)
                          }
                          title={words.lastAdminHint}
                          onClick={() =>
                            void run(
                              "SetGroupAdmin",
                              { memberId: person.userId, isAdmin: !conversation.admins?.includes(person.userId) },
                              () => {},
                            )
                          }
                        >
                          {conversation.admins?.includes(person.userId) ? words.dismissAdmin : words.makeAdmin}
                        </button>
                        {person.userId !== me && person.userId !== conversation.createdBy && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              setRemoving(person.userId);
                            }}
                          >
                            {words.removeMember}
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
          </section>
          <section className="ci-info-section">
            {conversation.kind === "group" && (
              <button
                type="button"
                className="ci-info-link ci-danger-text"
                disabled={busy}
                onClick={() => setClosing("LeaveGroup")}
              >
                {words.leaveGroup}
              </button>
            )}
            <button
              type="button"
              className="ci-info-link ci-danger-text"
              disabled={busy}
              onClick={() => setClosing("DeleteConversation")}
            >
              {words.deleteConversation}
            </button>
          </section>
        </div>
      )}
      {(closing || removing) && (
        <ConfirmDialog
          title={
            closing === "LeaveGroup"
              ? words.leaveGroup
              : closing === "DeleteConversation"
                ? words.deleteConversation
                : words.removeMember
          }
          description={
            closing === "LeaveGroup"
              ? words.leaveGroupHint
              : closing === "DeleteConversation"
                ? words.deleteConversationHint
                : words.confirmRemove.replace("{name}", personOf(removing ?? "").name)
          }
          confirmLabel={
            busy
              ? words.saving
              : closing === "LeaveGroup"
                ? words.leaveGroup
                : closing === "DeleteConversation"
                  ? words.deleteConversation
                  : words.removeMember
          }
          cancelLabel={words.cancel}
          busy={busy}
          error={problem ? words.refusalFor("chat_failed") : undefined}
          onCancel={() => {
            setClosing(undefined);
            setRemoving(undefined);
            setProblem(false);
          }}
          onConfirm={() => {
            if (busy) return;
            if (closing) void run(closing, {}, onClose);
            else if (removing) void run("RemoveMembers", { memberIds: [removing] }, () => setRemoving(undefined));
          }}
        />
      )}
    </aside>
  );
}

function HistoryPanel({
  revision,
  view,
  conversationId,
  mediaCall,
  words,
  locale,
  nameOf,
  onBack,
  onJump,
}: {
  view: "search" | "media";
  revision: number;
  conversationId: string;
  mediaCall: MediaCall | undefined;
  words: Words;
  locale: string;
  nameOf(id: string): string;
  onBack(): void;
  onJump(message: Message, history: Message[]): void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"media" | "documents" | "links">("media");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a stream revision invalidates cached history after edits and deletions.
  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        if (!mediaCall) throw new Error("unavailable");
        const answer = await mediaCall("Messages", { conversationId, limit: 200 });
        const list = (answer as { messages?: Message[] })?.messages;
        if (refusalIn(answer) || !Array.isArray(list)) throw new Error("refused");
        if (active) {
          setMessages(list);
          setMore(list.length === 200);
        }
      } catch {
        if (active) setProblem(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, mediaCall, revision]);
  const loadMore = async () => {
    if (!mediaCall || loading) return;
    setLoading(true);
    setProblem(false);
    try {
      const answer = await mediaCall("Messages", { conversationId, limit: 200, before: messages[0]?.seq });
      const list = (answer as { messages?: Message[] })?.messages;
      if (refusalIn(answer) || !Array.isArray(list)) throw new Error("refused");
      setMessages((current) => [...list, ...current]);
      setMore(list.length === 200);
    } catch {
      setProblem(true);
    } finally {
      setLoading(false);
    }
  };
  const needle = query.trim().toLocaleLowerCase();
  const found = [...messages]
    .filter((message) => !message.deletedAt)
    .reverse()
    .filter((message) =>
      view === "search"
        ? needle !== "" && message.text.toLocaleLowerCase().includes(needle)
        : tab === "links"
          ? linksIn(message.text).length > 0
          : message.attachments.some((file) =>
              tab === "media"
                ? /^(image|video|audio)\//.test(file.mimeType)
                : !/^(image|video|audio)\//.test(file.mimeType),
            ),
    );
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <button type="button" className="ci-info-link ci-history-back" onClick={onBack}>
        <Icon name="back" />
        <span>{words.conversationDetails}</span>
      </button>
      {view === "search" ? (
        <div className="ci-search">
          <Icon name="search" />
          <input
            ref={field}
            type="search"
            className="ci-search-field"
            aria-label={words.searchMessages}
            placeholder={words.searchMessages}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : (
        <nav className="ci-filters" aria-label={words.sharedMedia}>
          {(["media", "documents", "links"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={`ci-filter${tab === value ? " is-active" : ""}`}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {words[value]}
            </button>
          ))}
        </nav>
      )}
      <div className="ci-panel-scroll ci-history-results">
        {problem && (
          <p className="ci-problem" role="alert">
            {words.refusalFor("chat_failed")}
          </p>
        )}
        {!loading && !problem && found.length === 0 && (
          <p className="ci-quiet">{view === "search" && !needle ? words.searchHint : words.noResults}</p>
        )}
        {found.map((message) => (
          <article className="ci-history-item" key={message.id}>
            <p className="ci-history-meta">
              <span>{nameOf(message.authorId)}</span>
              <time dateTime={message.at}>{date.format(new Date(message.at))}</time>
            </p>
            {view === "search" ? (
              <button type="button" className="ci-search-result" onClick={() => onJump(message, messages)}>
                {message.text}
              </button>
            ) : tab === "links" ? (
              linksIn(message.text).map((link) => (
                <a className="ci-shared-link" href={link} key={link} target="_blank" rel="noopener noreferrer">
                  {link}
                </a>
              ))
            ) : (
              mediaCall && (
                <div className="ci-files">
                  <Attachments
                    files={message.attachments.filter((file) =>
                      tab === "media"
                        ? /^(image|video|audio)\//.test(file.mimeType)
                        : !/^(image|video|audio)\//.test(file.mimeType),
                    )}
                    messageId={message.id}
                    call={mediaCall}
                    words={words}
                    locale={locale}
                  />
                </div>
              )
            )}
          </article>
        ))}
        {loading && (
          <p className="ci-quiet" role="status">
            {words.loading}
          </p>
        )}
        {more && (
          <button type="button" className="ci-load-more" disabled={loading} onClick={() => void loadMore()}>
            {words.loadOlder}
          </button>
        )}
      </div>
    </>
  );
}

function linksIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"']+/gi) ?? [])];
}
