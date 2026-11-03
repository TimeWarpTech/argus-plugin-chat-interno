// @vitest-environment jsdom
import type { MediaCall } from "@creativepetabyte/argus-chat-media";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePendingUploads } from "../../ui/src/pending-uploads";

let root: Root;
let container: HTMLDivElement;
let queue: ReturnType<typeof usePendingUploads>;
const send = vi.fn(async () => true);
function Harness({ call }: { call: MediaCall }) {
  queue = usePendingUploads(call, send);
  return null;
}
function file() {
  const value = new File([new Uint8Array(96 * 1024)], "large.bin", { type: "application/octet-stream" });
  Object.defineProperty(value, "arrayBuffer", { value: async () => new ArrayBuffer(value.size) });
  return value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  root = createRoot(container);
  send.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

it("reports chunk progress and keeps the temporary message until Send confirms", async () => {
  let releaseChunk: (() => void) | undefined;
  let releaseSend: ((value: boolean) => void) | undefined;
  const call: MediaCall = vi.fn(async (method, input) => {
    if (method === "CreateAttachment")
      return { id: "a1", name: "large.bin", mimeType: "application/octet-stream", size: 96 * 1024 };
    if (method === "WriteAttachment" && input.offset === 48 * 1024)
      await new Promise<void>((resolve) => {
        releaseChunk = resolve;
      });
    return {};
  });
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseSend = resolve;
      }),
  );
  await act(async () => root.render(createElement(Harness, { call })));
  await act(async () => {
    queue.enqueue("original-conversation", file(), "caption", "quoted-message");
  });
  expect(queue.uploads[0]?.progress).toBe(50);
  expect(queue.uploads[0]?.status).toBe("uploading");
  expect(send).not.toHaveBeenCalled();
  await act(async () => releaseChunk?.());
  expect(queue.uploads[0]?.status).toBe("sending");
  expect(queue.uploads[0]?.progress).toBe(100);
  expect(send).toHaveBeenCalledWith("caption", ["a1"], "quoted-message", "original-conversation");
  await act(async () => releaseSend?.(true));
  expect(queue.uploads).toHaveLength(0);
});

it("retries a failed Send with the already uploaded attachment", async () => {
  const call = vi.fn(async (method: string) =>
    method === "CreateAttachment"
      ? { id: "a1", name: "large.bin", mimeType: "application/octet-stream", size: 96 * 1024 }
      : {},
  );
  send.mockResolvedValueOnce(false);
  await act(async () => root.render(createElement(Harness, { call })));
  await act(async () => {
    queue.enqueue("c1", file(), "caption");
  });
  const id = queue.uploads[0]?.id;
  expect(queue.uploads[0]?.status).toBe("failed");
  if (!id) throw new Error("Temporary message missing");
  await act(async () => queue.retry(id));
  expect(queue.uploads).toHaveLength(0);
  expect(call.mock.calls.filter(([method]) => method === "CreateAttachment")).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(2);
});

it("aborts an upload on unmount and cleans the pending attachment without sending", async () => {
  let release: (() => void) | undefined;
  const call = vi.fn(async (method: string) => {
    if (method === "CreateAttachment")
      return { id: "a1", name: "large.bin", mimeType: "application/octet-stream", size: 96 * 1024 };
    if (method === "WriteAttachment")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {};
  });
  await act(async () => root.render(createElement(Harness, { call })));
  await act(async () => {
    queue.enqueue("c1", file(), "");
  });
  await act(async () => root.unmount());
  await act(async () => release?.());
  expect(send).not.toHaveBeenCalled();
  expect(call.mock.calls.some(([method]) => method === "DeleteAttachment")).toBe(true);
  root = createRoot(container);
});
