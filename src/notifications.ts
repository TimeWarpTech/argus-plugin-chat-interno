import type { PluginContext, PublishNotification } from "@creativepetabyte/argus-sdk";

const QUEUE_KEY = "chat.notification-outbox.v1";

/** One serialized queue per company; publish keys make retries safe after an ambiguous response. */
export function createNotificationOutbox(ctx: PluginContext) {
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  const schedule = (work: () => Promise<void>) => {
    chain = chain.then(work).catch((error: unknown) => ctx.log(`notification queue failed: ${String(error)}`));
    return chain;
  };
  const flush = async (queue: PublishNotification[]) => {
    if (!ctx.notifications || stopped) return;
    for (const item of [...queue]) {
      try {
        await ctx.notifications.publish(item);
      } catch (error) {
        // A departed member must not block every later message in this company's queue.
        if (String(error).includes("notification_recipient_refused") && ctx.members) {
          const active = new Set<string>();
          let offset: number | null = 0;
          while (offset !== null) {
            const page = await ctx.members.list({ offset, pageSize: 100 });
            for (const member of page.members) active.add(member.userId);
            offset = page.nextOffset;
          }
          item.recipients = item.recipients.filter((id) => active.has(id));
          if (!item.recipients.length) queue = queue.filter((one) => one.key !== item.key);
          await ctx.store.set(QUEUE_KEY, queue);
        }
        ctx.log(`notification publication deferred: ${String(error)}`);
        break;
      }
      queue = queue.filter((one) => one.key !== item.key);
      await ctx.store.set(QUEUE_KEY, queue);
    }
  };
  const timer = setInterval(() => {
    if (!stopped) void schedule(async () => flush((await ctx.store.get<PublishNotification[]>(QUEUE_KEY)) ?? []));
  }, 10_000);
  timer.unref();
  return {
    enqueue(items: PublishNotification[]) {
      return schedule(async () => {
        const queue = (await ctx.store.get<PublishNotification[]>(QUEUE_KEY)) ?? [];
        const known = new Set(queue.map((item) => item.key));
        queue.push(...items.filter((item) => !known.has(item.key)));
        await ctx.store.set(QUEUE_KEY, queue);
        await flush(queue);
      });
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
