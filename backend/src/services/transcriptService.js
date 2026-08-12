"use strict";
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { SetupRequiredError } = require("../lib/errors");
const { classify } = require("../lib/segmentTagger");

/**
 * Speech-to-text with a provider abstraction, same pattern as the AI
 * analysis providers. STT_PROVIDER selects between:
 *
 *   "local"  (DEFAULT — genuinely free): faster-whisper running as a local
 *            Python subprocess. No API key, no per-request cost, no
 *            internet needed at inference time — only a one-time model
 *            weight download the first time a given size is used.
 *
 *   "openai" (OPTIONAL, paid): the OpenAI Whisper API. Only used if you
 *            explicitly set STT_PROVIDER=openai — never a silent default.
 *
 * Both paths return the exact same shape ({language, duration, words,
 * segments}), so nothing downstream cares which one ran.
 */

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SCRIPT_PATH = path.join(__dirname, "..", "..", "scripts", "transcribe_local.py");
const WHISPER_MODEL_SIZE = process.env.WHISPER_MODEL_SIZE || "base"; // tiny/base/small/medium/large-v3 — bigger = more accurate, slower, more RAM

/** Groups real words into clauses by punctuation + pause gaps, for scoring. */
function wordsToSegments(words) {
  const segments = [];
  let current = [];
  const PAUSE_GAP = 0.6; // seconds — a pause this long reads as a clause break

  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    const endsClause = /[.!?]$/.test(w.word) || (next && next.start - w.end > PAUSE_GAP) || !next;
    if (endsClause && current.length) {
      const text = current.map((c) => c.word).join(" ").trim();
      segments.push({
        start: current[0].start,
        end: current[current.length - 1].end,
        text,
        tag: classify(text),
      });
      current = [];
    }
  });

  return segments;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.slice(-800) || err.message));
      resolve(stdout);
    });
  });
}

let _localSttChecked = null;
/** Real check: is faster-whisper actually importable in this Python environment? */
function checkLocalSttAvailable() {
  if (_localSttChecked !== null) return _localSttChecked;
  _localSttChecked = new Promise((resolve) => {
    execFile(PYTHON_BIN, ["-c", "import faster_whisper"], (err) => resolve(!err));
  });
  return _localSttChecked;
}

/** DEFAULT — free, local, no API key. */
async function transcribeLocal(audioPath) {
  const available = await checkLocalSttAvailable();
  if (!available) {
    throw new SetupRequiredError("faster-whisper is not installed, so local (free) transcription can't run.", {
      missing: ["faster-whisper (Python package)"],
      installHint:
        "Run `pip install -r backend/requirements.txt` (installs faster-whisper), then restart the backend. " +
        "This is free and runs on CPU — no API key, no per-request cost. First run of a given model size " +
        "downloads its weights once; after that it works fully offline.",
    });
  }

  let stdout;
  try {
    stdout = await run(PYTHON_BIN, [SCRIPT_PATH, audioPath, WHISPER_MODEL_SIZE], { maxBuffer: 1024 * 1024 * 64 });
  } catch (e) {
    throw new Error(`Local transcription failed: ${e.message}`);
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("Local transcription script returned invalid output.");
  }
  if (data.error) {
    if (data.installHint) {
      throw new SetupRequiredError(data.error, { missing: ["faster-whisper"], installHint: data.installHint });
    }
    throw new Error(data.error);
  }

  const words = data.words || [];
  if (!words.length) throw new Error("Local transcription returned no words for this audio.");

  return { language: data.language || "en", duration: data.duration || words[words.length - 1].end, words, segments: wordsToSegments(words) };
}

/** OPTIONAL, PAID — only runs if STT_PROVIDER=openai is explicitly set. */
async function transcribeOpenAI(audioPath) {
  const apiKey = process.env.STT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SetupRequiredError("STT_PROVIDER=openai is set, but no API key is configured.", {
      missing: ["STT_API_KEY (or OPENAI_API_KEY)"],
      installHint: "Add STT_API_KEY=sk-... to backend/.env, or switch STT_PROVIDER=local (free, default) instead.",
    });
  }
  const baseUrl = process.env.STT_BASE_URL || "https://api.openai.com/v1/audio/transcriptions";
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  const stat = fs.statSync(audioPath);
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Extracted audio is ${(stat.size / 1e6).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1e6}MB OpenAI upload limit.`);
  }

  const buffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", process.env.STT_MODEL || "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  let res;
  try {
    res = await fetch(baseUrl, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  } catch (e) {
    throw new Error(`Could not reach the speech-to-text provider at ${baseUrl}: ${e.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Speech-to-text request failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const data = await res.json();
  const words = (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  if (!words.length) throw new Error("Speech-to-text returned no word-level timestamps for this audio.");

  return { language: data.language || "en", duration: data.duration || words[words.length - 1].end, words, segments: wordsToSegments(words) };
}

async function transcribeAudio(audioPath) {
  const provider = (process.env.STT_PROVIDER || "local").trim().toLowerCase();
  if (provider === "openai") return transcribeOpenAI(audioPath);
  if (provider === "local") return transcribeLocal(audioPath);
  throw new Error(`Unknown STT_PROVIDER "${provider}" — expected "local" (free, default) or "openai" (paid).`);
}

module.exports = { transcribeAudio, wordsToSegments, checkLocalSttAvailable };
