"use strict";
/**
 * Every LLM response used for clip selection is validated against these
 * shapes before it's trusted. Invalid/partial candidates are dropped
 * (logged), never silently coerced into fake-but-plausible data. If an
 * entire response is unusable, callers throw — see semanticAnalysis.js.
 */

const SCORE_KEYS = ["hook", "engagement", "emotional", "information", "clarity", "standalone", "story", "retention", "shareability"];

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Validates + normalizes one candidate object from the pass-1 LLM response. Returns null if unusable. */
function validateCandidate(raw, chunkOffsetGuard) {
  if (!raw || typeof raw !== "object") return null;
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || end <= start) return null;
  const duration = end - start;
  if (duration < 6 || duration > 150) return null; // sanity bounds, not a fixed duration
  if (chunkOffsetGuard && (start < chunkOffsetGuard.min - 5 || end > chunkOffsetGuard.max + 5)) return null;

  const scores = {};
  for (const key of SCORE_KEYS) {
    const v = raw.scores?.[key];
    scores[key] = isFiniteNumber(v) ? clampScore(v) : 50; // neutral default for a missing sub-score, not a crash
  }

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 90) : null;
  const hook = typeof raw.hook === "string" && raw.hook.trim() ? raw.hook.trim().slice(0, 200) : null;
  if (!title || !hook) return null; // these two are load-bearing for the UI — reject if absent

  return {
    start,
    end,
    duration,
    title,
    hook,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 300) : "",
    reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 300) : "",
    topic: typeof raw.topic === "string" ? raw.topic.trim().slice(0, 40) : "general",
    tone: typeof raw.tone === "string" ? raw.tone.trim().slice(0, 30) : "neutral",
    scores,
  };
}

function validateCandidateArray(raw, chunkOffsetGuard) {
  const arr = Array.isArray(raw?.candidates) ? raw.candidates : Array.isArray(raw) ? raw : null;
  if (!arr) return [];
  return arr.map((c) => validateCandidate(c, chunkOffsetGuard)).filter(Boolean);
}

/** Validates the pass-2 (cross-candidate ranking) response. */
function validateRankingResult(raw, validIds) {
  const arr = Array.isArray(raw?.selected) ? raw.selected : Array.isArray(raw) ? raw : null;
  if (!arr) return [];
  const idSet = new Set(validIds);
  return arr
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const id = Number(entry.id);
      if (!idSet.has(id)) return null;
      const viralScore = isFiniteNumber(entry.viralScore) ? clampScore(entry.viralScore) : null;
      return { id, viralScore, reason: typeof entry.reason === "string" ? entry.reason.slice(0, 300) : "" };
    })
    .filter(Boolean);
}

/** Validates the content-level quality-control response. */
function validateQcResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pass = raw.verdict === "PASS" || raw.pass === true;
  const extendStartBy = isFiniteNumber(raw.extendStartBy) ? Math.max(-15, Math.min(15, raw.extendStartBy)) : 0;
  const extendEndBy = isFiniteNumber(raw.extendEndBy) ? Math.max(-15, Math.min(15, raw.extendEndBy)) : 0;
  return { pass, extendStartBy, extendEndBy, reason: typeof raw.reason === "string" ? raw.reason.slice(0, 300) : "" };
}

/** Deterministic, documented weighting — not a plain average, per spec. */
function computeOverallScore(scores) {
  const weights = {
    hook: 0.2,
    engagement: 0.14,
    emotional: 0.1,
    information: 0.1,
    clarity: 0.1,
    standalone: 0.14,
    story: 0.08,
    retention: 0.09,
    shareability: 0.05,
  };
  let total = 0;
  for (const key of SCORE_KEYS) total += (scores[key] ?? 50) * weights[key];
  return clampScore(total);
}

module.exports = { SCORE_KEYS, validateCandidate, validateCandidateArray, validateRankingResult, validateQcResult, computeOverallScore, clampScore };
