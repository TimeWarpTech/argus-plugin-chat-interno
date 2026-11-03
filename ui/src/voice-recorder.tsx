import { useEffect, useRef, useState } from "react";
import { MAX_MEDIA_BYTES } from "../../shared/limits.js";
import { MediaIcon } from "./media-icons";
import { MediaPlayer, mediaTime } from "./media-player";
import type { Words } from "./words";

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  cancelled: boolean;
  chunks: Blob[];
  bytes: number;
}

const stopTracks = (current: Session) => {
  for (const track of current.stream.getTracks()) track.stop();
};

export function useVoiceRecorder(onReady: (file: File) => void, words: Words) {
  const [status, setStatus] = useState<"idle" | "requesting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string>();
  const session = useRef<Session | undefined>(undefined);
  const request = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      clearInterval(timer.current);
      const current = session.current;
      if (current) {
        current.cancelled = true;
        if (current.recorder.state !== "inactive") current.recorder.stop();
        stopTracks(current);
      }
    };
  }, []);
  const stop = (cancelled: boolean) => {
    request.current++;
    clearInterval(timer.current);
    const current = session.current;
    if (current) {
      current.cancelled = cancelled;
      if (current.recorder.state !== "inactive") current.recorder.stop();
      stopTracks(current);
    } else setStatus("idle");
  };
  return {
    status,
    seconds,
    problem,
    stream: status === "recording" ? session.current?.stream : undefined,
    cancel: () => stop(true),
    finish: () => stop(false),
    async start() {
      if (status !== "idle") return;
      setProblem(undefined);
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setProblem(words.recordingUnsupported);
        return;
      }
      const revision = ++request.current;
      setStatus("requesting");
      let stream: MediaStream | undefined;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted.current || request.current !== revision) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
          MediaRecorder.isTypeSupported(type),
        );
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const current: Session = { recorder, stream, cancelled: false, chunks: [], bytes: 0 };
        session.current = current;
        recorder.ondataavailable = (event) => {
          if (!event.data.size || current.cancelled) return;
          current.bytes += event.data.size;
          if (current.bytes > MAX_MEDIA_BYTES) {
            current.cancelled = true;
            setProblem(words.tooBig);
            recorder.stop();
            stopTracks(current);
            return;
          }
          current.chunks.push(event.data);
        };
        recorder.onstop = () => {
          clearInterval(timer.current);
          stopTracks(current);
          if (session.current === current) session.current = undefined;
          if (!mounted.current) return;
          setStatus("idle");
          if (current.cancelled) return;
          if (!current.bytes) {
            setProblem(words.recordingFailed);
            return;
          }
          const type = recorder.mimeType || current.chunks[0]?.type || "audio/webm";
          const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
          onReady(new File(current.chunks, `${words.voiceFilename}-${Date.now()}.${extension}`, { type }));
        };
        recorder.onerror = () => {
          current.cancelled = true;
          setProblem(words.recordingFailed);
          stop(true);
          setStatus("idle");
        };
        recorder.start(1000);
        setSeconds(0);
        setStatus("recording");
        const started = Date.now();
        timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
      } catch (error) {
        if (stream) for (const track of stream.getTracks()) track.stop();
        if (!mounted.current || request.current !== revision) return;
        setStatus("idle");
        setProblem(
          typeof error === "object" &&
            error !== null &&
            "name" in error &&
            (error.name === "NotAllowedError" || error.name === "SecurityError")
            ? words.microphoneDenied
            : words.recordingFailed,
        );
      }
    },
  };
}

export function RecordingBar({ recorder, words }: { recorder: ReturnType<typeof useVoiceRecorder>; words: Words }) {
  return (
    <div className="ci-recording-bar">
      <span className="ci-recording-dot" />
      <span className="ci-recording-label" role="status">
        {recorder.status === "requesting" ? words.requestingMicrophone : words.recording}
      </span>
      <RecordingWaveform stream={recorder.stream} />
      <time>{mediaTime(recorder.seconds)}</time>
      <button type="button" className="ci-plain" onClick={recorder.cancel}>
        {words.cancel}
      </button>
      <button
        type="button"
        className="ci-recording-finish"
        disabled={recorder.status !== "recording"}
        onClick={recorder.finish}
      >
        <MediaIcon kind="stop" />
        {words.finishRecording}
      </button>
    </div>
  );
}

const LIVE_BARS = 48;
const quietBars = () => Array.from({ length: LIVE_BARS }, (_, id) => ({ id, level: 0 }));

/** A rolling history of the microphone's actual amplitude, with no connection to the speakers. */
export function RecordingWaveform({ stream }: { stream: MediaStream | undefined }) {
  const [bars, setBars] = useState(quietBars);
  useEffect(() => {
    setBars(quietBars());
    if (!stream || typeof AudioContext === "undefined") return;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      void context.resume().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      timer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const level = Math.min(1, Math.max(0, (rms - 0.005) * 4));
        setBars((current) => [...current.slice(1), { id: (current.at(-1)?.id ?? 0) + 1, level }]);
      }, 50);
    } catch {
      // An unavailable analyser must not interrupt the recording itself.
      release();
    }
    return release;
  }, [stream]);
  return (
    <svg className="ci-recording-waveform" viewBox="0 0 192 36" preserveAspectRatio="none" aria-hidden="true">
      {bars.map(({ id, level }, index) => {
        const height = Math.max(2, level * 32);
        return (
          <rect
            key={id}
            x={index * 4}
            y={(36 - height) / 2}
            width="2.5"
            height={height}
            rx="1.25"
            opacity={0.25 + (index / LIVE_BARS) * 0.75}
          />
        );
      })}
    </svg>
  );
}

export function LocalAudioPreview({ file, words }: { file: File; words: Words }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const blob = URL.createObjectURL(file);
    setUrl(blob);
    return () => URL.revokeObjectURL(blob);
  }, [file]);
  return (
    <div className="ci-audio-draft">
      {failed ? (
        <p role="alert">{words.fileFailed}</p>
      ) : (
        <MediaPlayer
          kind="audio"
          url={url}
          name={file.name}
          size=""
          loading={false}
          onLoad={async () => {}}
          onError={() => setFailed(true)}
          words={words}
        />
      )}
    </div>
  );
}
