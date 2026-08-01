/** `npx @nickcrews/alder <dir>` — open a directory's `.psv` transcript plus
 * its `.wav` in the alder annotator, and write edits straight back to the
 * `.psv`. Built for maintaining golden annotations by hand.
 *
 * The audio is never loaded into memory here: the server is a dumb static host
 * that serves the `.wav` with byte-range support and nothing more. The browser
 * reads the header for duration, range-requests the bytes the waveform needs,
 * and streams playback through an `<audio>` element — so a three-hour meeting
 * costs a few megabytes in the tab, and the same frontend works against any
 * static host (object store, GitHub Pages) with no peak precompute. */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile, rename, stat, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotationToPsv,
  parsePsv,
  psvToAnnotation,
  rewritePsv,
  segEndOf,
  segStartOf,
  type ParsedPsv,
} from "./psv";
import { parseRange, readWavInfo, type WavInfo } from "./wav";

const USAGE = `alder — annotate a .psv transcript against its .wav

  npx @nickcrews/alder <dir-or-psv> [options]

Options:
  --psv <file>     transcript to edit   (default: the one .psv in <dir>)
  --audio <file>   audio to play        (default: the one .wav in <dir>)
  --port <n>       listen on this port  (default: first free from 4173)
  --no-open        don't launch a browser
  -h, --help       show this

Edits are written back to the .psv in place. Segments you don't touch
re-render byte-for-byte, so the diff only ever shows what you actually
changed.`;

interface Options {
  target: string;
  psv?: string;
  audio?: string;
  port?: number;
  open: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { target: "", open: true };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (): string => {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--psv") opts.psv = need();
    else if (a === "--audio") opts.audio = need();
    else if (a === "--port") opts.port = Number(need());
    else if (a === "--no-open") opts.open = false;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error("expected exactly one directory or .psv path");
  opts.target = positional[0];
  return opts;
}

/** Resolve which transcript and which audio file we're working on. */
async function resolveFiles(opts: Options): Promise<{ psv: string; audio: string }> {
  const target = resolve(opts.target);
  const st = await stat(target).catch(() => null);
  if (!st) throw new Error(`no such file or directory: ${target}`);

  let dir = target;
  let psv = opts.psv ? resolve(opts.psv) : undefined;
  if (st.isFile()) {
    dir = dirname(target);
    if (!psv && extname(target).toLowerCase() === ".psv") psv = target;
  }

  const pick = async (ext: string, flag: string): Promise<string> => {
    const names = (await readdir(dir)).filter((n) => extname(n).toLowerCase() === ext);
    if (names.length === 1) return join(dir, names[0]);
    if (names.length === 0) throw new Error(`no ${ext} file in ${dir} (pass ${flag})`);
    throw new Error(`several ${ext} files in ${dir} — pass ${flag}: ${names.join(", ")}`);
  };

  return {
    psv: psv ?? (await pick(".psv", "--psv")),
    audio: opts.audio ? resolve(opts.audio) : await pick(".wav", "--audio"),
  };
}

interface Session {
  psvPath: string;
  parsed: ParsedPsv;
  /** Guards against clobbering edits made outside this session. */
  fingerprint: string;
  wav: WavInfo;
}

async function fingerprintOf(path: string): Promise<string> {
  const s = await stat(path);
  return `${s.size}:${s.mtimeMs}`;
}

interface SavePayload {
  speakers: { id: number; label: string }[];
  segments: { speaker_id: number; words: { timestamp: number; text: string }[] }[];
}

async function save(session: Session, payload: SavePayload): Promise<{ words: number; segments: number }> {
  if ((await fingerprintOf(session.psvPath)) !== session.fingerprint) {
    throw new Error(
      `${basename(session.psvPath)} changed on disk since it was loaded — refusing to overwrite. ` +
      `Restart alder to pick up the new file.`,
    );
  }
  const next = annotationToPsv(payload, session.parsed.segments);

  const overlaps = next.filter((s, i) => i > 0 && segStartOf(s) < segEndOf(next[i - 1]));
  if (overlaps.length) {
    console.warn(
      `  ! ${overlaps.length} segment(s) overlap in time. PSV is one flat stream, so on reload ` +
      `their words regroup under whichever segment starts last.`,
    );
  }

  const text = rewritePsv(session.parsed, next);
  const tmp = `${session.psvPath}.alder-tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, session.psvPath);

  // Re-parse so the next save diffs against what is actually on disk.
  session.parsed = parsePsv(text);
  session.fingerprint = await fingerprintOf(session.psvPath);
  return { segments: next.length, words: next.reduce((n, s) => n + s.words.length, 0) };
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Serve the .wav with range support, which is what lets the browser seek
 * into the middle of a long file without downloading the front of it. */
function serveAudio(req: IncomingMessage, res: ServerResponse, wav: WavInfo): void {
  const range = parseRange(req.headers.range, wav.size);
  const common = { "content-type": "audio/wav", "accept-ranges": "bytes" };
  if (!range) {
    res.writeHead(200, { ...common, "content-length": wav.size });
    if (req.method === "HEAD") return void res.end();
    createReadStream(wav.path).pipe(res);
    return;
  }
  res.writeHead(206, {
    ...common,
    "content-length": range.end - range.start + 1,
    "content-range": `bytes ${range.start}-${range.end}/${wav.size}`,
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(wav.path, { start: range.start, end: range.end }).pipe(res);
}

function appHtml(): Promise<Buffer> {
  return readFile(fileURLToPath(new URL("./index.html", import.meta.url)));
}

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s).padStart(2, "0")}s`;
}

async function listen(server: ReturnType<typeof createServer>, port?: number): Promise<number> {
  const candidates = port ? [port] : Array.from({ length: 20 }, (_, i) => 4173 + i);
  for (const p of candidates) {
    const ok = await new Promise<boolean>((res, rej) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE") res(false);
        else rej(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        res(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, "127.0.0.1");
    });
    if (ok) return p;
  }
  throw new Error(`no free port in ${candidates[0]}..${candidates.at(-1)}`);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  child.on("error", () => { });
  child.unref();
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const files = await resolveFiles(opts);
  const parsed = parsePsv(await readFile(files.psv, "utf8"));
  const wav = await readWavInfo(files.audio);

  const session: Session = {
    psvPath: files.psv,
    parsed,
    fingerprint: await fingerprintOf(files.psv),
    wav,
  };

  const words = parsed.segments.reduce((n, s) => n + s.words.length, 0);
  console.log(`alder — ${basename(dirname(files.psv))}`);
  console.log(`  psv    ${files.psv}`);
  console.log(`         ${parsed.segments.length} segments, ${words} words`);
  console.log(`  audio  ${wav.path}`);
  console.log(
    `         ${fmtDuration(wav.durationSec)}, ${wav.sampleRate} Hz, ${fmtBytes(wav.size)} (streamed on demand)`,
  );

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          const html = await appHtml();
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": html.length });
          res.end(html);
        } else if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/audio.wav") {
          serveAudio(req, res, wav);
        } else if (req.method === "GET" && url.pathname === "/api/annotation") {
          json(res, 200, {
            ...psvToAnnotation(parsed.segments),
            psvName: basename(files.psv),
            audioName: basename(wav.path),
            dirName: basename(dirname(files.psv)),
          });
        } else if (req.method === "POST" && url.pathname === "/api/save") {
          const payload = JSON.parse(await readBody(req)) as SavePayload;
          const stats = await save(session, payload);
          console.log(
            `  saved ${stats.segments} segments / ${stats.words} words → ${basename(files.psv)} ` +
            `(${new Date().toLocaleTimeString()})`,
          );
          json(res, 200, { ok: true, ...stats });
        } else {
          json(res, 404, { error: "not found" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! ${message}`);
        if (!res.headersSent) json(res, 500, { error: message });
        else res.end();
      }
    })();
  });

  const port = await listen(server, opts.port);
  const url = `http://localhost:${port}/`;
  console.log(`\n  ${url}   (ctrl-c to stop)\n`);
  if (opts.open) openBrowser(url);
}

main().catch((err: unknown) => {
  console.error(`alder: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
