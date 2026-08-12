"use strict";
const { getAIProvider } = require("../ai/aiProvider");
const { computeOverallScore } = require("../ai/validators");

/**
 * The real "AI understands the video" layer. Two-stage pipeline:
 *
 *   PASS 1 (per chunk): the transcript is split into overlapping,
 *   timestamp-preserving chunks (long videos are never truncated); the
 *   provider proposes candidate moments per chunk, with the AI itself
 *   choosing natural, context-aware start/end points.
 *
 *   PASS 2 (cross-candidate): every surviving candidate from every chunk
 *   is shown to the provider TOGETHER, so it can compare candidates
 *   against each other (not score them in isolation), enforce diversity
 *   across topic/tone, and reject near-duplicates.
 *
 * A deterministic safety net (diversityFilter) still enforces hard
 * constraints (no overlap, minimum gap, per-topic spacing) after the AI
 * ranking, so a provider that ignores the diversity instruction can't
 * still produce a broken final set.
 */

const CHUNK_TARGET_SECONDS = 6 * 60; // ~6 min of source video per chunk keeps prompts small
const CHUNK_OVERLAP_SECONDS = 20; // shared context across chunk boundaries so a moment spanning a cut isn't lost

function chunkWords(words, targetSeconds = CHUNK_TARGET_SECONDS, overlapSeconds = CHUNK_OVERLAP_SECONDS) {
  if (!words.length) return [];
  const totalDuration = words[words.length - 1].end;
  const chunks = [];
  let chunkStart = 0;

  while (chunkStart < totalDuration) {
    const chunkEnd = Math.min(chunkStart + targetSeconds, totalDuration);
    const chunkWordsSlice = words.filter((w) => w.start >= chunkStart - overlapSeconds && w.end <= chunkEnd + overlapSeconds);
    if (chunkWordsSlice.length) {
      chunks.push({
        offsetStart: Math.max(0, chunkStart - overlapSeconds),
        offsetEnd: Math.min(totalDuration, chunkEnd + overlapSeconds),
        words: chunkWordsSlice,
      });
    }
    chunkStart += targetSeconds;
  }
  return chunks;
}

/** Groups words into readable "[start-end] text" lines for the prompt, without inventing sentence structure. */
function chunkToText(chunkWords) {
  const lines = [];
  let current = [];
  chunkWords.forEach((w, i) => {
    current.push(w);
    const next = chunkWords[i + 1];
    const endsLine = /[.!?]$/.test(w.word) || (next && next.start - w.end > 0.6) || !next;
    if (endsLine && current.length) {
      lines.push(`[${current[0].start.toFixed(1)}-${current[current.length - 1].end.toFixed(1)}] ${current.map((c) => c.word).join(" ")}`);
      current = [];
    }
  });
  return lines.join("\n");
}

function clipTextForRange(words, start, end) {
  return words
    .filter((w) => w.start >= start - 0.1 && w.end <= end + 0.1)
    .map((w) => w.word)
    .join(" ");
}

/** Hard, deterministic diversity/overlap constraints applied after the AI's own diversity pass. */
function diversityFilter(ranked, { minGapSeconds = 15 } = {}) {
  const accepted = [];
  for (const c of ranked) {
    const conflicts = accepted.some((a) => c.start < a.end + minGapSeconds && a.start < c.end + minGapSeconds);
    if (conflicts) continue;
    accepted.push(c);
  }
  return accepted;
}

/** PASS 1 only — per-chunk candidate generation. Exposed separately so callers can report progress between passes. */
async function generateAllCandidates(transcript) {
  const provider = getAIProvider();
  const words = transcript.words || [];
  if (!words.length) throw new Error("Transcript has no words to analyze.");

  const chunks = chunkWords(words);
  if (!chunks.length) throw new Error("Transcript could not be chunked for analysis.");

  let allCandidates = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const raw = await provider.generateCandidates({
      chunkText: chunkToText(chunk.words),
      chunkWords: chunk.words,
      offsetStart: chunk.offsetStart,
      offsetEnd: chunk.offsetEnd,
      isFirstChunk: i === 0,
      isLastChunk: i === chunks.length - 1,
    });
    allCandidates.push(...raw);
  }

  if (!allCandidates.length) {
    throw new Error("The AI provider did not return any usable candidate moments for this video.");
  }

  return allCandidates.map((c, i) => ({ id: i, ...c, overall: computeOverallScore(c.scores) }));
}

/** PASS 2 only — cross-candidate ranking, diversity, final selection + shaping for the render pipeline. */
async function rankAndSelect(allCandidates, countMode, words) {
  const provider = getAIProvider();
  const rankingResult = await provider.rankCandidates({ candidates: allCandidates, countMode });
  if (!rankingResult.length) {
    throw new Error("The AI provider's ranking pass selected no candidates.");
  }

  const byId = new Map(allCandidates.map((c) => [c.id, c]));
  let ranked = rankingResult
    .map((r) => {
      const base = byId.get(r.id);
      if (!base) return null;
      return { ...base, viralScore: r.viralScore ?? base.overall, selectionReason: r.reason };
    })
    .filter(Boolean)
    .sort((a, b) => b.viralScore - a.viralScore);

  ranked = diversityFilter(ranked);

  const requestedCount = countMode === "auto" ? Infinity : Number(countMode);
  const finalSelection = ranked.slice(0, requestedCount).sort((a, b) => a.start - b.start);

  return finalSelection.map((c, i) => ({
    rank: i + 1,
    startTime: c.start,
    endTime: c.end,
    duration: c.end - c.start,
    title: c.title,
    hookLine: c.hook,
    description: c.description,
    topic: c.topic,
    tone: c.tone,
    reason: c.selectionReason || c.reason,
    scores: c.scores,
    viralScore: c.viralScore,
    transcriptText: clipTextForRange(words, c.start, c.end),
    tags: [c.topic, c.tone],
  }));
}

/**
 * @param {{words: Array<{word,start,end}>}} transcript - real transcript with word-level timestamps
 * @param {"auto"|string|number} countMode
 */
async function analyzeTranscript(transcript, countMode = "auto") {
  const allCandidates = await generateAllCandidates(transcript);
  return rankAndSelect(allCandidates, countMode, transcript.words || []);
}

/** Content-level AI QC — runs on the transcript text, before rendering, with one bounded auto-adjustment. */
async function runContentQualityCheck(candidate, words) {
  const provider = getAIProvider();
  const result = await provider.qualityCheck({
    text: candidate.transcriptText,
    hook: candidate.hookLine,
    title: candidate.title,
    duration: candidate.duration,
  });

  if (result.pass || (!result.extendStartBy && !result.extendEndBy)) {
    return { candidate, adjusted: false, qc: result };
  }

  const adjustedStart = Math.max(0, candidate.startTime + result.extendStartBy);
  const adjustedEnd = candidate.endTime + result.extendEndBy;
  if (adjustedEnd - adjustedStart < 6) return { candidate, adjusted: false, qc: result };

  const adjusted = {
    ...candidate,
    startTime: adjustedStart,
    endTime: adjustedEnd,
    duration: adjustedEnd - adjustedStart,
    transcriptText: clipTextForRange(words, adjustedStart, adjustedEnd),
  };
  return { candidate: adjusted, adjusted: true, qc: result };
}

module.exports = {
  analyzeTranscript,
  generateAllCandidates,
  rankAndSelect,
  runContentQualityCheck,
  chunkWords,
  chunkToText,
  diversityFilter,
};
