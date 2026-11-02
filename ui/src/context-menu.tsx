import { useEffect, useLayoutEffect, useRef } from "react";
import { Icon, type IconName } from "./components";

export interface MenuAction {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  run(): void;
}

export interface MenuPosition {
  x: number;
  y: number;
  source: HTMLElement;
}

export function ContextMenu({
  position,
  label,
  actions,
  onClose,
}: {
  position: MenuPosition;
  label: string;
  actions: MenuAction[];
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))}px`;
  }, [position]);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      // Native events are retargeted at the shadow host; composedPath identifies the actual menu.
      if (menu.current && !event.composedPath().includes(menu.current)) close.current();
    };
    const dismiss = () => close.current();
    window.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("contextmenu", dismissOutside, true);
    window.addEventListener("scroll", dismissOutside, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("contextmenu", dismissOutside, true);
      window.removeEventListener("scroll", dismissOutside, true);
      window.removeEventListener("resize", dismiss);
      if (position.source.isConnected) position.source.focus({ preventScroll: true });
    };
  }, [position]);
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="ci-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          close.current();
          return;
        }
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : undefined;
        if (next !== undefined) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className={action.danger ? "is-danger" : undefined}
          onClick={() => {
            close.current();
            action.run();
          }}
        >
          <Icon name={action.icon} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
