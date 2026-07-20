export interface Speaker {
  id: number;
  label: string;
}

export interface Word {
  /** Seconds since start of clip. A word has no stored end: it extends to the
   * next word's timestamp, or LAST_WORD_DURATION for a segment's last word. */
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
