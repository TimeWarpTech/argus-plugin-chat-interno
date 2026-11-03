import { contextFor, type PublishNotification } from "@creativepetabyte/argus-sdk";
import { createFakeHost } from "@creativepetabyte/argus-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { createNotificationOutbox } from "../src/notifications.js";

afterEach(() => vi.useRealTimers());
it("persists deferred notifications and replays them after restarting", async () => {
  const host = createFakeHost();
  const publish = vi.fn().mockRejectedValue(new Error("offline"));
  host.publishNotification = publish;
  const ctx = contextFor(host, { instanceId: "chat:tenant", instanceToken: "token" }, undefined);
  const first = createNotificationOutbox(ctx);
  const item: PublishNotification = {
    key: "message:42",
    recipients: ["alice"],
    title: { "pt-BR": "Mensagem", en: "Message" },
    page: "chat-interno",
  };
  await first.enqueue([item]);
  first.stop();
  expect(await ctx.store.get("chat.notification-outbox.v1")).toEqual([item]);
  publish.mockResolvedValue({ created: 1, ids: [] });
  const second = createNotificationOutbox(ctx);
  await second.enqueue([]);
  second.stop();
  expect(publish).toHaveBeenLastCalledWith(item);
  expect(await ctx.store.get("chat.notification-outbox.v1")).toEqual([]);
});
