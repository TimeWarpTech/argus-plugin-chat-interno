# Chat interno — an Argus plugin

The people of one company talking to each other, inside the product. Direct conversations and groups,
text, unread marks, and every open screen updating on its own.

It is a plugin and not a part of the kernel for the reason every other one is: a company that does not
want it should not have it, and removing it must not stop the product booting. It keeps its own SQLite
file, asks the kernel for one thing only — the staff directory — and announces every message it stores.

## Files

Text, images, audio, video and any other file, up to 10 MB each.

There is **no upload endpoint and no public URL**. The bytes travel in 48 KiB pieces over the same
authenticated contract call the screen already uses — the shape
`@creativepetabyte/argus-chat-media` defines and `chat-tickets` already ships. A piece, base64
encoded, is 64 KB, which fits inside the 100 KB a plugin call accepts: that number is why the chunk
size is what it is, and it is why this works without a single change to the kernel.

A file lives in two states. **Pending** — uploaded, owned by nobody, swept after a day, and capped at
50 MB per company so an abandoned tab cannot fill a disk. **Bound** — claimed by a message, readable
by whoever may read that message, and deleted with the conversation. Nothing is readable while
pending, so a half-uploaded file is never shown.

`ReadAttachment` takes the message id as well as the file id, and the plugin checks that whoever is
asking is in that conversation. A file id on its own would make every file in the company readable by
anyone who guessed one.

The screen shows an image, a video or an audio player inline, and anything else as a named card that
is fetched when somebody asks for it. A file that claims to be an image and cannot be decoded falls
back to the card rather than leaving a blank.

## Where other plugins can contribute

This screen opens three slots. A plugin may fill one by declaring it in its own manifest — nothing
needs registering here, and nothing needs a change in the product:

```ts
slots: [{ id: "meu.plugin:no-chat", slot: "chat.internal.composer.actions", component: "MinhaAcao" }]
```

| slot | where it lands |
|---|---|
| `chat.internal.conversation.header` | beside the name of the open conversation |
| `chat.internal.composer.actions` | beside the box where somebody writes |
| `chat.internal.rail.footer` | under the list of conversations |

A name must start with this plugin's id — the shell only hands a page the slots it owns, which is what
stops a plugin from opening a hole in somebody else's screen. Each contribution is drawn in its own
shadow root with its own error boundary, so one that throws takes down its own square and not the
chat, and a component in a slot does get `call`, so it can ask its own contract something.

**Known limit:** a contribution is given no context today — it cannot be told which conversation is
open. These three places were chosen because that does not matter in them. A per-message action, the
obvious fourth slot, needs the host to pass slot context and is not possible yet.

## Before it builds anywhere

This plugin needs two workspace packages of the kernel that are **not published yet**:

- `@creativepetabyte/argus-sdk` at a version newer than 0.1.2 — it needs the kernel telling a plugin
  **who made the call**, which landed after that release. The published 0.1.2 types a served method
  as `(input: unknown) => unknown`, with no caller, so this plugin does not compile against it.
- `@creativepetabyte/argus-chat-media` — never published.

Both are wired as `file:../ModuliumChat/...`, so a checkout of the kernel has to sit beside this one,
and the SDK has to be built once (`bun run build` inside `packages/plugin-sdk`). Until those two are
on npm, this repository is not installable on its own — that is a fact about the packages, not about
the plugin.

## Running it

```
npm install
npm run build:ui     # the screen's bundle — the process hashes this exact file
npm run serve-ui     # serves it on 4640, an origin the operator must have approved
PLUGIN_CONNECTION_TOKEN=mdl1.… npm start
```

The token comes from **Plugins → Adicionar plugin** in the product. It already carries the address of
the server that minted it, so there is no `KERNEL_URL` to set beside it. It works once; spending it
installs the plugin for the company that generated it. After the first boot the credentials live under
`data/`, and `npm start` on its own is enough.

Then approve both scopes on the plugin's **Permissões** screen. Both are essential:

| scope | why |
|---|---|
| `events:emit` (its own) | without it every announcement answers 403 and no screen ever updates |
| `kernel.members:read` | a chat that cannot name a single colleague has nobody to talk to |

A revoked scope takes effect when the grant renews, about ten seconds. Switching the plugin off is
immediate.

### Environment

| variable | default | what it is |
|---|---|---|
| `PLUGIN_CONNECTION_TOKEN` | — | the one-use token, only on the first boot |
| `PLUGIN_DATA_DIR` | `data` | where credentials, the outbox and the SQLite file live |
| `PLUGIN_UI_URL` | `http://localhost:4640/ui.js` | where the browser fetches the screen |
| `PLUGIN_UI_PORT` | `4640` | the port `serve-ui` listens on |

The process and the bundle server must read the **same bytes**: the manifest pins the bundle by
`integrity`, so a screen built after the process started is refused by the kernel. Build first, then
start both. With no bundle at all the plugin still installs and still works through its contract — it
simply declares no page, because a named component with nothing behind it is a blank region.

## The contract it serves

`chat.internal.v1.InternalChat`. Every method takes `unknown` and validates; every refusal is a code
(`no_caller`, `not_a_participant`, `empty_message`…) that the screen translates, never a sentence.

| method | caller needed | what it does |
|---|---|---|
| `Colleagues` | yes | the staff directory, or `{ colleagues: [], directory: "unavailable" }` |
| `CreateAttachment` / `WriteAttachment` | yes | reserves a file, then takes it 48 KiB at a time |
| `ReadAttachment` | yes | one piece of a file, if the caller is in its conversation |
| `DeleteAttachment` | yes | drops an upload nobody sent |
| `Conversations` | yes | this person's conversations, newest first, with unread counts |
| `OpenDirect` | yes | the one conversation for a pair, whichever side opens it |
| `OpenGroup` | no | a room; another plugin may open one with nobody behind the call |
| `Messages` | yes | a page of a conversation the caller is in |
| `Send` | yes | stores a message, with its files, and announces it |
| `MarkRead` | yes | moves this person's read mark forward, never back |
| `ExportTenantData` / `DeleteTenantData` | — | demanded by the handshake |

**The author is whoever the kernel named**, taken from the call and never from the input. An input
claiming an author is ignored — that is the hole the kernel closed when it started telling a plugin who
made the call, and it is why this plugin needs a kernel newer than SDK 0.1.2.

`OpenGroup` is the one thing a call with nobody behind it may do: an automation opening a shift channel
has no person to name, and opening a room forges nobody's words. Writing in it still demands a caller.

## What it emits

`chat.internal.v1.MessageSent`, on every message stored, ordered by conversation. The screen listens to
this plugin's own topic to redraw — a plugin may only ever listen to its own; the kernel refuses anyone
naming somebody else's. So the same event is both the live update and the notification.

An announcement that cannot be handed over does not fail the send: the message is already stored, the
SDK resends on its own, and the screen catches up on its next call.

## Storage

Its own SQLite file under `PLUGIN_DATA_DIR`, files included, not `ctx.store`: a chat is listed, paginated and counted,
and a key-value bucket would mean reading every conversation to draw one screen. With no data directory
it runs in memory and says so in the log, rather than inventing a path that promises durability.

Messages are ordered by a growing `seq`, never by timestamp — two in the same millisecond would be a
coin toss. A direct conversation is keyed by the sorted pair, so opening it from either side lands in
the same history.

## Tests

```
npm test              # 50, with nothing installed: no kernel, no database, no network
npx tsc -p tsconfig.json
```

The suite includes `runPluginConformance`, which is the gate: idempotence, degradation, undeclared
events, company isolation, export and deletion. A plugin that fails it is not finished, however green
its own tests are.
