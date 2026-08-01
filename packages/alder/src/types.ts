export interface Speaker {
  id: number;
  label: string;
}

export interface Word {
  /** Seconds since start of clip. A word has no stored end: it extends to the
   * next word's timestamp. A segment's last word has no next word, so it runs
   * for the median word duration across the whole document (see
   * `lastWordDuration`), falling back to LAST_WORD_DURATION while the document
   * has no adjacent pair to measure. */
  timestamp: number;
  text: string;
}

export interface Segment {
  speaker_id: number;
  words: Word[];
}

/** The editable document: who spoke and what they said. It is also the JSON
 * wire format — `serializeAnnotation` emits exactly this shape. Audio is a
 * separate concern: it reaches the annotator through an {@link AudioSource},
 * never as part of this state, and the two travel as sidecar resources (see the
 * CLI, which pairs a `.psv` transcript with its `.wav`). */
export interface AnnotationState {
  speakers: Speaker[];
  segments: Segment[];
}
