/**
 * Looking at a picture properly.
 *
 * Clicking one used to download it, which is almost never what somebody wants from an image in a
 * conversation: they want to see it bigger. Downloading is still here, as the thing it should be —
 * a choice, next to the picture, rather than what clicking does.
 *
 * It renders inside this plugin's own shadow root and positions itself against the viewport, so it
 * covers the product's window without the plugin reaching outside its own tree.
 */
import { useEffect } from "react";
import type { Words } from "./words";

export interface Viewing {
  url: string;
  name: string;
}

export function Viewer({
  viewing,
  words,
  onClose,
}: {
  viewing: Viewing;
  words: Words;
  onClose(): void;
}) {
  // Escape closes it, as it closes everything else somebody has ever used.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes on click; the dialog
    // itself is reachable by keyboard, and Escape closes it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: same.
    <div className="ci-viewer" role="dialog" aria-modal="true" aria-label={viewing.name} onClick={onClose}>
      <div className="ci-viewer-bar">
        <span className="ci-viewer-name">{viewing.name}</span>
        <a
          className="ci-viewer-action"
          href={viewing.url}
          download={viewing.name}
          onClick={(event) => event.stopPropagation()}
        >
          {words.save}
        </a>
        <button type="button" className="ci-viewer-action" onClick={onClose} aria-label={words.close}>
          ✕
        </button>
      </div>
      {/* Stops the click from reaching the backdrop: clicking the picture itself should not close
          what somebody opened to look at. */}
      <img
        className="ci-viewer-image"
        src={viewing.url}
        alt={viewing.name}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
