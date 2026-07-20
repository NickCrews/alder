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

export interface AnnotationState {
  audio: Float32Array;
  /** Samples per second of `audio`. */
  sampleRate: number;
  speakers: Speaker[];
  segments: Segment[];
}

/** JSON wire format. `audio` is base64: either a WAV file (sniffed by RIFF
 * magic) or raw little-endian float32 mono PCM, in which case `sample_rate`
 * is required. Serialization always emits raw f32 + sample_rate. */
export interface AnnotationJSON {
  sample_rate?: number;
  audio: string;
  speakers: Speaker[];
  segments: Segment[];
}
