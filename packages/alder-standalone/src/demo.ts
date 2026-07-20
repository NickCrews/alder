import {
  base64ToBytes,
  decodeAudioBytes,
  type AnnotationState,
  type Segment,
  type Word,
} from "@nickcrews/alder";
// 3.85s, 16 kHz mono PCM. Vendored from open-minutes' pipeline test fixture
// (the sherpa/NeMo "en.wav" sample resampled to 16 kHz).
import wavInline from "./assets/en-16k.wav?inline";

// The clip's known transcript, split at the clause boundary so the demo opens
// with two segments. Word timestamps below are estimated (proportional to word
// length within each clause) — fixing them is what the tool is for.
const CLAUSES = [
  ["Ask", "not", "what", "your", "country", "can", "do", "for", "you,"],
  ["ask", "what", "you", "can", "do", "for", "your", "country."],
];

function spreadWords(texts: string[], start: number, end: number): Word[] {
  const weights = texts.map((t) => t.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = end - start;
  let acc = 0;
  return texts.map((text, i) => {
    const timestamp = start + (span * acc) / total;
    acc += weights[i];
    return { timestamp, text };
  });
}

export function makeDemo(): AnnotationState {
  const b64 = wavInline.slice(wavInline.indexOf(",") + 1);
  const { audio, sampleRate } = decodeAudioBytes(base64ToBytes(b64));
  const duration = audio.length / sampleRate;

  const segments: Segment[] = [
    { speaker_id: 0, words: spreadWords(CLAUSES[0], 0.04 * duration, 0.48 * duration) },
    { speaker_id: 0, words: spreadWords(CLAUSES[1], 0.54 * duration, 0.96 * duration) },
  ];

  return {
    audio,
    sampleRate,
    speakers: [{ id: 0, label: "Speaker 1" }],
    segments,
  };
}
