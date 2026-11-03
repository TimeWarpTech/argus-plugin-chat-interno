// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecordingWaveform, useVoiceRecorder } from "../../ui/src/voice-recorder";
import { wordsFor } from "../../ui/src/words";

let root: Root;
let container: HTMLDivElement;
let recorder: ReturnType<typeof useVoiceRecorder>;
const ready = vi.fn();
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] };
const getUserMedia = vi.fn(async () => stream);
class FakeRecorder {
  static isTypeSupported(type: string) {
    return type.startsWith("audio/webm");
  }
  mimeType = "audio/webm;codecs=opus";
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded audio"]) });
    this.onstop?.();
  }
}
function Harness() {
  recorder = useVoiceRecorder(ready, wordsFor("pt-BR"));
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  ready.mockReset();
  stopTrack.mockReset();
  getUserMedia.mockReset().mockResolvedValue(stream);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("requests the microphone only on start and creates a local audio file on finish", async () => {
  expect(getUserMedia).not.toHaveBeenCalled();
  await act(async () => recorder.start());
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  expect(recorder.status).toBe("recording");
  await act(async () => recorder.finish());
  expect(recorder.status).toBe("idle");
  expect(ready).toHaveBeenCalledOnce();
  expect(ready.mock.calls[0]?.[0]).toMatchObject({ type: "audio/webm;codecs=opus", size: 14 });
  expect(stopTrack).toHaveBeenCalled();
});
it("discards a cancelled recording and stops the microphone", async () => {
  await act(async () => recorder.start());
  await act(async () => recorder.cancel());
  expect(ready).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalled();
});
it("stops a microphone granted after the user cancels the permission wait", async () => {
  let release: ((value: typeof stream) => void) | undefined;
  getUserMedia.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    void recorder.start();
  });
  expect(recorder.status).toBe("requesting");
  await act(async () => recorder.cancel());
  await act(async () => release?.(stream));
  expect(recorder.status).toBe("idle");
  expect(stopTrack).toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
});
it("reports microphone permission denial", async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
  await act(async () => recorder.start());
  expect(recorder.status).toBe("idle");
  expect(recorder.problem).toBe(wordsFor("pt-BR").microphoneDenied);
});

it("draws actual microphone amplitude and releases the analyser when recording stops", async () => {
  vi.useFakeTimers();
  let amplitude = 0;
  const analyser = {
    fftSize: 512,
    getFloatTimeDomainData: (data: Float32Array) => data.fill(amplitude),
    disconnect: vi.fn(),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      createAnalyser() {
        return analyser;
      }
      createMediaStreamSource() {
        return source;
      }
      resume() {
        return Promise.resolve();
      }
      close = close;
    },
  );
  await act(async () => root.render(createElement(RecordingWaveform, { stream: stream as unknown as MediaStream })));
  const heights = () => [...container.querySelectorAll("rect")].map((bar) => Number(bar.getAttribute("height")));
  await act(async () => vi.advanceTimersByTime(50));
  expect(heights().at(-1)).toBe(2);
  amplitude = 0.2;
  await act(async () => vi.advanceTimersByTime(50));
  expect(heights().at(-1)).toBeGreaterThan(10);
  amplitude = 0;
  await act(async () => vi.advanceTimersByTime(50));
  expect(heights().at(-1)).toBe(2);
  expect(heights().at(-2)).toBeGreaterThan(10);
  expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
  await act(async () => root.render(createElement(RecordingWaveform, { stream: undefined })));
  expect(source.disconnect).toHaveBeenCalledOnce();
  expect(analyser.disconnect).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
