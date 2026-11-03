import { useEffect, useId, useRef } from "react";
import { hueOf, initialsOf, type Message } from "./model";
import type { Words } from "./words";

export function ReceiptMark({ message, words }: { message: Message; words: Words }) {
  if (message.deletedAt) return null;
  const receipts = message.receipts ?? [];
  const read = receipts.length > 0 && receipts.every((receipt) => receipt.read);
  const delivered = receipts.length > 0 && receipts.every((receipt) => receipt.delivered);
  const label = read ? words.readMessage : delivered ? words.deliveredMessage : words.sentMessage;
  return (
    <span className={`ci-receipt${read ? " is-read" : ""}`} role="img" aria-label={label} title={label}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m3 12 4 4L17 6" />
        {(read || delivered) && <path d="m12 14 2 2L24 6" />}
      </svg>
    </span>
  );
}

export function InfoDialog({
  title,
  fields,
  closeLabel,
  description,
  onClose,
}: {
  title: string;
  fields: [string, string][];
  closeLabel: string;
  description?: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ci-delete-dialog ci-info-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {description && <p>{description}</p>}
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="ci-actions">
        <button type="button" className="ci-go" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: string | undefined;
  onConfirm(): void;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ci-delete-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={(event) => {
        // StrictMode can close and reopen the same dialog before its queued close event arrives.
        if (!busy && !event.currentTarget.open) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && (
        <p className="ci-problem" role="alert">
          {error}
        </p>
      )}
      <div className="ci-actions">
        <button type="button" className="ci-plain" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="ci-go ci-danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function Avatar({ name, person, size = "sm" }: { name: string; person: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`ci-avatar ci-avatar-${size}`}
      style={{ ["--person" as string]: `${hueOf(person)}` }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

export type IconName =
  | "back"
  | "next"
  | "check"
  | "search"
  | "group"
  | "chat"
  | "close"
  | "copy"
  | "info"
  | "trash"
  | "logout"
  | "reply"
  | "more";

export function Icon({ name }: { name: IconName }) {
  const paths = {
    back: "m15 18-6-6 6-6M9 12h12",
    next: "m9 6 6 6-6 6M3 12h12",
    check: "m5 12 4 4L19 6",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    group:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5a10 10 0 0 1 20 0ZM7 10h8M7 14h5",
    close: "m6 6 12 12M6 18 18 6",
    copy: "M9 9h12v12H9zM5 15H3V3h12v2",
    info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    logout: "M9 21H3V3h6M12 12h10m-5-5 5 5-5 5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    reply: "m9 10-5 5 5 5M4 15h10a6 6 0 0 0 0-12h-2",
  };
  return (
    <svg
      className="ci-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
