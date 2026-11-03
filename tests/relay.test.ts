/**
 * The chat hands its events somewhere, or it has none.
 *
 * Every other test here builds `plugin.create` by hand and asserts on the context it was given,
 * which proves the logic and proves nothing about the wiring: a plugin whose relay stream was never
 * opened is on the air, answers nothing another plugin carries to it, and emits into a stream with
 * no other end -- `Events: 0` on the kernel's panel while its calls work. That is silent, so it is
 * asserted here rather than trusted, by driving the SDK runtime the way `src/main.ts` does:
 * `startWith`, then `introduce()`, which is the handshake, the subscriptions and the relay stream.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Host, startWith } from "@creativepetabyte/argus-sdk";
import { createFakeHost, type FakeHost } from "@creativepetabyte/argus-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import plugin, { CHAT, GROUP_OPENED, PLUGIN_ID } from "../src/plugin.js";

let folders: string[] = [];
let stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  // The store holds the SQLite file open, so the process stops before the folder goes: on Windows a
  // live handle makes the delete fail with EBUSY, and the failure lands on the test.
  for (const stop of stops) await stop();
  for (const made of folders) rmSync(made, { recursive: true, force: true });
  stops = [];
  folders = [];
});

/** This plugin under the runtime its `main.ts` uses, with no kernel and no network behind it. */
function started(tenantId = "empresa-a"): { host: FakeHost; introduce(): Promise<void> } {
  const host = createFakeHost({ tenantId });
  const root = mkdtempSync(join(tmpdir(), "chat-interno-relay-"));
  folders.push(root);
  const running = startWith(plugin, {
    kernelUrl: "http://kernel",
    credential: "cred",
    instances: [{ instanceId: `${PLUGIN_ID}:${tenantId}`, instanceToken: `token-${tenantId}` }],
    dataDir: () => root,
    hostFor: (): Host => host,
  });
  stops.push(() => running.stop());
  return { host, introduce: () => running.introduce() };
}

describe("the relay stream", () => {
  it("is opened for this plugin, which both emits and serves contracts", async () => {
    const { host, introduce } = started();

    await introduce();

    // A plugin that emits needs this stream for its verdicts, and one that serves a contract needs
    // it for the calls another plugin carries over it. `0` is a plugin that is on the air and mute.
    expect(host.relayOpens).toBe(1);
  });

  it("answers a contract call another plugin carried over it", async () => {
    const { host, introduce } = started();
    await introduce();

    // The automation engine reaches this plugin exactly this way. A relay names the CALLING
    // INSTANCE and no person, which is why `OpenGroup` is the method it may use.
    const answer = await host.callOverRelay({
      callId: "c-1",
      contract: CHAT,
      method: "OpenGroup",
      input: { name: "Plantão" },
      caller: `automation.flows:${host.tenantId}`,
    });

    expect(answer.error).toBeUndefined();
    expect((answer.output as { conversation?: { id?: string } }).conversation?.id).toBeTypeOf("string");
  });

  it("carries out what that call announced, instead of leaving it with nobody", async () => {
    const { host, introduce } = started();
    await introduce();

    await host.callOverRelay({
      callId: "c-1",
      contract: CHAT,
      method: "OpenGroup",
      input: { name: "Plantão" },
      caller: `automation.flows:${host.tenantId}`,
    });

    // The whole point of the event: the screens already open learn of the room, and a flow has
    // somewhere to start. An emit that reached nobody is this list being empty.
    expect(host.emitted.map((event) => event.type)).toContain(GROUP_OPENED);
  });
});
