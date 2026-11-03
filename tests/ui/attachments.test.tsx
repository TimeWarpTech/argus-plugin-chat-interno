// @vitest-environment jsdom
import type { Attachment, MediaCall } from "@creativepetabyte/argus-chat-media";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Attachments } from "../../ui/src/attachments";
import { wordsFor } from "../../ui/src/words";

let root: Root;
let container: HTMLDivElement;
const file: Attachment = { id: "a1", name: "nota.ogg", mimeType: "audio/ogg", size: 3 };
const words = wordsFor("pt-BR");
let visibility: (() => void)[];
beforeEach(() => {
  visibility = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      active = true;
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        visibility.push(() => {
          if (this.active) callback([{ isIntersecting: true }]);
        });
      }
      observe() {}
      disconnect() {
        this.active = false;
      }
    },
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:media"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(attachment: Attachment, call: MediaCall) {
  await act(async () =>
    root.render(createElement(Attachments, { files: [attachment], messageId: "m1", call, words, locale: "pt-BR" })),
  );
}
it("loads audio on play, supports seeking and speed, and releases the URL", async () => {
  const call = vi.fn(async () => ({ data: btoa("abc") }));
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  await render(file, call);
  expect(call).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  expect(call).toHaveBeenCalledWith("ReadAttachment", { attachmentId: "a1", messageId: "m1", offset: 0 });
  expect(play).toHaveBeenCalledOnce();
  expect(container.querySelector(".ci-player-play")?.getAttribute("aria-label")).toBe(words.pause);
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Audio player missing");
  Object.defineProperty(audio, "duration", { configurable: true, value: 83 });
  await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
  expect(container.querySelector(".ci-player-times")?.textContent).toBe("0:00/1:23");
  expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-speed")?.click());
  expect(audio.playbackRate).toBe(1.5);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  expect(container.querySelector(".ci-player-play")?.getAttribute("aria-label")).toBe(words.play);
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media");
  root = createRoot(container);
});

it("uses decoded duration for recorded WebM, advances progress, and replays from zero", async () => {
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      async decodeAudioData() {
        return { duration: 3, getChannelData: () => new Float32Array([0.2, 0.8, 0.1, 0.4]) };
      }
      async close() {
        this.state = "closed";
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(3) })),
  );
  await render(
    { ...file, name: "Audio.webm", mimeType: "audio/webm;codecs=opus" },
    vi.fn(async () => ({ data: btoa("abc") })),
  );
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Audio player missing");
  Object.defineProperty(audio, "duration", { configurable: true, value: Number.POSITIVE_INFINITY });
  await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
  const seek = container.querySelector<HTMLInputElement>(".ci-player-seek");
  expect(seek?.disabled).toBe(false);
  expect(seek?.max).toBe("3");
  expect(container.querySelector(".ci-player-times")?.textContent).toBe("0:00/0:03");
  await act(async () => {
    audio.currentTime = 1.5;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  expect(seek?.value).toBe("1.5");
  expect(container.querySelector<HTMLElement>(".ci-player-timeline")?.style.getPropertyValue("--progress")).toBe("50%");
  expect(container.querySelector(".ci-player-status")?.textContent).toBe(words.playing);
  await act(async () => {
    audio.currentTime = 3;
    audio.dispatchEvent(new Event("ended"));
  });
  expect(container.querySelector(".ci-player-status")?.textContent).toBe(words.playbackEnded);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  expect(audio.currentTime).toBe(0);
  expect(seek?.value).toBe("0");
  expect(container.querySelector(".ci-player-status")?.textContent).toBe(words.playing);
});

it("refreshes the visible playhead between native timeupdate events and stops on pause", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", undefined);
  await render(
    file,
    vi.fn(async () => ({ data: btoa("abc") })),
  );
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Audio player missing");
  Object.defineProperty(audio, "duration", { configurable: true, value: 3 });
  await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
  await act(async () => {
    audio.currentTime = 1.2;
    vi.advanceTimersByTime(100);
  });
  expect(container.querySelector<HTMLInputElement>(".ci-player-seek")?.value).toBe("1.2");
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  await act(async () => {
    audio.currentTime = 2;
    vi.advanceTimersByTime(100);
  });
  expect(container.querySelector<HTMLInputElement>(".ci-player-seek")?.value).toBe("1.2");
});
it("offers retry when a download fails", async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ data: btoa("abc") });
  await render({ ...file, name: "report.txt", mimeType: "text/plain" }, call);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-file-download")?.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(words.fileFailed);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-plain")?.click());
  expect(container.querySelector("a")?.getAttribute("download")).toBe("report.txt");
});

it("previews PDFs automatically, expands the document and keeps download available", async () => {
  const call = vi.fn(async () => ({ data: btoa("abc") }));
  await render({ ...file, name: "report.pdf", mimeType: "application/pdf" }, call);
  expect(call).toHaveBeenCalledWith("ReadAttachment", { attachmentId: "a1", messageId: "m1", offset: 0 });
  expect(container.querySelector(".ci-pdf-preview")?.getAttribute("src")).toContain("blob:media#page=1");
  expect(container.querySelector("a")?.getAttribute("download")).toBe("report.pdf");
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-pdf-open")?.click());
  expect(container.querySelector('[role="dialog"] .ci-viewer-pdf')?.getAttribute("src")).toBe("blob:media");
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${words.close}"]`)?.click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("shows images automatically and falls back to a downloadable card on decode error", async () => {
  await render(
    { ...file, name: "photo.png", mimeType: "image/png" },
    vi.fn(async () => ({ data: btoa("abc") })),
  );
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:media");
  await act(async () => container.querySelector("img")?.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("download")).toBe("photo.png");
});
it("keeps offscreen video downloads on demand and exposes playback inline", async () => {
  const call = vi.fn(async () => ({ data: btoa("abc") }));
  await render({ ...file, name: "clip.mp4", mimeType: "video/mp4" }, call);
  expect(call).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-center")?.click());
  expect(container.querySelector("video")?.controls).toBe(false);
  expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:media");
  expect(container.querySelector("video")?.playsInline).toBe(true);
  await act(async () => container.querySelector("video")?.dispatchEvent(new Event("error")));
  expect(container.querySelector("a")?.getAttribute("download")).toBe("clip.mp4");
});

it("preloads nearby media without autoplay, so play starts from the existing blob", async () => {
  const call = vi.fn(async () => ({ data: btoa("abc") }));
  await render(file, call);
  expect(call).not.toHaveBeenCalled();
  await act(async () => {
    for (const visible of visibility) visible();
  });
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:media");
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(words.loading);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledOnce();
});

it("queues play during preloading without duplicate downloads or an Opening label", async () => {
  let release: ((answer: { data: string }) => void) | undefined;
  const call = vi.fn(
    () =>
      new Promise<{ data: string }>((resolve) => {
        release = resolve;
      }),
  );
  await render(file, call);
  await act(async () => {
    for (const visible of visibility) visible();
  });
  const button = container.querySelector<HTMLButtonElement>(".ci-player-play");
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
  expect(button?.getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).not.toContain(words.loading);
  expect(call).toHaveBeenCalledOnce();
  await act(async () => release?.({ data: btoa("abc") }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
});

it("can cancel queued play while the media is still downloading", async () => {
  let release: ((answer: { data: string }) => void) | undefined;
  const call = vi.fn(
    () =>
      new Promise<{ data: string }>((resolve) => {
        release = resolve;
      }),
  );
  await render(file, call);
  await act(async () => {
    for (const visible of visibility) visible();
  });
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-play")?.click());
  await act(async () => release?.({ data: btoa("abc") }));
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});

it("pauses the previous player when another starts, including audio and video", async () => {
  const call = vi.fn(async () => ({ data: btoa("abc") }));
  await act(async () =>
    root.render(
      createElement(Attachments, {
        files: [file, { ...file, id: "a2", name: "clip.webm", mimeType: "video/webm" }],
        messageId: "m1",
        call,
        words,
        locale: "pt-BR",
      }),
    ),
  );
  const playAudio = container.querySelector<HTMLButtonElement>(".ci-player-audio .ci-player-play");
  await act(async () => playAudio?.click());
  expect(container.querySelector("audio")?.paused).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-center")?.click());
  expect(container.querySelector("audio")?.paused).toBe(true);
  expect(container.querySelector("video")?.paused).toBe(false);
});

it("retains a play button when the browser blocks playback and supports mute", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  await render(
    { ...file, name: "clip.webm", mimeType: "video/webm" },
    vi.fn(async () => ({ data: btoa("abc") })),
  );
  await act(async () => container.querySelector<HTMLButtonElement>(".ci-player-center")?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe(words.playFailed);
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${words.mute}"]`)?.click());
  expect(container.querySelector("video")?.muted).toBe(true);
  expect(container.querySelector(`[aria-label="${words.unmute}"]`)).not.toBeNull();
});
