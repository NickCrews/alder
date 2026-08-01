export type { AnnotationState, Segment, Speaker, Word } from "./types";
export { Annotator } from "./components/Annotator";
export type { AnnotatorHandle, AnnotatorProps } from "./components/Annotator";
export { mountAnnotator } from "./mount";
export type { MountedAnnotator } from "./mount";
export {
  base64ToBytes,
  bytesToBase64,
  decodeAudioBytes,
  isWav,
  parseAnnotation,
  parseWav,
  serializeAnnotation,
  serializeAnnotationString,
} from "./serde";
export { LAST_WORD_DURATION, lastWordDuration, segEnd, segStart, wordEnd } from "./time";
export { assignLanes } from "./lanes";
export { bufferSource, bufferSourceFromBytes, urlSource, wavRangeSource } from "./audio";
export type { AudioSource, Peaks } from "./audio";
export { decodeWindow, parseWavHeader } from "./wav";
export type { WavHeader } from "./wav";
export { createBufferPlayer, createElementPlayer } from "./player";
export type { Player } from "./player";
export { createAnnotatorStore } from "./store";
export type { AnnotatorStore, SegRec, Selection, StoreOptions } from "./store";
export { speakerColor } from "./colors";
