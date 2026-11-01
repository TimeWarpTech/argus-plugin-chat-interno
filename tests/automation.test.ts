/**
 * What this plugin offers the automation engine, and — more importantly — what it refuses to offer.
 *
 * Runs with nothing installed: no kernel, no engine, no network. A catalogue is data, and an
 * automation run is a contract call with nobody behind it, which is exactly what a test can make.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextFor, type Host } from "@creativepetabyte/argus-sdk";
import { createFakeHost, type FakeHost } from "@creativepetabyte/argus-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, {
  AUTOMATION_NODES,
  CHAT,
  CONVERSATION_READ,
  GROUP_OPENED,
  MESSAGE_SENT,
  PARTICIPANTS_ADDED,
  PARTICIPANTS_REMOVED,
} from "../src/plugin.js";

let folders: string[] = [];
let opened: { onShutdown?(): Promise<void> | void }[] = [];

beforeEach(() => {
  folders = [];
  opened = [];
});

afterEach(async () => {
  for (const company of opened) await company.onShutdown?.();
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "chat-interno-automation-"));
  folders.push(made);
  return made;
}

/** One company's plugin, built the way the runtime builds it. */
function nodes(host: Host = createFakeHost()) {
  // `contextFor(host, instance, dataDir, log)`: the third argument is the FOLDER. Handing it an
  // object leaves the store with no directory, and every call then answers `chat_failed`.
  const ctx = contextFor(
    host,
    { instanceId: "chat.internal:empresa-a", instanceToken: "token-empresa-a" },
    folder(),
    () => {},
  );
  const company = plugin.create(ctx);
  opened.push(company);
  const provider = company.serves?.[AUTOMATION_NODES];
  if (provider === undefined) throw new Error("this plugin serves no node contract");
  return provider as { Catalog: () => unknown; Execute: (input: unknown) => Promise<unknown> };
}

/** An automation has nobody behind it: the call carries no caller, and that is the point. */
const asAutomation = (node: string, parameters: Record<string, unknown>) => ({ node, parameters });

describe("the catalogue this plugin publishes", () => {
  it("speaks the node protocol and offers a group node", async () => {
    const catalog = nodes().Catalog() as {
      protocol: string;
      nodes: { id: string }[];
      triggers: { type: string }[];
    };
    expect(catalog.protocol).toBe("automation-nodes.v1");
    expect(catalog.nodes.map((node) => node.id)).toContain("chat.group.open");
  });

  it("offers the message it already emits as a trigger", async () => {
    const catalog = nodes().Catalog() as { triggers: { type: string; example: unknown }[] };
    const trigger = catalog.triggers.find((entry) => entry.type === MESSAGE_SENT);
    expect(trigger).toBeDefined();
    // The example is what the editor shows as the available input, so it has to carry the real shape.
    expect(trigger?.example).toMatchObject({ conversationId: expect.any(String), text: expect.any(String) });
  });
});

describe("running a node as an automation", () => {
  it("opens a group with nobody as the author", async () => {
    const provider = nodes();
    const opened = (await provider.Execute(asAutomation("chat.group.open", { name: "Plantão" }))) as {
      conversation?: { id: string; title?: string };
    };
    expect(opened.conversation?.id).toBeTruthy();
  });

  /**
   * The guard that matters, and the reason this file exists.
   *
   * Eleven of this plugin's twelve methods refuse a call with no caller, on purpose: an automation
   * must not write as whoever happened to configure it. Only `OpenGroup` may run that way, because
   * opening a room forges nobody's words. Offering any other method as a node would publish a node
   * that the editor lists, the person wires up, and the run refuses with `no_caller` — a failure
   * discovered in production, by somebody whose flow silently never worked.
   */
  it("offers no node that its own methods would refuse for having no author", async () => {
    const provider = nodes();
    const catalog = provider.Catalog() as { nodes: { id: string; example: unknown }[] };
    for (const node of catalog.nodes) {
      const parameters = typeof node.example === "object" && node.example !== null ? node.example : {};
      const answer = (await provider.Execute(asAutomation(node.id, parameters as Record<string, unknown>))) as {
        error?: string;
      };
      expect(answer.error, `node ${node.id} was refused for having no author`).not.toBe("no_caller");
    }
  });
});

/** The same company, with the host kept, for the tests that look at what went out on the wire. */
function company(host: FakeHost = createFakeHost()) {
  const ctx = contextFor(
    host,
    { instanceId: "chat.internal:empresa-a", instanceToken: "token-empresa-a" },
    folder(),
    () => {},
  );
  const built = plugin.create(ctx);
  opened.push(built);
  const provider = built.serves?.[AUTOMATION_NODES] as {
    Catalog: () => unknown;
    Execute: (input: unknown) => Promise<unknown>;
  };
  const chat = built.serves?.[CHAT] as Record<
    string,
    (input: unknown, call?: { caller?: { userId: string; role: string } }) => Promise<unknown>
  >;
  return { provider, chat, host };
}

/** A group to act on, opened the way an automation opens one. */
async function groupOf(provider: { Execute: (input: unknown) => Promise<unknown> }, name = "Plantão") {
  const opened = (await provider.Execute(asAutomation("chat.group.open", { name, memberIds: ["ana"] }))) as {
    conversation: { id: string };
  };
  return opened.conversation.id;
}

describe("the nodes that manage a group", () => {
  it("offers every group and conversation node the engine can run with no author", () => {
    const catalog = company().provider.Catalog() as { nodes: { id: string }[] };
    expect(catalog.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "chat.group.open",
        "chat.group.rename",
        "chat.group.members.add",
        "chat.group.members.remove",
        "chat.conversations.list",
        "chat.conversation.messages",
        "chat.message.system",
      ]),
    );
  });

  it("adds and removes members, and says who is in the room afterwards", async () => {
    const { provider } = company();
    const conversationId = await groupOf(provider);

    const added = (await provider.Execute(
      asAutomation("chat.group.members.add", { conversationId, memberIds: ["bruno", "carla"] }),
    )) as { participants: string[] };
    expect(added.participants).toEqual(expect.arrayContaining(["ana", "bruno", "carla"]));

    const removed = (await provider.Execute(
      asAutomation("chat.group.members.remove", { conversationId, memberIds: ["carla"] }),
    )) as { participants: string[] };
    expect(removed.participants).not.toContain("carla");
  });

  it("renames a group", async () => {
    const { provider } = company();
    const conversationId = await groupOf(provider);
    const renamed = (await provider.Execute(
      asAutomation("chat.group.rename", { conversationId, name: "Plantão da noite" }),
    )) as { conversation: { name: string } };
    expect(renamed.conversation.name).toBe("Plantão da noite");
  });

  it("refuses to manage a direct conversation as if it were a group", async () => {
    const { provider, chat } = company();
    const direct = (await chat.OpenDirect?.({ withUserId: "bruno" }, { caller: { userId: "ana", role: "owner" } })) as {
      conversation: { id: string };
    };
    const answer = (await provider.Execute(
      asAutomation("chat.group.rename", { conversationId: direct.conversation.id, name: "Nope" }),
    )) as { error?: string };
    expect(answer.error).toBe("not_a_group");
  });

  it("lists the conversations of the company, because no person is asking", async () => {
    const { provider } = company();
    await groupOf(provider, "Plantão");
    await groupOf(provider, "Suporte");
    const listed = (await provider.Execute(asAutomation("chat.conversations.list", {}))) as {
      conversations: { name?: string }[];
    };
    expect(listed.conversations.map((entry) => entry.name)).toEqual(expect.arrayContaining(["Plantão", "Suporte"]));
  });
});

describe("the node that posts as the system", () => {
  it("stores the message with the system as its author, never with an author from the input", async () => {
    const { provider, host } = company();
    const conversationId = await groupOf(provider);
    const sent = (await provider.Execute(
      asAutomation("chat.message.system", { conversationId, text: "Backup concluído", authorId: "ana" }),
    )) as { message: { authorId: string; text: string } };
    expect(sent.message.authorId).toBe("system");
    expect(sent.message.text).toBe("Backup concluído");
    expect(host.emitted.map((event) => event.type)).toContain(MESSAGE_SENT);
  });

  it("reads back the conversation it posted into", async () => {
    const { provider } = company();
    const conversationId = await groupOf(provider);
    await provider.Execute(asAutomation("chat.message.system", { conversationId, text: "Primeira" }));
    const read = (await provider.Execute(asAutomation("chat.conversation.messages", { conversationId }))) as {
      messages: { text: string }[];
    };
    expect(read.messages.map((message) => message.text)).toEqual(["Primeira"]);
  });
});

describe("the events this plugin announces for a flow to start from", () => {
  it("declares each one it emits, with the payload the editor shows downstream", () => {
    const catalog = company().provider.Catalog() as { triggers: { type: string; example: unknown }[] };
    const byType = new Map(catalog.triggers.map((trigger) => [trigger.type, trigger.example]));
    expect([...byType.keys()]).toEqual(
      expect.arrayContaining([MESSAGE_SENT, GROUP_OPENED, PARTICIPANTS_ADDED, PARTICIPANTS_REMOVED, CONVERSATION_READ]),
    );
    expect(plugin.manifest.emits).toEqual(
      expect.arrayContaining([MESSAGE_SENT, GROUP_OPENED, PARTICIPANTS_ADDED, PARTICIPANTS_REMOVED, CONVERSATION_READ]),
    );
  });

  it("announces a group that was opened, with the shape its trigger promises", async () => {
    const { provider, host } = company();
    const conversationId = await groupOf(provider);
    const event = host.emitted.find((entry) => entry.type === GROUP_OPENED);
    // Fails with a sentence rather than a TypeError when nothing was emitted, and lets the two
    // assertions below read the payload without optional chaining.
    if (event === undefined) throw new Error("no group-opened event was emitted");
    expect(event.payload).toMatchObject({ conversationId, name: "Plantão", createdBy: "system" });
    expect((event.payload as { participants: string[] }).participants).toContain("ana");
  });

  it("announces who was added and who was removed", async () => {
    const { provider, host } = company();
    const conversationId = await groupOf(provider);
    await provider.Execute(asAutomation("chat.group.members.add", { conversationId, memberIds: ["bruno"] }));
    await provider.Execute(asAutomation("chat.group.members.remove", { conversationId, memberIds: ["bruno"] }));
    expect(host.emitted.find((entry) => entry.type === PARTICIPANTS_ADDED)?.payload).toMatchObject({
      conversationId,
      memberIds: ["bruno"],
      by: "system",
    });
    expect(host.emitted.find((entry) => entry.type === PARTICIPANTS_REMOVED)?.payload).toMatchObject({
      conversationId,
      memberIds: ["bruno"],
    });
  });

  it("announces a conversation somebody marked read", async () => {
    const { provider, chat, host } = company();
    const conversationId = await groupOf(provider);
    await provider.Execute(asAutomation("chat.message.system", { conversationId, text: "Oi" }));
    await chat.MarkRead?.({ conversationId, through: 1 }, { caller: { userId: "ana", role: "owner" } });
    expect(host.emitted.find((entry) => entry.type === CONVERSATION_READ)?.payload).toMatchObject({
      conversationId,
      userId: "ana",
      through: 1,
    });
  });
});
