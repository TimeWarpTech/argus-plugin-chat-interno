/**
 * These run with nothing installed: no kernel, no database, no network. What this plugin decides is
 * logic, and logic should not need infrastructure to be exercised.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ContractMethods,
  contextFor,
  type Host,
  runPluginConformance,
} from "@creativepetabyte/argus-sdk";
import { createFakeHost, type FakeHost } from "@creativepetabyte/argus-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, { CHAT, MESSAGE_SENT } from "./plugin.js";

let folders: string[] = [];
/** Every company built in a test, so each one lets go of its SQLite file before it is deleted. */
let opened: { onShutdown?(): Promise<void> | void }[] = [];

const folder = (): string => {
  const made = mkdtempSync(join(tmpdir(), "chat-interno-plugin-"));
  folders.push(made);
  return made;
};

beforeEach(() => {
  folders = [];
  opened = [];
});

afterEach(async () => {
  // The store holds the file open, so closing comes first: on Windows a live handle makes the
  // delete fail with EBUSY, and the failure lands on the test rather than on the cleanup.
  for (const company of opened) await company.onShutdown?.();
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

const ANA = { userId: "ana", role: "owner" };
const BRUNO = { userId: "bruno", role: "agent" };

/** A host that answers the member directory, which is where the list of colleagues comes from. */
const withColleagues = (): FakeHost => {
  const host = createFakeHost();
  host.listMembers = async () => ({
    members: [
      { userId: "ana", name: "Ana", role: "owner" },
      { userId: "bruno", name: "Bruno", role: "agent" },
    ],
    nextOffset: null,
  });
  return host;
};

/** One company's plugin, built the way the runtime builds it. */
function company(host: Host, tenantId = "empresa-a") {
  const ctx = contextFor(
    host,
    { instanceId: `chat.internal:${tenantId}`, instanceToken: `token-${tenantId}` },
    folder(),
    () => {},
  );
  const built = plugin.create(ctx);
  opened.push(built);
  if (built.serves === undefined) throw new Error("this plugin must serve its contract");
  // Annotated, because reading it off the literal narrows each method to the arity it was written
  // with and a test could then no longer hand it the caller the kernel supplies.
  const methods: ContractMethods = built.serves[CHAT];
  return { ctx, built, methods };
}

describe("who is speaking", () => {
  it("refuses to send when the kernel told it nobody, instead of inventing an author", async () => {
    const { methods } = company(createFakeHost());
    const conversation = (await methods.OpenGroup?.({ name: "Plantão" }, {})) as { conversation: { id: string } };

    const answer = await methods.Send?.(
      { conversationId: conversation.conversation.id, text: "oi" },
      {},
    );

    expect(answer).toEqual({ error: "no_caller" });
  });

  it("writes the message under the person the kernel named, not under anything the input says", async () => {
    const { methods } = company(createFakeHost());
    const opened = (await methods.OpenGroup?.({ name: "Plantão", memberIds: ["ana"] }, {})) as {
      conversation: { id: string };
    };

    // The input also claims an author. It must be ignored: this is the hole the kernel closed when
    // it began telling a plugin who made the call.
    const sent = (await methods.Send?.(
      { conversationId: opened.conversation.id, text: "oi", authorId: "bruno" },
      { caller: ANA },
    )) as { message: { authorId: string } };

    expect(sent.message.authorId).toBe("ana");
  });
});

describe("a conversation", () => {
  it("is the same one when the other person opens it from their side", async () => {
    const { methods } = company(createFakeHost());

    const mine = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };
    const theirs = (await methods.OpenDirect?.({ withUserId: "ana" }, { caller: BRUNO })) as {
      conversation: { id: string };
    };

    expect(theirs.conversation.id).toBe(mine.conversation.id);
  });

  it("is only listed for the people in it", async () => {
    const { methods } = company(createFakeHost());
    await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA });

    const ana = (await methods.Conversations?.({}, { caller: ANA })) as { conversations: unknown[] };
    const carla = (await methods.Conversations?.({}, { caller: { userId: "carla", role: "agent" } })) as {
      conversations: unknown[];
    };

    expect(ana.conversations).toHaveLength(1);
    expect(carla.conversations).toHaveLength(0);
  });

  it("cannot be read by somebody who is not in it", async () => {
    const { methods } = company(createFakeHost());
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };

    const answer = await methods.Messages?.(
      { conversationId: opened.conversation.id },
      { caller: { userId: "carla", role: "agent" } },
    );

    expect(answer).toEqual({ error: "not_a_participant" });
  });
});

describe("sending", () => {
  it("announces the message, so every open screen learns of it without asking", async () => {
    const host = createFakeHost();
    const { methods } = company(host);
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };

    await methods.Send?.({ conversationId: opened.conversation.id, text: "oi" }, { caller: ANA });

    expect(host.emitted.map((event) => event.type)).toContain(MESSAGE_SENT);
  });

  it("refuses an empty message with a code the screen can translate, not a stack trace", async () => {
    const { methods } = company(createFakeHost());
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };

    const answer = await methods.Send?.(
      { conversationId: opened.conversation.id, text: "   " },
      { caller: ANA },
    );

    expect(answer).toEqual({ error: "empty_message" });
  });

  it("is one message when the same send arrives twice", async () => {
    const { methods } = company(createFakeHost());
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };
    const once = { conversationId: opened.conversation.id, text: "oi", messageId: "m-1" };

    await methods.Send?.(once, { caller: ANA });
    await methods.Send?.(once, { caller: ANA });

    const read = (await methods.Messages?.({ conversationId: opened.conversation.id }, { caller: ANA })) as {
      messages: unknown[];
    };
    expect(read.messages).toHaveLength(1);
  });
});

describe("the list of colleagues", () => {
  it("comes from the kernel's directory", async () => {
    const { methods } = company(withColleagues());

    const answer = (await methods.Colleagues?.({}, { caller: ANA })) as {
      colleagues: { userId: string }[];
    };

    expect(answer.colleagues.map((c) => c.userId)).toEqual(["ana", "bruno"]);
  });

  it("degrades with a readable code on a host that has no directory", async () => {
    // A FakeHost offers no directory, which is exactly the older host this must survive.
    const { methods } = company(createFakeHost());

    const answer = await methods.Colleagues?.({}, { caller: ANA });

    expect(answer).toEqual({ colleagues: [], directory: "unavailable" });
  });
});

describe("leaving and being forgotten", () => {
  it("exports what the company wrote and deletes it for good", async () => {
    const { built, methods } = company(createFakeHost());
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };
    await methods.Send?.({ conversationId: opened.conversation.id, text: "oi" }, { caller: ANA });

    const exported = (await built.exportData()) as { messages: unknown[] };
    expect(exported.messages).toHaveLength(1);

    await built.deleteData();
    expect(((await built.exportData()) as { messages: unknown[] }).messages).toHaveLength(0);
  });
});

describe("a file in a conversation", () => {
  /** Uploads one small file through the contract, the way the screen does. */
  async function uploadThrough(methods: ContractMethods, caller: { userId: string; role: string }) {
    const created = (await methods.CreateAttachment?.(
      { name: "foto.png", mimeType: "image/png", size: 3 },
      { caller },
    )) as { id: string };
    await methods.WriteAttachment?.(
      { attachmentId: created.id, offset: 0, data: Buffer.from([1, 2, 3]).toString("base64") },
      { caller },
    );
    return created;
  }

  it("is refused to somebody who is not in the conversation it was sent to", async () => {
    const { methods } = company(createFakeHost());
    const file = await uploadThrough(methods, ANA);
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };
    const sent = (await methods.Send?.(
      { conversationId: opened.conversation.id, text: "olha", attachmentIds: [file.id] },
      { caller: ANA },
    )) as { message: { id: string } };

    const asCarla = await methods.ReadAttachment?.(
      { attachmentId: file.id, messageId: sent.message.id, offset: 0 },
      { caller: { userId: "carla", role: "agent" } },
    );
    expect(asCarla).toEqual({ error: "not_a_participant" });

    const asBruno = await methods.ReadAttachment?.(
      { attachmentId: file.id, messageId: sent.message.id, offset: 0 },
      { caller: BRUNO },
    );
    expect(asBruno).toMatchObject({ data: expect.any(String) });
  });

  it("is refused to a call with nobody behind it, however complete the input is", async () => {
    const { methods } = company(createFakeHost());
    const answer = await methods.CreateAttachment?.({ name: "a.png", mimeType: "image/png", size: 3 }, {});
    expect(answer).toEqual({ error: "no_caller" });
  });

  it("travels with the message, so a screen knows what to draw without asking again", async () => {
    const { methods } = company(createFakeHost());
    const file = await uploadThrough(methods, ANA);
    const opened = (await methods.OpenDirect?.({ withUserId: "bruno" }, { caller: ANA })) as {
      conversation: { id: string };
    };
    await methods.Send?.(
      { conversationId: opened.conversation.id, text: "", attachmentIds: [file.id] },
      { caller: ANA },
    );

    const read = (await methods.Messages?.({ conversationId: opened.conversation.id }, { caller: ANA })) as {
      messages: { attachments: { name: string }[] }[];
    };
    expect(read.messages[0]?.attachments.map((a) => a.name)).toEqual(["foto.png"]);
  });
});

describe("the conformance suite", () => {
  it("passes every scenario", async () => {
    const failures = await runPluginConformance({
      definition: plugin,
      // A group, because it is the one thing another plugin may open with nobody behind the call.
      // Named from the event so each company writes something of its own, which is what the
      // isolation scenario reads.
      callFor: (event) => ({
        contract: CHAT,
        method: "OpenGroup",
        input: { name: `grupo-${event.eventId}` },
      }),
    });

    expect(failures.map((failure) => `${failure.scenario.name}: ${failure.got}`)).toEqual([]);
  });
});
