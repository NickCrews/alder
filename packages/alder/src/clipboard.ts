/** Clipboard text formatting. Pure: the store supplies runs, this shapes them
 * into the two flavors we put on the clipboard, and splits pasted text back
 * into words. */

/** One maximal stretch of adjacent selected words inside a single segment. */
export interface CopyRun {
  /** Speaker label, present only when the whole segment was selected. */
  label?: string;
  words: string[];
}

/** Separator between runs in `text/plain`. Two spaces read as a break, and
 * still collapse to one separator on the way back in (paste splits on
 * whitespace), so copy → paste round-trips exactly. */
const RUN_GAP = "  ";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Unlabeled, so that pasting it back never turns a speaker name into a word. */
export function runsToText(runs: CopyRun[]): string {
  return runs.map((r) => r.words.join(" ")).join(RUN_GAP);
}

/** Labeled, for pasting into a mail client or doc. Only worth writing when at
 * least one run carries a label — otherwise it says nothing `text/plain`
 * doesn't, and every plain-text target reads the cleaner flavor anyway. */
export function runsToHtml(runs: CopyRun[]): string {
  return runs
    .map((r) => {
      const body = escapeHtml(r.words.join(" "));
      return r.label ? `<p><b>${escapeHtml(r.label)}:</b> ${body}</p>` : `<p>${body}</p>`;
    })
    .join("");
}

/** Split pasted text into words. Newlines and tabs are just separators —
 * matching how a word's own edit box splits on space. */
export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
