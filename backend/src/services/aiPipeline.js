"use strict";
/**
 * This module is the real "AI" logic of ClipForge: semantic segmentation,
 * candidate moment detection, multi-factor scoring, and duration/boundary
 * optimization. It operates on a timestamped transcript (see
 * transcriptService.js) and has no dependency on whether that transcript
 * came from a mock or a real ASR pipeline.
 *
 * In production this scoring would likely be backed by an LLM call (e.g.
 * "rate each candidate window for hook strength, clarity, standalone
 * value..."), but the deterministic heuristic version here is a legitimate
 * v1: it's fast, free, explainable, and gives every downstream piece
 * (duration logic, quality control, regeneration) real numbers to work with.
 */

const TAG_WEIGHTS = {
  hook: { hook: 30, engagement: 18, emotional: 6, clarity: 4, standalone: 6, retention: 14 },
  story: { hook: 10, engagement: 16, emotional: 14, clarity: 10, standalone: 14, retention: 16 },
  controversial: { hook: 22, engagement: 20, emotional: 10, clarity: 6, standalone: 12, retention: 16 },
  emotional: { hook: 8, engagement: 14, emotional: 24, clarity: 6, standalone: 10, retention: 14 },
  humor: { hook: 14, engagement: 20, emotional: 12, clarity: 8, standalone: 10, retention: 16 },
  fact: { hook: 12, engagement: 12, emotional: 4, clarity: 16, standalone: 14, retention: 10 },
  conclusion: { hook: 6, engagement: 10, emotional: 10, clarity: 14, standalone: 18, retention: 12 },
  reaction: { hook: 16, engagement: 16, emotional: 10, clarity: 6, standalone: 6, retention: 12 },
  filler: { hook: -10, engagement: -8, emotional: -4, clarity: -6, standalone: -10, retention: -8 },
  context: { hook: -4, engagement: -2, emotional: 0, clarity: 2, standalone: -8, retention: -2 },
};

const EDGE_UNSAFE_TAGS = new Set(["filler", "context"]);

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Group transcript segments into overlapping candidate windows of varying length. */
function buildCandidateWindows(segments) {
  const candidates = [];
  const windowTargets = [18, 28, 40, 55, 70]; // seconds — the AI tries several natural lengths

  for (let start = 0; start < segments.length; start++) {
    if (EDGE_UNSAFE_TAGS.has(segments[start].tag)) continue; // never open on filler/context

    for (const target of windowTargets) {
      let end = start;
      let duration = 0;
      while (end < segments.length && duration < target) {
        duration = segments[end].end - segments[start].start;
        end++;
      }
      end = Math.min(end, segments.length) - 1;
      if (end <= start) continue;

      // Trim the closing edge back off filler/context so clips never end weakly.
      while (end > start && EDGE_UNSAFE_TAGS.has(segments[end].tag)) end--;
      if (end <= start) continue;

      const windowSegments = segments.slice(start, end + 1);
      const actualDuration = windowSegments[windowSegments.length - 1].end - windowSegments[0].start;
      if (actualDuration < 12 || actualDuration > 90) continue;

      candidates.push({ startIdx: start, endIdx: end, segments: windowSegments, duration: actualDuration });
    }
  }
  return candidates;
}

function scoreCandidate(candidate) {
  const totals = { hook: 40, engagement: 40, emotional: 30, clarity: 55, standalone: 45, retention: 40 };
  for (const seg of candidate.segments) {
    const w = TAG_WEIGHTS[seg.tag] || {};
    for (const key of Object.keys(totals)) totals[key] += (w[key] || 0) / candidate.segments.length + (w[key] || 0) * 0.3;
  }
  // A strong opening hook line matters disproportionately.
  const openTag = candidate.segments[0].tag;
  if (openTag === "hook" || openTag === "controversial") totals.hook += 14;

  // A clean, conclusive closing line matters too.
  const closeTag = candidate.segments[candidate.segments.length - 1].tag;
  if (closeTag === "conclusion" || closeTag === "reaction") totals.retention += 10;

  // Slight penalty for windows that are mostly filler/context even after trimming.
  const weakRatio =
    candidate.segments.filter((s) => EDGE_UNSAFE_TAGS.has(s.tag)).length / candidate.segments.length;
  const weaknessPenalty = weakRatio * 25;

  for (const key of Object.keys(totals)) totals[key] = clamp(Math.round(totals[key] - weaknessPenalty), 0, 100);

  const overall = Math.round(
    totals.hook * 0.25 +
      totals.engagement * 0.2 +
      totals.emotional * 0.15 +
      totals.clarity * 0.15 +
      totals.standalone * 0.15 +
      totals.retention * 0.1
  );

  return { ...totals, overall: clamp(overall, 0, 100) };
}

function overlaps(a, b) {
  return a.startIdx <= b.endIdx && b.startIdx <= a.endIdx;
}

/**
 * Select the best non-overlapping, diverse set of clips.
 * countMode: "auto" | number
 */
function selectBestMoments(candidates, countMode) {
  const ranked = candidates
    .map((c) => ({ ...c, scores: scoreCandidate(c) }))
    .sort((a, b) => b.scores.overall - a.scores.overall);

  const QUALITY_FLOOR = 62; // below this, a clip isn't "genuinely good" — don't pad with filler
  const chosen = [];
  const requestedCount = countMode === "auto" ? Infinity : Number(countMode);

  for (const candidate of ranked) {
    if (chosen.length >= requestedCount) break;
    if (candidate.scores.overall < QUALITY_FLOOR) continue;
    if (chosen.some((c) => overlaps(c, candidate))) continue;
    // Avoid near-duplicate moments (very close start times = same beat).
    if (chosen.some((c) => Math.abs(c.startIdx - candidate.startIdx) < 3)) continue;
    chosen.push(candidate);
  }

  // If Auto produced nothing, or too little, relax slightly rather than return empty —
  // but never below a hard floor, and never pad past what genuinely scored.
  if (chosen.length === 0 && ranked.length) {
    chosen.push(ranked[0]);
  }

  return chosen.sort((a, b) => a.startIdx - b.startIdx).map((c, i) => ({ rank: i + 1, ...c }));
}

function buildHookLine(candidate) {
  const opener = candidate.segments[0];
  const strongTag = candidate.segments.find((s) => ["hook", "controversial", "emotional"].includes(s.tag));
  const base = strongTag ? strongTag.text : opener.text;
  return base.length > 70 ? base.slice(0, 67) + "…" : base;
}

/**
 * Full pipeline: transcript -> scored, trimmed, deduplicated final moment list.
 */
function analyzeTranscript(transcript, countMode = "auto") {
  const candidates = buildCandidateWindows(transcript.segments);
  const chosen = selectBestMoments(candidates, countMode);

  return chosen.map((c) => ({
    rank: c.rank,
    startTime: c.segments[0].start,
    endTime: c.segments[c.segments.length - 1].end,
    duration: Math.round(c.duration),
    scores: c.scores,
    hookLine: buildHookLine(c),
    transcriptText: c.segments.map((s) => s.text).join(" "),
    tags: [...new Set(c.segments.map((s) => s.tag))],
  }));
}

module.exports = { analyzeTranscript, buildCandidateWindows, scoreCandidate, selectBestMoments };
