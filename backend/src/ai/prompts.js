"use strict";
/**
 * Prompt templates shared by every real provider (openai/anthropic), so the
 * two providers are prompted identically and only differ in transport/JSON
 * mechanics. Kept in one place so prompt quality improvements apply to
 * every provider at once.
 */

const SCORE_SCHEMA_HINT =
  '"scores":{"hook":0-100,"engagement":0-100,"emotional":0-100,"information":0-100,"clarity":0-100,"standalone":0-100,"story":0-100,"retention":0-100,"shareability":0-100}';

function buildCandidatePrompt({ chunkText, offsetStart, offsetEnd, isFirstChunk, isLastChunk }) {
  const system =
    "You are an expert short-form video producer who has cut thousands of viral YouTube Shorts/TikToks/Reels. " +
    "You read a raw timestamped transcript and find moments that work as standalone vertical clips: strong hooks, " +
    "surprising or emotional or funny or controversial or highly useful moments, or complete micro-stories with a " +
    "payoff. You understand meaning and context, not keywords — a sentence only matters because of what it means " +
    "in context, not because it contains an exciting-sounding word. For every candidate, look at what comes before " +
    "and after the interesting statement and choose natural start/end timestamps: include only the context truly " +
    "needed, never start or end mid-sentence or mid-word, and never cut away right before a payoff or right after " +
    "a statement whose reaction matters. Clips can be any natural length — do not force a fixed duration. " +
    "Respond ONLY with JSON, no prose, no markdown fences.";

  const user =
    `Transcript chunk covering ${offsetStart.toFixed(1)}s–${offsetEnd.toFixed(1)}s of the source video` +
    `${isFirstChunk ? " (start of video)" : ""}${isLastChunk ? " (end of video)" : ""}.\n` +
    `Each line is "[start-end] text" in absolute source-video seconds.\n\n` +
    `${chunkText}\n\n` +
    `Return JSON: {"candidates":[{"start":<sec>,"end":<sec>,"title":"<short punchy title>",` +
    `"hook":"<the literal opening line or the strongest line, verbatim from the transcript>",` +
    `"description":"<1-2 sentence description of what happens>","topic":"<one/two word topic>",` +
    `"tone":"<one word: e.g. funny, surprising, emotional, controversial, informative, inspiring, dramatic>",` +
    `"reason":"<why this works as a standalone clip>",${SCORE_SCHEMA_HINT}}]}\n` +
    `Only include genuinely strong candidates — an empty array is a valid answer if nothing in this chunk stands alone well. ` +
    `Prefer 3-8 candidates for a chunk this size, with varied topics/tones where the content allows it.`;

  return { system, user };
}

function buildRankingPrompt({ candidates, countMode }) {
  const system =
    "You are the final editor reviewing every candidate clip pulled from one video and choosing which ones actually " +
    "ship. You compare candidates against EACH OTHER, not in isolation — you are looking for the strongest, most " +
    "diverse final set: different topics, different tones, different parts of the video, no two clips making " +
    "essentially the same point. Prefer clearly strong candidates over padding to hit a count. Respond ONLY with JSON.";

  const countInstruction =
    countMode === "auto"
      ? "Select however many candidates are genuinely strong and diverse — do not pad with weak ones just to hit a round number."
      : `Select up to ${countMode} candidates — fewer is fine if there aren't ${countMode} genuinely strong, sufficiently distinct moments.`;

  const list = candidates
    .map(
      (c) =>
        `#${c.id} [${c.start.toFixed(1)}-${c.end.toFixed(1)}s, ${Math.round(c.duration)}s] "${c.title}" — hook: "${c.hook}" — topic: ${c.topic}, tone: ${c.tone} — self-reported overall: ${c.overall}`
    )
    .join("\n");

  const user =
    `Candidates pulled from the full video (already deduplicated overlapping windows within each transcript chunk):\n\n${list}\n\n` +
    `${countInstruction}\n` +
    `Enforce diversity: avoid selecting two candidates whose timestamps overlap or that make essentially the same point.\n` +
    `Return JSON: {"selected":[{"id":<candidate id>,"viralScore":0-100,"reason":"<why this made the final cut, and how it complements the other selections>"}]}, ` +
    `ordered by viralScore descending.`;

  return { system, user };
}

function buildQcPrompt({ text, hook, title, duration }) {
  const system =
    "You are doing final quality control on a short-form video clip BEFORE it's rendered, based only on its transcript. " +
    "Judge whether it would make sense to someone who has not seen the original video: does it open naturally (not " +
    "mid-sentence, not confusingly), does it have a real payoff or conclusion (not cut off before the point lands), " +
    "and is the hook actually delivered in the first couple of seconds. Respond ONLY with JSON.";

  const user =
    `Clip title: "${title}"\nHook: "${hook}"\nDuration: ${Math.round(duration)}s\n\nFull clip transcript:\n${text}\n\n` +
    `Return JSON: {"verdict":"PASS"|"REGENERATE","reason":"<short reason>",` +
    `"extendStartBy":<seconds, negative to start earlier for missing context, 0 if fine, max 15>,` +
    `"extendEndBy":<seconds, positive to include the payoff/reaction, 0 if fine, max 15>}`;

  return { system, user };
}

module.exports = { buildCandidatePrompt, buildRankingPrompt, buildQcPrompt };
