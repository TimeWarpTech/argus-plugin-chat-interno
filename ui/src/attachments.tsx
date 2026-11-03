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
import { MediaIcon as MediaGlyph } from "./media-icons";
import { MediaPlayer } from "./media-player";
import { Viewer, type Viewing } from "./viewer";
import type { Words } from "./words";

const isImage = (file: Attachment) => file.mimeType.startsWith("image/");
const isVideo = (file: Attachment) => file.mimeType.startsWith("video/");
const isAudio = (file: Attachment) => file.mimeType.startsWith("audio/");
const isPdf = (file: Attachment) => file.mimeType.toLowerCase() === "application/pdf";

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
        <AttachmentView key={file.id} file={file} messageId={messageId} call={call} words={words} locale={locale} />
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
  const requestToken = useRef(0);
  const pendingRequest = useRef(0);

  const fetchIt = async () => {
    if (held.current !== undefined || pendingRequest.current !== 0) return;
    const request = ++requestToken.current;
    pendingRequest.current = request;
    setState("loading");
    try {
      const bytes = await downloadMedia(call, file, { messageId });
      if (request !== requestToken.current) return;
      // `bytes.buffer` rather than the view: `downloadMedia` hands back a fresh array, and the
      // DOM's BlobPart will not take a view that might be over a SharedArrayBuffer.
      const blob = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: file.mimeType }));
      held.current = blob;
      setUrl(blob);
      setState("idle");
    } catch {
      if (request === requestToken.current) setState("failed");
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = 0;
    }
  };

  // An image is what the conversation is about, so it arrives without being asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the file id on purpose. `fetchIt` is a new function every render and `file` a new object, so either one in the list would re-run the effect on every render -- and the cleanup revokes the blob URL, so the picture would be torn down right after it loaded.
  useEffect(() => {
    if (isImage(file) || isPdf(file)) void fetchIt();
    // Let go of the blob when this message leaves the screen, or the tab keeps every file ever seen.
    return () => {
      requestToken.current++;
      pendingRequest.current = 0;
      if (held.current !== undefined) {
        URL.revokeObjectURL(held.current);
        held.current = undefined;
      }
    };
  }, [file.id]);

  if (state === "failed") {
    return (
      <span className="ci-file" role="alert">
        <span className="ci-file-text">
          <span className="ci-file-name">{file.name}</span>
          <span className="ci-file-failed">{words.fileFailed}</span>
        </span>
        <button type="button" className="ci-plain" onClick={() => void fetchIt()}>
          {words.retry}
        </button>
      </span>
    );
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
        {viewing !== undefined && <Viewer viewing={viewing} words={words} onClose={() => setViewing(undefined)} />}
      </>
    );
  }

  if ((isVideo(file) || isAudio(file)) && !undrawable) {
    return (
      <MediaPlayer
        kind={isVideo(file) ? "video" : "audio"}
        url={url}
        name={file.name}
        size={sizeOf(file.size, locale)}
        loading={state === "loading"}
        onLoad={fetchIt}
        onError={() => setUndrawable(true)}
        words={words}
      />
    );
  }

  if (url === undefined && (isImage(file) || isVideo(file))) {
    return (
      <button
        type="button"
        className="ci-media-placeholder"
        disabled={state === "loading"}
        onClick={() => void fetchIt()}
        aria-label={`${words.show}: ${file.name}`}
      >
        <span className="ci-media-load">
          {state === "loading" ? (
            <span className="ci-spinner" />
          ) : (
            <MediaGlyph kind={isVideo(file) ? "play" : "download"} />
          )}
        </span>
        <span>{state === "loading" ? words.loading : words.show}</span>
        <span className="ci-media-size">{sizeOf(file.size, locale)}</span>
      </button>
    );
  }

  const card = (
    <span className="ci-file">
      <span className={`ci-document-icon${isPdf(file) ? " is-pdf" : ""}`} aria-hidden="true">
        <MediaGlyph kind="document" />
      </span>
      <span className="ci-file-text">
        <span className="ci-file-name">{file.name}</span>
        <span className="ci-file-size">
          {file.name.split(".").pop()?.toUpperCase()} · {sizeOf(file.size, locale)}
        </span>
      </span>
      {url === undefined ? (
        <button
          type="button"
          className="ci-file-download"
          disabled={state === "loading"}
          title={words.download}
          aria-label={`${words.download}: ${file.name}`}
          onClick={() => void fetchIt()}
        >
          {state === "loading" ? <span className="ci-spinner" /> : <MediaGlyph kind="download" />}
        </button>
      ) : (
        <a
          className="ci-file-download"
          href={url}
          download={file.name}
          title={words.save}
          aria-label={`${words.save}: ${file.name}`}
        >
          <MediaGlyph kind="download" />
        </a>
      )}
    </span>
  );

  if (!isPdf(file)) return card;

  return (
    <span className="ci-pdf">
      {url !== undefined ? (
        <>
          <iframe
            className="ci-pdf-preview"
            src={`${url}#page=1&view=FitH&toolbar=0&navpanes=0`}
            title={`${words.pdfPreview}: ${file.name}`}
          />
          <button
            type="button"
            className="ci-pdf-open"
            onClick={() => setViewing({ url, name: file.name, kind: "pdf" })}
          >
            {words.openPdf}
          </button>
        </>
      ) : (
        <span className="ci-pdf-loading" role="status">
          <span className="ci-spinner" />
          {words.loading}
        </span>
      )}
      {card}
      {viewing !== undefined && <Viewer viewing={viewing} words={words} onClose={() => setViewing(undefined)} />}
    </span>
  );
}
