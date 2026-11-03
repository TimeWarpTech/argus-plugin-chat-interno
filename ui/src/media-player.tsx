import { type CSSProperties, useEffect, useRef, useState } from "react";
import { MediaIcon } from "./media-icons";
import type { Words } from "./words";

// A module registry works across shadow roots, without touching the host's media or dispatching events.
const activePlayers = new Set<HTMLMediaElement>();

export function mediaTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useWaveform(url: string | undefined, enabled: boolean) {
  const [info, setInfo] = useState<{ url: string; peaks: number[]; duration: number }>();
  useEffect(() => {
    if (!url || !enabled || typeof AudioContext === "undefined") return;
    let cancelled = false;
    let context: AudioContext | undefined;
    void (async () => {
      try {
        context = new AudioContext();
        const response = await fetch(url);
        const decoded = await context.decodeAudioData(await response.arrayBuffer());
        if (cancelled) return;
        const channel = decoded.getChannelData(0);
        const count = 48;
        const step = Math.max(1, Math.floor(channel.length / count));
        const values = Array.from({ length: count }, (_, index) => {
          let peak = 0;
          for (let at = index * step; at < Math.min((index + 1) * step, channel.length); at++)
            peak = Math.max(peak, Math.abs(channel[at] ?? 0));
          return peak;
        });
        const maximum = Math.max(...values, 0.01);
        setInfo({ url, peaks: values.map((value) => Math.max(0.08, value / maximum)), duration: decoded.duration });
      } catch {
        // Unsupported decoders still get the seek bar; the media element decides whether playback works.
      } finally {
        if (context && context.state !== "closed") void context.close().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
  }, [url, enabled]);
  return info?.url === url ? info : undefined;
}

interface Props {
  kind: "audio" | "video";
  url: string | undefined;
  name: string;
  size: string;
  loading: boolean;
  onLoad(): Promise<void>;
  onError(): void;
  words: Words;
}

export function MediaPlayer({ kind, url, name, size, loading, onLoad, onError, words }: Props) {
  const element = useRef<HTMLMediaElement | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [nativeDuration, setDuration] = useState(0);
  const [finished, setFinished] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [requested, setRequested] = useState(false);
  const [playProblem, setPlayProblem] = useState(false);
  const preloadRequested = useRef(false);
  const decoded = useWaveform(url, kind === "audio");
  const peaks = decoded?.peaks ?? [];
  // Recorder WebM can have no duration header; decoding the local blob gives a finite timeline.
  const duration = Number.isFinite(nativeDuration) && nativeDuration > 0 ? nativeDuration : (decoded?.duration ?? 0);
  const busy = loading || buffering;
  const waitingToPlay = busy && (requested || playing);
  const seekable = duration > 0 && Number.isFinite(duration);
  const progress = seekable ? Math.min(100, (position / duration) * 100) : 0;

  useEffect(() => {
    if (!playing) return;
    let frameId: number;
    const sync = () => {
      if (element.current) setPosition(element.current.currentTime);
      frameId = requestAnimationFrame(sync);
    };
    if (typeof requestAnimationFrame === "undefined") {
      const timer = setInterval(() => {
        if (element.current) setPosition(element.current.currentTime);
      }, 100);
      return () => clearInterval(timer);
    }
    frameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);

  // Warm nearby media before the user presses play, without fetching the entire history.
  useEffect(() => {
    if (url || loading || preloadRequested.current || !frame.current) return;
    let active = true;
    const preload = () => {
      if (!active || preloadRequested.current) return;
      preloadRequested.current = true;
      void onLoad();
    };
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(preload);
      return () => {
        active = false;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          preload();
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(frame.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [url, loading, onLoad]);

  const play = async () => {
    if (!element.current) return;
    setPlayProblem(false);
    try {
      if (element.current.ended || finished || (seekable && element.current.currentTime >= duration)) {
        element.current.currentTime = 0;
        setPosition(0);
      }
      setFinished(false);
      await element.current.play();
    } catch {
      setPlaying(false);
      setBuffering(false);
      setPlayProblem(true);
    }
  };
  // A user may press play before the authenticated download has produced a blob URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: play reads the current ref; adding its render identity would repeat playback.
  useEffect(() => {
    if (url && requested) {
      setRequested(false);
      void play();
    }
  }, [url, requested]);
  useEffect(() => {
    const media = element.current;
    if (!media) return;
    activePlayers.add(media);
    return () => {
      activePlayers.delete(media);
      media.pause();
    };
  }, []);
  const toggle = () => {
    if (!url) {
      setRequested((current) => !current);
      if (!loading) void onLoad();
    } else if (playing) element.current?.pause();
    else void play();
  };
  const events = {
    onLoadedMetadata: () => setDuration(element.current?.duration ?? 0),
    onDurationChange: () => setDuration(element.current?.duration ?? 0),
    onTimeUpdate: () => setPosition(element.current?.currentTime ?? 0),
    onPlay: () => {
      for (const other of activePlayers) if (other !== element.current && !other.paused) other.pause();
      setPlaying(true);
      setFinished(false);
      setPlayProblem(false);
    },
    onPlaying: () => {
      setPlaying(true);
      setBuffering(false);
    },
    onWaiting: () => setBuffering(true),
    onCanPlay: () => setBuffering(false),
    onPause: () => {
      setPlaying(false);
      setBuffering(false);
    },
    onEnded: () => {
      setPosition(element.current?.currentTime ?? duration);
      setFinished(true);
      setPlaying(false);
      setBuffering(false);
    },
    onError: () => {
      if (url) onError();
    },
  };
  const playLabel = playing || requested ? words.pause : words.play;
  const playButton = (central = false) => (
    <button
      type="button"
      className={central ? "ci-player-center" : "ci-player-play"}
      aria-busy={waitingToPlay}
      aria-label={playLabel}
      title={playLabel}
      onClick={toggle}
    >
      {waitingToPlay ? <span className="ci-spinner" /> : <MediaIcon kind={playing ? "pause" : "play"} />}
    </button>
  );
  const timeline = (
    <span
      className={`ci-player-timeline${peaks.length ? " has-waveform" : ""}`}
      style={{ "--progress": `${progress}%` } as CSSProperties}
    >
      {peaks.length > 0 && (
        <svg className="ci-player-waveform" viewBox="0 0 192 32" preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((peak, index) => (
            <rect
              /* biome-ignore lint/suspicious/noArrayIndexKey: fixed waveform bins never reorder. */
              key={index}
              x={index * 4}
              y={16 - peak * 14}
              width="2.5"
              height={peak * 28}
              rx="1.25"
              className={(index / peaks.length) * 100 < progress ? "is-played" : undefined}
            />
          ))}
        </svg>
      )}
      <input
        type="range"
        className="ci-player-seek"
        aria-label={words.seek}
        aria-valuetext={`${mediaTime(position)} / ${mediaTime(duration)}`}
        min={0}
        max={seekable ? duration : 0}
        step="0.1"
        value={seekable ? Math.min(position, duration) : 0}
        disabled={!seekable}
        onChange={(event) => {
          if (element.current) {
            element.current.currentTime = Number(event.target.value);
            setPosition(element.current.currentTime);
            setFinished(false);
          }
        }}
      />
    </span>
  );
  const rate = (
    <button
      type="button"
      className="ci-player-speed"
      aria-label={words.playbackSpeed}
      title={words.playbackSpeed}
      onClick={() => {
        const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
        setSpeed(next);
        if (element.current) element.current.playbackRate = next;
      }}
    >
      {speed}×
    </button>
  );
  const download = url && (
    <a className="ci-player-button" href={url} download={name} aria-label={`${words.save}: ${name}`} title={words.save}>
      <MediaIcon kind="download" />
    </a>
  );

  return (
    <div
      ref={frame}
      className={`ci-player ci-player-${kind}${playing ? " is-playing" : ""}${busy ? " is-buffering" : ""}`}
    >
      {kind === "video" ? (
        <video
          ref={(node) => {
            element.current = node;
          }}
          src={url}
          aria-label={name}
          preload="metadata"
          playsInline
          {...events}
        />
      ) : (
        <audio
          ref={(node) => {
            element.current = node;
          }}
          src={url}
          aria-label={name}
          preload="metadata"
          {...events}
        />
      )}
      {kind === "audio" ? (
        <>
          <div className="ci-player-audio-top">
            <span className="ci-player-type">
              <MediaIcon kind="audio" />
              {words.audio}
            </span>
            <span className="ci-player-filename" title={name}>
              {name}
            </span>
          </div>
          <div className="ci-player-audio-main">
            {playButton()}
            <div className="ci-player-audio-track">
              {timeline}
              <span className="ci-player-times">
                <span>{mediaTime(position)}</span>
                <span className="ci-player-time-divider" aria-hidden="true">
                  /
                </span>
                <span>{seekable ? mediaTime(duration) : size}</span>
              </span>
            </div>
          </div>
          <div className="ci-player-audio-footer">
            <span className="ci-player-status" role="status">
              {playProblem
                ? words.playFailed
                : playing
                  ? words.playing
                  : finished
                    ? words.playbackEnded
                    : words.audioMessage}
            </span>
            {rate}
            {download}
          </div>
        </>
      ) : (
        <>
          {!url && (
            <div className="ci-player-video-empty">
              <MediaIcon kind="video" />
              <span className="ci-player-video-name">{name}</span>
              <span className="ci-player-video-size">{size}</span>
            </div>
          )}
          {(!playing || busy) && <div className="ci-player-center-wrap">{playButton(true)}</div>}
          <div className="ci-player-video-controls">
            <div className="ci-player-video-toolbar">
              {playButton()}
              <span className="ci-player-video-time">
                {mediaTime(position)} <span className="ci-player-total">/ {mediaTime(duration)}</span>
              </span>
              <span className="ci-player-controls-spacer" />
              {rate}
              <button
                type="button"
                className="ci-player-button"
                aria-label={muted ? words.unmute : words.mute}
                title={muted ? words.unmute : words.mute}
                onClick={() => {
                  if (element.current) {
                    element.current.muted = !muted;
                    setMuted(!muted);
                  }
                }}
              >
                <MediaIcon kind={muted ? "muted" : "volume"} />
              </button>
              <button
                type="button"
                className="ci-player-button"
                aria-label={words.fullscreen}
                title={words.fullscreen}
                disabled={!document.fullscreenEnabled}
                onClick={() => {
                  const action = document.fullscreenElement
                    ? document.exitFullscreen()
                    : frame.current?.requestFullscreen();
                  void action?.catch(() => setPlayProblem(true));
                }}
              >
                <MediaIcon kind="expand" />
              </button>
              {download}
            </div>
            {timeline}
          </div>
          {playProblem && (
            <span className="ci-player-video-status" role="status">
              {words.playFailed}
            </span>
          )}
        </>
      )}
    </div>
  );
}
