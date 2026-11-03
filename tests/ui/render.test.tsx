// @vitest-environment jsdom
import type { PluginCall, PluginStream } from "@creativepetabyte/argus-sdk/ui";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TEXT } from "../../shared/limits.js";
import type { Conversation, Message } from "../../ui/src/model";
import { ChatInternoNavigation } from "../../ui/src/navigation";
import { ChatInternoPage } from "../../ui/src/ui";

let root: Root;
let container: HTMLDivElement;
const messages: Message[] = [
  {
    id: "m-12",
    seq: 12,
    conversationId: "group-1",
    authorId: "ana",
    text: "eae",
    at: "2026-11-01T22:14:47.350Z",
    attachments: [],
  },
  {
    id: "m-13",
    seq: 13,
    conversationId: "group-1",
    authorId: "ana",
    text: "aaa",
    at: "2026-11-01T22:15:28.605Z",
    attachments: [],
  },
];
const conversation: Conversation = {
  id: "group-1",
  kind: "group",
  name: "Equipe",
  participants: ["ana", "bruno"],
  admins: ["ana"],
  unread: 0,
  ...(messages[1] === undefined ? {} : { lastMessage: messages[1] }),
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("rendering live chat", () => {
  it("shows a temporary upload bubble, preserves its conversation and replaces it after confirmation", async () => {
    let releaseChunk: (() => void) | undefined;
    let releaseSend: (() => void) | undefined;
    const history: Message[] = [];
    const other: Conversation = { ...conversation, id: "other-group", name: "Outra conversa" };
    const file = new File([new Uint8Array(96 * 1024)], "arquivo.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(file.size) });
    const attachment = { id: "a-upload", name: file.name, mimeType: file.type, size: file.size };
    const call: PluginCall = vi.fn(async (_contract, method, input) => {
      const data = input as Record<string, unknown>;
      switch (method) {
        case "Conversations":
          return { conversations: [conversation, other] };
        case "Colleagues":
          return { colleagues: [] };
        case "Typing":
          return { now: Date.now(), typing: [] };
        case "Messages":
          return { messages: data.conversationId === conversation.id ? history : [] };
        case "CreateAttachment":
          return attachment;
        case "WriteAttachment":
          if (data.offset === 48 * 1024)
            await new Promise<void>((resolve) => {
              releaseChunk = resolve;
            });
          return {};
        case "Send": {
          expect(data.conversationId).toBe(conversation.id);
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
          const message: Message = {
            id: "sent-upload",
            seq: 1,
            conversationId: conversation.id,
            authorId: "bruno",
            text: "",
            at: new Date().toISOString(),
            attachments: [attachment],
          };
          history.push(message);
          return { message };
        }
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "bruno", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    const picker = container.querySelector<HTMLInputElement>(".ci-picker");
    if (!picker) throw new Error("File picker missing");
    Object.defineProperty(picker, "files", { configurable: true, value: [file] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(vi.mocked(call).mock.calls.some((args) => args[1] === "CreateAttachment")).toBe(false);
    await act(async () =>
      container.querySelector(".ci-compose")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector<HTMLProgressElement>(".ci-upload-progress")?.value).toBe(50);
    expect(container.querySelector(".ci-pending")?.textContent).toContain("arquivo.txt");
    const entries = [...container.querySelectorAll<HTMLButtonElement>(".ci-rail .ci-entry")];
    await act(async () => entries[1]?.click());
    expect(container.querySelector(".ci-pending")).toBeNull();
    await act(async () => releaseChunk?.());
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-rail .ci-entry")?.click());
    expect(container.querySelector<HTMLProgressElement>(".ci-upload-progress")?.value).toBe(100);
    expect(container.querySelector(".ci-pending-status")?.textContent).toContain("Confirmando");
    await act(async () => releaseSend?.());
    expect(container.querySelector(".ci-pending")).toBeNull();
    expect(container.querySelectorAll(".ci-file-name")).toHaveLength(1);
    expect(container.querySelector(".ci-file-name")?.textContent).toBe("arquivo.txt");
    expect(container.querySelector('[aria-label="Gravar áudio"]')).not.toBeNull();
  });

  it("replies through the message menu, preserves the draft on cancel and displays the saved quote", async () => {
    const history = structuredClone(messages);
    const call: PluginCall = vi.fn(async (_contract, name, input) => {
      switch (name) {
        case "Conversations":
          return { conversations: [conversation] };
        case "Colleagues":
          return { colleagues: [{ userId: "ana", name: "Ana", role: "owner" }] };
        case "Messages":
          return { messages: structuredClone(history) };
        case "Typing":
          return { now: Date.now(), typing: [] };
        case "Send": {
          const data = input as { text: string; replyToId: string };
          const reply: Message = {
            id: "reply-1",
            seq: 14,
            conversationId: "group-1",
            authorId: "bruno",
            text: data.text,
            at: "2026-11-02T12:00:00Z",
            attachments: [],
            replyTo: { id: data.replyToId, seq: 12, authorId: "ana", text: "eae" },
          };
          history.push(reply);
          return { message: reply };
        }
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "bruno", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    const chooseReply = async () => {
      await act(async () => container.querySelector<HTMLButtonElement>(".ci-message-actions")?.click());
      const option = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (button) => button.textContent === "Responder",
      );
      if (!option) throw new Error("reply option missing");
      await act(async () => option.click());
    };
    await chooseReply();
    expect(container.querySelector(".ci-reply-preview")?.textContent).toContain("Respondendo a Ana");
    const input = container.querySelector<HTMLInputElement>(".ci-compose .ci-field");
    if (!input) throw new Error("input missing");
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Resposta");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Cancelar resposta"]')?.click());
    expect(container.querySelector(".ci-reply-preview")).toBeNull();
    expect(input.value).toBe("Resposta");
    await chooseReply();
    await act(async () =>
      container
        .querySelector<HTMLFormElement>(".ci-compose")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(vi.mocked(call).mock.calls.find((args) => args[1] === "Send")?.[2]).toMatchObject({
      text: "Resposta",
      replyToId: "m-12",
    });
    expect(container.querySelector(".ci-reply-preview")).toBeNull();
    expect(container.querySelector(".ci-quote")?.textContent).toContain("eae");
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-quote")?.click());
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("renders the JSX navigation icon and navigates to the chat with the active route marked", async () => {
    const navigate = vi.fn();
    await act(async () =>
      root.render(
        createElement(ChatInternoNavigation, { navigate, pathname: "/app/plugins/chat-interno", locale: "pt-BR" }),
      ),
    );
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe("/app/plugins/chat-interno");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.querySelectorAll("svg path")).toHaveLength(2);
    await act(async () => link?.click());
    expect(navigate).toHaveBeenCalledWith("plugins/chat-interno");
    await act(async () =>
      root.render(createElement(ChatInternoNavigation, { navigate, pathname: "/app/plugins", locale: "en" })),
    );
    expect(container.querySelector("a")?.textContent).toBe("Internal chat");
    expect(container.querySelector("a")?.hasAttribute("aria-current")).toBe(false);
  });

  it("blocks extra characters with a modal, truncates only the pasted excess and sends at the exact limit", async () => {
    const call: PluginCall = vi.fn(async (_contract, name) => {
      switch (name) {
        case "Conversations":
          return { conversations: [conversation] };
        case "Colleagues":
          return { colleagues: [] };
        case "Messages":
          return { messages: [] };
        case "Typing":
          return { now: Date.now(), typing: [] };
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "ana", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    const input = container.querySelector<HTMLInputElement>(".ci-compose .ci-field");
    if (!input) throw new Error("input missing");
    expect(input.maxLength).toBe(MAX_TEXT);
    const prefix = "a".repeat(MAX_TEXT - 2);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, prefix);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.setSelectionRange(prefix.length, prefix.length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "ABCDE" } });
    await act(async () => input.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe(`${prefix}AB`);
    let modal = container.querySelector<HTMLDialogElement>("dialog[open]");
    expect(modal?.querySelector("h2")?.textContent).toBe("Mensagem muito longa");
    expect([...(modal?.querySelectorAll("dd") ?? [])].map((element) => element.textContent)).toEqual(["4.000", "3"]);
    expect(vi.mocked(call).mock.calls.some((args) => args[1] === "Send")).toBe(false);
    await act(async () => modal?.querySelector<HTMLButtonElement>("button")?.click());
    input.setSelectionRange(MAX_TEXT, MAX_TEXT);
    const extraKey = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(extraKey));
    expect(extraKey.defaultPrevented).toBe(true);
    expect(input.value).toBe(`${prefix}AB`);
    modal = container.querySelector<HTMLDialogElement>("dialog[open]");
    expect(modal).not.toBeNull();
    await act(async () => modal?.querySelector<HTMLButtonElement>("button")?.click());
    input.setSelectionRange(0, 1);
    const replacementKey = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(replacementKey));
    expect(replacementKey.defaultPrevented).toBe(false);
    expect(container.querySelector("dialog[open]")).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLFormElement>(".ci-compose")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(vi.mocked(call).mock.calls.find((args) => args[1] === "Send")?.[2]).toMatchObject({ text: `${prefix}AB` });
    expect(input.value).toBe("");
  });

  it("acknowledges receipt in an unfocused window but only marks read when focus returns", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const call: PluginCall = vi.fn(async (_contract, name) => {
      switch (name) {
        case "Conversations":
          return { conversations: [conversation] };
        case "Colleagues":
          return { colleagues: [] };
        case "Messages":
          return { messages };
        case "Typing":
          return { now: Date.now(), typing: [] };
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "bruno", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkDelivered")).toHaveLength(1);
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkRead")).toHaveLength(0);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkRead")).toHaveLength(1);
  });

  it("updates sent, received and read checks through receipt events without acknowledging in a loop", async () => {
    let delivered = false;
    let read = false;
    const handlers = new Set<Parameters<PluginStream["on"]>[1]>();
    const stream: PluginStream = {
      watch() {},
      on(_topic, handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    };
    const call: PluginCall = vi.fn(async (_contract, name) => {
      switch (name) {
        case "Conversations":
          return { conversations: [conversation] };
        case "Colleagues":
          return { colleagues: [] };
        case "Typing":
          return { now: Date.now(), typing: [] };
        case "Messages":
          return {
            messages: messages.map((message) => ({
              ...message,
              receipts: [
                {
                  userId: "bruno",
                  delivered,
                  read,
                  deliveredAt: delivered ? "2026-11-02T12:00:00Z" : null,
                  readAt: read ? "2026-11-02T12:01:00Z" : null,
                },
              ],
            })),
          };
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, stream, me: "ana", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    expect(container.querySelectorAll('.ci-log [aria-label="Enviada"]')).toHaveLength(2);
    delivered = true;
    await act(async () => {
      for (const handler of handlers)
        handler({ type: "chat.internal.v1.ConversationDelivered", key: "group-1", topics: ["chat.internal"] });
    });
    expect(container.querySelectorAll('.ci-log [aria-label="Recebida por todos"]')).toHaveLength(2);
    read = true;
    await act(async () => {
      for (const handler of handlers)
        handler({ type: "chat.internal.v1.ConversationRead", key: "group-1", topics: ["chat.internal"] });
    });
    expect(container.querySelectorAll(".ci-log .ci-receipt.is-read")).toHaveLength(2);
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkDelivered")).toHaveLength(1);
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkRead")).toHaveLength(1);
  });

  it("opens chat actions on right click, supports keyboard dismissal and confirms deletion", async () => {
    let removed = false;
    const call: PluginCall = vi.fn(async (_contract, name) => {
      switch (name) {
        case "Conversations":
          return { conversations: removed ? [] : [conversation] };
        case "Colleagues":
          return { colleagues: [] };
        case "DeleteConversation":
          removed = true;
          return { deleted: true };
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "ana", locale: "pt-BR" })));
    const row = container.querySelector<HTMLButtonElement>(".ci-entry");
    if (!row) throw new Error("chat row missing");
    const openMenu = async () =>
      act(async () => {
        row.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 30, clientY: 40 }),
        );
      });
    await openMenu();
    expect(container.querySelector(".ci-who")).toBeNull();
    let items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toContain("Sair do grupo");
    await act(async () => items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    await act(async () => items[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await openMenu();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await openMenu();
    items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    await act(async () => items.find((item) => item.textContent === "Apagar conversa")?.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const modal = container.querySelector<HTMLDialogElement>("dialog[open]");
    expect(modal?.querySelector("h2")?.textContent).toBe("Apagar conversa");
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "DeleteConversation")).toHaveLength(0);
    await act(async () => modal?.querySelector<HTMLButtonElement>(".ci-danger")?.click());
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "DeleteConversation")).toHaveLength(1);
    expect(container.querySelector(".ci-entry")).toBeNull();
  });

  it.each(["ana", "bruno"])(
    "shows message actions with the permissions of %s and copies the actual text",
    async (me) => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      const call: PluginCall = vi.fn(async (_contract, name) => {
        switch (name) {
          case "Conversations":
            return { conversations: [conversation] };
          case "Colleagues":
            return { colleagues: [{ userId: "ana", name: "Ana", role: "owner" }] };
          case "Messages":
            return { messages };
          case "Typing":
            return { now: Date.now(), typing: [] };
          default:
            return {};
        }
      });
      await act(async () => root.render(createElement(ChatInternoPage, { call, me, locale: "pt-BR" })));
      await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
      const bubble = container.querySelector<HTMLElement>(".ci-bubble");
      if (!bubble) throw new Error("message missing");
      const openMenu = async () =>
        act(async () => {
          bubble.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 }),
          );
        });
      await openMenu();
      let items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(items.some((item) => item.textContent === "Apagar para todos")).toBe(me === "ana");
      await act(async () => items.find((item) => item.textContent === "Copiar texto")?.click());
      expect(writeText).toHaveBeenCalledWith("eae");
      await openMenu();
      items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      await act(async () => items.find((item) => item.textContent === "Dados da mensagem")?.click());
      const modal = container.querySelector<HTMLDialogElement>("dialog[open]");
      expect(modal?.textContent).toContain("Ana");
      expect(modal?.querySelector("h2")?.textContent).toBe("Dados da mensagem");
    },
  );

  it.each(["Apagar conversa", "Sair do grupo"])(
    "opens a modal and completes %s only after confirming",
    async (label) => {
      let removed = false;
      const method = label === "Apagar conversa" ? "DeleteConversation" : "LeaveGroup";
      const call: PluginCall = vi.fn(async (_contract, name) => {
        switch (name) {
          case "Colleagues":
            return { colleagues: [] };
          case "Conversations":
            return { conversations: removed ? [] : [conversation] };
          case "Messages":
            return { messages };
          case "Typing":
            return { now: Date.now(), typing: [] };
          case "DeleteConversation":
          case "LeaveGroup":
            removed = true;
            return name === "DeleteConversation" ? { deleted: true } : { left: true, participants: ["bruno"] };
          default:
            return {};
        }
      });
      const click = async (scope: ParentNode, text: string) => {
        const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
          (node) => node.textContent?.trim() === text,
        );
        if (!button) throw new Error(`button missing: ${text}`);
        await act(async () => button.click());
      };
      await act(async () =>
        root.render(
          createElement(StrictMode, null, createElement(ChatInternoPage, { call, me: "ana", locale: "pt-BR" })),
        ),
      );
      await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dados do grupo"]')?.click());
      await click(container.querySelector(".ci-details-panel") ?? container, label);
      let modal = container.querySelector<HTMLDialogElement>("dialog[open]");
      expect(modal?.querySelector("h2")?.textContent).toBe(label);
      expect(vi.mocked(call).mock.calls.filter((args) => args[1] === method)).toHaveLength(0);
      await click(modal ?? container, "Cancelar");
      expect(container.querySelector("dialog[open]")).toBeNull();
      await click(container.querySelector(".ci-details-panel") ?? container, label);
      modal = container.querySelector<HTMLDialogElement>("dialog[open]");
      await click(modal ?? container, label);
      expect(vi.mocked(call).mock.calls.filter((args) => args[1] === method)).toEqual([
        ["chat.internal.v1.InternalChat", method, { conversationId: "group-1" }],
      ]);
      expect(container.querySelector(".ci-details-panel")).toBeNull();
      expect(container.querySelector(".ci-who")).toBeNull();
      expect(container.querySelectorAll(".ci-rail .ci-entry")).toHaveLength(0);
    },
  );

  it("keeps native text input responsive while typing notifications wait on the network", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const call: PluginCall = vi.fn(async (_contract, method) => {
      switch (method) {
        case "Colleagues":
          return { colleagues: [] };
        case "Conversations":
          return { conversations: [conversation] };
        case "Messages":
          return { messages };
        case "Typing":
          return { now: Date.now(), typing: [] };
        case "SetTyping":
          await waiting;
          return {};
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "ana", locale: "pt-BR" })));
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    const input = container.querySelector<HTMLInputElement>(".ci-compose .ci-field");
    if (!input) throw new Error("message input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const value of ["o", "ol", "ola", "ola equipe"]) {
      await act(async () => {
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(input.value).toBe(value);
    }
    expect(container.querySelector<HTMLButtonElement>('.ci-compose [type="submit"]')?.disabled).toBe(false);
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "SetTyping")).toHaveLength(1);
    await act(async () => release?.());
  });

  it("only lists conversations and opens a direct chat after choosing someone in New chat", async () => {
    let direct: Conversation | undefined;
    const call: PluginCall = vi.fn(async (_contract, method, input) => {
      switch (method) {
        case "Colleagues":
          return {
            colleagues: [
              { userId: "ana", name: "Ana", role: "owner" },
              { userId: "bruno", name: "Bruno", role: "agent" },
              { userId: "carla", name: "Carla", role: "agent" },
            ],
          };
        case "Conversations":
          return { conversations: direct ? [direct] : [] };
        case "OpenDirect": {
          expect(input).toEqual({ withUserId: "bruno" });
          direct = { id: "direct-1", kind: "direct", participants: ["ana", "bruno"], unread: 0 };
          return { conversation: direct };
        }
        case "Messages":
          return { messages: [] };
        case "Typing":
          return { now: Date.now(), typing: [] };
        default:
          return {};
      }
    });
    await act(async () => root.render(createElement(ChatInternoPage, { call, me: "ana", locale: "pt-BR" })));
    const entries = () => [...container.querySelectorAll(".ci-rail .ci-entry-name")].map((node) => node.textContent);
    const openedCalls = () => vi.mocked(call).mock.calls.filter((args) => args[1] === "OpenDirect");
    expect(entries()).toEqual([]);
    expect(container.textContent).toContain("Clique em Nova conversa");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Nova conversa"]')?.click());
    expect(entries()).toEqual(["Bruno", "Carla"]);
    expect(openedCalls()).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Fechar"]')?.click());
    expect(entries()).toEqual([]);
    expect(openedCalls()).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Nova conversa"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-rail .ci-list .ci-entry")?.click());
    expect(openedCalls()).toHaveLength(1);
    expect(entries()).toEqual(["Bruno"]);
    expect(container.querySelector(".ci-who-name")?.textContent).toBe("Bruno");
  });

  it("renders each message and date once across repeated events and parent renders in StrictMode", async () => {
    const handlers = new Set<Parameters<PluginStream["on"]>[1]>();
    const event = (type: string) => {
      for (const handler of handlers) handler({ type, key: "group-1", topics: ["chat.internal"] });
    };
    const stream: PluginStream = {
      watch() {},
      on(_topic, handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    };
    const call: PluginCall = vi.fn(async (_contract, method) => {
      switch (method) {
        case "Colleagues":
          return {
            colleagues: [
              { userId: "ana", name: "Ana", role: "owner" },
              { userId: "bruno", name: "Bruno", role: "agent" },
            ],
          };
        case "Conversations":
          return { conversations: structuredClone([conversation]) };
        case "Messages":
          return { messages: structuredClone(messages) };
        case "Typing":
          return { now: Date.now(), typing: [] };
        case "MarkRead":
          event("chat.internal.v1.ConversationRead");
          return {};
        default:
          return {};
      }
    });
    const render = () =>
      root.render(
        createElement(StrictMode, null, createElement(ChatInternoPage, { call, stream, me: "ana", locale: "pt-BR" })),
      );
    await act(async () => render());
    await act(async () => container.querySelector<HTMLButtonElement>(".ci-entry")?.click());
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        event("chat.internal.v1.MessageSent");
        event("chat.internal.v1.TypingChanged");
        render();
      });
      expect(container.querySelectorAll(".ci-day")).toHaveLength(1);
      expect([...container.querySelectorAll(".ci-text")].map((node) => node.textContent)).toEqual(["eae", "aaa"]);
    }
    expect(handlers.size).toBe(1);
    expect(vi.mocked(call).mock.calls.filter((args) => args[1] === "MarkRead")).toHaveLength(5);
  });
});
