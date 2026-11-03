export type MediaIconName =
  | "play"
  | "pause"
  | "download"
  | "document"
  | "audio"
  | "video"
  | "volume"
  | "muted"
  | "mic"
  | "stop"
  | "expand";

export function MediaIcon({ kind }: { kind: MediaIconName }) {
  const paths: Record<MediaIconName, string> = {
    play: "m9 5 11 7-11 7Z",
    pause: "M8 5v14M16 5v14",
    download: "M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4",
    document: "M14 2H5v20h14V7Zm0 0v6h5M8 12h8M8 16h6",
    audio: "M9 18V5l12-3v13M9 6l12-3M9 18a3 3 0 1 1-3-3h3M21 15a3 3 0 1 1-3-3h3",
    video: "M3 5h18v14H3zM3 9h18M7 5l4 4m3-4 4 4",
    volume: "M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
    muted: "M11 4 5 9H2v6h3l6 5ZM16 9l6 6M16 15l6-6",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
    stop: "M6 6h12v12H6Z",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill={kind === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={kind === "pause" ? 4 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
