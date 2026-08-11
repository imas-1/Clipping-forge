"use strict";
const fs = require("fs");
const { SetupRequiredError } = require("../lib/errors");
const { classify } = require("../lib/segmentTagger");

/**
 * Real speech-to-text via the OpenAI Whisper API
 * (POST /v1/audio/transcriptions, model=whisper-1, response_format=verbose_json,
 * timestamp_granularities[]=word) — returns real word-level timestamps for
 * the actual audio extracted from the source video.
 *
 * ⚠️ SETUP REQUIRED: needs STT_API_KEY (or OPENAI_API_KEY) in backend/.env.
 * If it's missing, or the request fails, this throws — it never invents a
 * transcript. STT_BASE_URL can point at any OpenAI-compatible endpoint
 * (e.g. a self-hosted Whisper server, or a provider like Groq/OpenRouter
 * that implements the same request shape).
 *
 * This sandbox has no outbound network access, so the live call itself
 * cannot be executed or verified here — the request is built exactly to
 * OpenAI's documented multipart schema and should be smoke-tested against
 * a real key on first deploy.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // provider-side hard cap

function requireApiKey() {
  const key = process.env.STT_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new SetupRequiredError(
      "No speech-to-text API key is configured, so a real transcript can't be generated.",
      {
        missing: ["STT_API_KEY (or OPENAI_API_KEY)"],
        installHint:
          "Get an API key from your STT provider (OpenAI by default) and add STT_API_KEY=sk-... to backend/.env, then restart the backend.",
      }
    );
  }
  return key;
}

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

async function transcribeAudio(audioPath) {
  const apiKey = requireApiKey();
  const baseUrl = process.env.STT_BASE_URL || DEFAULT_BASE_URL;

  const stat = fs.statSync(audioPath);
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Extracted audio is ${(stat.size / 1e6).toFixed(1)}MB, which exceeds the ${MAX_UPLOAD_BYTES / 1e6}MB STT upload ` +
        `limit. Long-form source videos need to be chunked before transcription (not yet implemented).`
    );
  }

  const buffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", process.env.STT_MODEL || "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  let res;
  try {
    res = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (e) {
    throw new Error(`Could not reach the speech-to-text provider at ${baseUrl}: ${e.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Speech-to-text request failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const data = await res.json();
  const words = (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  if (!words.length) {
    throw new Error("Speech-to-text returned no word-level timestamps for this audio.");
  }

  return {
    language: data.language || "en",
    duration: data.duration || words[words.length - 1].end,
    words,
    segments: wordsToSegments(words),
  };
}

module.exports = { transcribeAudio, wordsToSegments };
