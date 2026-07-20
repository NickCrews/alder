import { type JSX, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/** Where a menu's top-left corner sits, in viewport coordinates. */
export type MenuPos = { x: number; y: number };

/** Roughly the menu's min-width — enough to keep it on screen when clicking near the right edge. */
const MENU_WIDTH = 160;

/** Position a menu at a mouse event, nudged clear of the pointer and the viewport edge. */
export function menuPosAt(e: MouseEvent): MenuPos {
  return {
    x: Math.min(e.clientX, Math.max(0, window.innerWidth - MENU_WIDTH)),
    y: e.clientY + 2,
  };
}

/** Floating menu panel, portaled to the body so it isn't clipped by track overflow.
 * A full-screen backdrop closes it on any outside press; Escape does the same. */
export function ContextMenu(props: {
  pos: MenuPos;
  onClose: () => void;
  children: JSX.Element;
}) {
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  return (
    <Portal>
      <div
        class="fixed inset-0 z-40"
        onPointerDown={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div
        class="alder-root fixed z-50 min-w-32 rounded-md border border-zinc-700 bg-zinc-800 py-1 font-sans text-xs text-zinc-100 shadow-xl shadow-black/40"
        style={{ left: `${props.pos.x}px`, top: `${props.pos.y}px` }}
      >
        {props.children}
      </div>
    </Portal>
  );
}

/** One clickable row in a {@link ContextMenu}. */
export function MenuItem(props: {
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-zinc-700 disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent"
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onSelect()}
    >
      {props.children}
    </button>
  );
}
