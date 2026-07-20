import css from "./styles.css?inline";

let injected = false;

/** Inject the component's compiled stylesheet once per document. */
export function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  if (!document.querySelector("style[data-alder]")) {
    const el = document.createElement("style");
    el.setAttribute("data-alder", "");
    el.textContent = css;
    document.head.appendChild(el);
  }
  injected = true;
}
