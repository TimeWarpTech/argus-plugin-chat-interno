import type { Attachment, MediaCall } from "@creativepetabyte/argus-chat-media";
import { useEffect, useRef, useState } from "react";
import { sizeOf } from "./attachments";
import { MediaIcon } from "./media-icons";
import { uploadAttachment } from "./upload";
import type { Words } from "./words";

export interface PendingUpload {
  id: string;
  conversationId: string;
  file: File;
  text: string;
  replyToId: string | undefined;
  preview: string | undefined;
  attachment: Attachment | undefined;
  progress: number;
  status: "uploading" | "sending" | "failed";
  at: string;
}
type Job = PendingUpload & { controller: AbortController; running: boolean };
type Send = (text: string, ids: readonly string[], replyToId?: string, conversationId?: string) => Promise<boolean>;

export function usePendingUploads(call: MediaCall | undefined, send: Send) {
  const jobs = useRef(new Map<string, Job>());
  const mounted = useRef(true);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const publish = () => {
    if (mounted.current) setUploads([...jobs.current.values()].map((job) => ({ ...job })));
  };
  useEffect(() => {
    mounted.current = true;
    const current = jobs.current;
    return () => {
      mounted.current = false;
      for (const job of current.values()) {
        job.controller.abort();
        if (job.preview) URL.revokeObjectURL(job.preview);
      }
    };
  }, []);
  const remove = (job: Job) => {
    jobs.current.delete(job.id);
    if (job.preview) URL.revokeObjectURL(job.preview);
    publish();
  };
  const run = async (job: Job) => {
    if (!call || job.running) return;
    job.running = true;
    job.status = job.attachment ? "sending" : "uploading";
    if (!job.attachment) job.progress = 0;
    publish();
    try {
      if (!job.attachment)
        job.attachment = await uploadAttachment(
          call,
          {
            name: job.file.name,
            mimeType: job.file.type,
            bytes: new Uint8Array(await job.file.arrayBuffer()),
          },
          (progress) => {
            job.progress = progress;
            publish();
          },
          job.controller.signal,
        );
      job.controller.signal.throwIfAborted();
      job.status = "sending";
      publish();
      if (!(await send(job.text, [job.attachment.id], job.replyToId, job.conversationId)))
        throw new Error("send_failed");
      remove(job);
    } catch {
      if (job.controller.signal.aborted) {
        if (job.attachment) void call("DeleteAttachment", { attachmentId: job.attachment.id }).catch(() => {});
      } else {
        job.status = "failed";
        publish();
      }
    } finally {
      job.running = false;
    }
  };
  return {
    uploads,
    enqueue(conversationId: string, file: File, text: string, replyToId?: string) {
      if (!call) return false;
      const job: Job = {
        id: crypto.randomUUID(),
        conversationId,
        file,
        text,
        replyToId,
        preview:
          file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : undefined,
        attachment: undefined,
        progress: 0,
        status: "uploading",
        at: new Date().toISOString(),
        controller: new AbortController(),
        running: false,
      };
      jobs.current.set(job.id, job);
      void run(job);
      return true;
    },
    retry(id: string) {
      const job = jobs.current.get(id);
      if (job?.status === "failed") void run(job);
    },
    discard(id: string) {
      const job = jobs.current.get(id);
      if (job?.status !== "failed") return;
      if (job.attachment && call) void call("DeleteAttachment", { attachmentId: job.attachment.id }).catch(() => {});
      remove(job);
    },
  };
}

export function PendingUploadBubble({
  upload,
  words,
  locale,
  time,
  onRetry,
  onDiscard,
}: {
  upload: PendingUpload;
  words: Words;
  locale: string;
  time: Intl.DateTimeFormat;
  onRetry(id: string): void;
  onDiscard(id: string): void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const label =
    upload.status === "failed"
      ? words.uploadFailed
      : upload.status === "sending"
        ? words.confirmingSend
        : words.sendingFile;
  return (
    <div className="ci-run is-mine ci-pending-run">
      <article
        className={`ci-bubble has-media ci-pending${upload.status === "failed" ? " is-failed" : ""}`}
        aria-label={words.sendingFile}
      >
        <div className={`ci-pending-preview${upload.preview && !previewFailed ? " has-preview" : ""}`}>
          {upload.preview && !previewFailed ? (
            upload.file.type.startsWith("video/") ? (
              <video src={upload.preview} muted playsInline preload="metadata" onError={() => setPreviewFailed(true)} />
            ) : (
              <img src={upload.preview} alt={upload.file.name} onError={() => setPreviewFailed(true)} />
            )
          ) : (
            <span className="ci-pending-file-icon">
              <MediaIcon kind={upload.file.type.startsWith("audio/") ? "audio" : "document"} />
            </span>
          )}
          <span className="ci-pending-indicator">
            {upload.status === "failed" ? (
              "!"
            ) : (
              <>
                {upload.progress}
                <small>%</small>
              </>
            )}
          </span>
        </div>
        <div className="ci-pending-body">
          <strong title={upload.file.name}>{upload.file.name}</strong>
          <span className="ci-pending-size">{sizeOf(upload.file.size, locale)}</span>
          <progress className="ci-upload-progress" max={100} value={upload.progress} aria-label={words.sendingFile} />
          <span className="ci-pending-status" role="status">
            {label}
          </span>
          {upload.status === "failed" && (
            <div className="ci-pending-actions">
              <button type="button" onClick={() => onRetry(upload.id)}>
                {words.retry}
              </button>
              <button type="button" onClick={() => onDiscard(upload.id)}>
                {words.discardUpload}
              </button>
            </div>
          )}
        </div>
        {upload.text && <span className="ci-text">{upload.text}</span>}
        <time className="ci-at" dateTime={upload.at}>
          {time.format(new Date(upload.at))}
          <span className="ci-pending-clock" aria-hidden="true">
            ◷
          </span>
        </time>
      </article>
    </div>
  );
}
