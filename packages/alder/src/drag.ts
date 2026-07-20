export interface DragOptions {
  /** Called once when movement exceeds the threshold. */
  onStart?: () => void;
  /** Cumulative deltas from pointerdown, only after threshold is crossed. */
  onMove?: (dx: number, dy: number) => void;
  /** moved=false means this was a click (never crossed the threshold). */
  onEnd?: (moved: boolean) => void;
  threshold?: number;
}

/** Attach to a pointerdown event. Distinguishes click from drag by threshold. */
export function startDrag(e: PointerEvent, opts: DragOptions) {
  if (e.button !== 0) return;
  const threshold = opts.threshold ?? 3;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved && Math.hypot(dx, dy) < threshold) return;
    if (!moved) {
      moved = true;
      opts.onStart?.();
    }
    opts.onMove?.(dx, dy);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    opts.onEnd?.(moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
