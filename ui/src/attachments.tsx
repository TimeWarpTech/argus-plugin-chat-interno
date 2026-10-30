/**
 * Showing what came with a message.
 *
 * The bytes are not in the message and there is no URL to point at: a file is fetched piece by piece
 * over the same authenticated contract call, then held as a blob URL for as long as the screen shows
 * it. An image is fetched as soon as it is on screen, because that is what somebody opened the
 * conversation to see; anything heavier waits to be asked for.
 */
import { type Attachment, downloadMedia, type MediaCall } from "@creativepetabyte/argus-chat-media";
import { useEffect, useRef, useState } from "react";
import { Viewer, type Viewing } from "./viewer";
import type { Words } from "./words";

const isImage = (file: Attachment) => file.mimeType.startsWith("image/");
const isVideo = (file: Attachment) => file.mimeType.startsWith("video/");
const isAudio = (file: Attachment) => file.mimeType.startsWith("audio/");

/** A size somebody can read, in their own language. */
export function sizeOf(bytes: number, locale: string): string {
  const units = ["B", "kB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

interface Props {
  files: readonly Attachment[];
  messageId: string;
  call: MediaCall;
  words: Words;
  locale: string;
}

export function Attachments({ files, messageId, call, words, locale }: Props) {
  return (
    <>
      {files.map((file) => (
        <AttachmentView
          key={file.id}
          file={file}
          messageId={messageId}
          call={call}
          words={words}
          locale={locale}
        />
      ))}
    </>
  );
}

interface OneProps {
  file: Attachment;
  messageId: string;
  call: MediaCall;
  words: Words;
  locale: string;
}

function AttachmentView({ file, messageId, call, words, locale }: OneProps) {
  const [url, setUrl] = useState<string>();
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  /** Set when the bytes arrived but the browser could not decode them. */
  const [undrawable, setUndrawable] = useState(false);
  /** The picture somebody opened to look at, full size. */
  const [viewing, setViewing] = useState<Viewing>();
  const held = useRef<string | undefined>(undefined);

  const fetchIt = async () => {
    if (held.current !== undefined || state === "loading") return;
    setState("loading");
    try {
      const bytes = await downloadMedia(call, file, { messageId });
      // `bytes.buffer` rather than the view: `downloadMedia` hands back a fresh array, and the
      // DOM's BlobPart will not take a view that might be over a SharedArrayBuffer.
      const blob = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: file.mimeType }));
      held.current = blob;
      setUrl(blob);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  // An image is what the conversation is about, so it arrives without being asked for.
  useEffect(() => {
    if (isImage(file)) void fetchIt();
    // Let go of the blob when this message leaves the screen, or the tab keeps every file ever seen.
    return () => {
      if (held.current !== undefined) {
        URL.revokeObjectURL(held.current);
        held.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  if (state === "failed") {
    return <span className="ci-file-failed">{words.fileFailed}</span>;
  }

  if (url !== undefined && isImage(file) && !undrawable) {
    return (
      <>
        <button
          type="button"
          className="ci-shot"
          title={file.name}
          // Clicking an image opens it. It used to download it, which is almost never what somebody
          // wants from a picture in a conversation.
          onClick={() => setViewing({ url, name: file.name })}
        >
          {/* A file that says it is an image but cannot be decoded falls back to the card below,
              rather than leaving a silent blank where a picture should be. */}
          <img src={url} alt={file.name} loading="lazy" onError={() => setUndrawable(true)} />
        </button>
        {viewing !== undefined && (
          <Viewer viewing={viewing} words={words} onClose={() => setViewing(undefined)} />
        )}
      </>
    );
  }

  if (url !== undefined && isVideo(file)) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video className="ci-shot" src={url} controls preload="metadata" />;
  }

  if (url !== undefined && isAudio(file)) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio className="ci-audio" src={url} controls preload="metadata" />;
  }

  return (
    <span className="ci-file">
      <span className="ci-file-text">
        <span className="ci-file-name">{file.name}</span>
        <span className="ci-file-size">{sizeOf(file.size, locale)}</span>
      </span>
      {url === undefined ? (
        <button type="button" className="ci-plain" onClick={() => void fetchIt()}>
          {state === "loading" ? words.loading : isImage(file) ? words.show : words.download}
        </button>
      ) : (
        <a className="ci-plain" href={url} download={file.name}>
          {words.save}
        </a>
      )}
    </span>
  );
}
