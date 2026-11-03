import type { PluginHostProps } from "@creativepetabyte/argus-sdk/ui";
import { CHAT_ROUTE } from "../../shared/navigation.js";
import { wordsFor } from "./words";

/** Own the SVG instead of depending on the shell's icon registry. */
export function ChatInternoNavigation({ locale = "pt-BR", navigate, pathname }: PluginHostProps) {
  const label = wordsFor(locale).internalChat;
  const href = `/app/${CHAT_ROUTE}`;
  const active = pathname === href || pathname?.startsWith(`${href}/`) === true;
  return (
    <a
      className={`ci-navigation${active ? " is-active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (navigate && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          navigate(CHAT_ROUTE);
        }
      }}
    >
      <span className="ci-navigation-icon" aria-hidden="true">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 3h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7l-4 3V6a3 3 0 0 1 2-3Z" />
          <path d="M18 8h1a3 3 0 0 1 3 3v9l-4-3h-6a3 3 0 0 1-3-3M7 8h6" />
        </svg>
      </span>
      <span className="ci-navigation-label">{label}</span>
    </a>
  );
}
