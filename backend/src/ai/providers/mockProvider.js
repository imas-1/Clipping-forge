"use strict";
const { classify } = require("../../lib/segmentTagger");
const { computeOverallScore, clampScore } = require("../validators");

/**
 * ⚠️ DEVELOPMENT ONLY — never selected implicitly. The factory in
 * aiProvider.js only returns this when AI_PROVIDER=mock is set explicitly.
 * It repurposes the project's original deterministic lexical scoring
 * engine so local development and the test suite don't require a live LLM
 * API key, while still exercising the exact same candidate/ranking/QC
 * contract the real providers implement.
 */

const TAG_TO_TOPIC = {
  hook: "curiosity", story: "story", controversial: "opinion", emotional: "personal",
  humor: "comedy", fact: "insight", conclusion: "advice", reaction: "reaction",
  filler: "filler", context: "context",
};
const TAG_TO_TONE = {
  hook: "surprising", story: "reflective", controversial: "controversial", emotional: "emotional",
  humor: "funny", fact: "informative", conclusion: "inspiring", reaction: "dramatic",
  filler: "neutral", context: "neutral",
};
const TAG_SCORE_BIAS = {
  hook: { hook: 88, engagement: 74, emotional: 55, information: 50, clarity: 60, standalone: 58, story: 45, retention: 72, shareability: 66 },
  story: { hook: 55, engagement: 70, emotional: 68, information: 55, clarity: 62, standalone: 70, story: 85, retention: 74, shareability: 60 },
  controversial: { hook: 78, engagement: 80, emotional: 60, information: 50, clarity: 58, standalone: 65, story: 40, retention: 75, shareability: 78 },
  emotional: { hook: 50, engagement: 68, emotional: 88, information: 40, clarity: 55, standalone: 60, story: 60, retention: 72, shareability: 65 },
  humor: { hook: 65, engagement: 82, emotional: 60, information: 35, clarity: 60, standalone: 62, story: 50, retention: 76, shareability: 84 },
  fact: { hook: 55, engagement: 60, emotional: 30, information: 85, clarity: 75, standalone: 68, story: 35, retention: 55, shareability: 58 },
  conclusion: { hook: 40, engagement: 55, emotional: 55, information: 60, clarity: 72, standalone: 80, story: 55, retention: 58, shareability: 50 },
  reaction: { hook: 70, engagement: 72, emotional: 55, information: 30, clarity: 50, standalone: 40, story: 35, retention: 60, shareability: 62 },
};

function wordsToClauses(words) {
  const clauses = [];
  let current = [];
  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    const endsClause = /[.!?]$/.test(w.word) || (next && next.start - w.end > 0.6) || !next;
    if (endsClause && current.length) {
      clauses.push({
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map((c) => c.word).join(" ").trim(),
      });
      current = [];
    }
  });
  return clauses;
}

async function generateCandidates({ chunkWords }) {
  const clauses = wordsToClauses(chunkWords).map((c) => ({ ...c, tag: classify(c.text) }));
  const candidates = [];
  const windowTargets = [16, 26, 38, 52, 68];
  const UNSAFE = new Set(["filler", "context"]);

  for (let start = 0; start < clauses.length; start++) {
    if (UNSAFE.has(clauses[start].tag)) continue;
    for (const target of windowTargets) {
      let end = start;
      let duration = 0;
      while (end < clauses.length && duration < target) {
        duration = clauses[end].end - clauses[start].start;
        end++;
      }
      end = Math.min(end, clauses.length) - 1;
      if (end <= start) continue;
      while (end > start && UNSAFE.has(clauses[end].tag)) end--;
      if (end <= start) continue;

      const windowClauses = clauses.slice(start, end + 1);
      const actualDuration = windowClauses[windowClauses.length - 1].end - windowClauses[0].start;
      if (actualDuration < 8 || actualDuration > 100) continue;

      const dominantTag = windowClauses.find((c) => TAG_SCORE_BIAS[c.tag])?.tag || "story";
      const bias = TAG_SCORE_BIAS[dominantTag] || TAG_SCORE_BIAS.story;
      const scores = {};
      for (const k of Object.keys(bias)) scores[k] = clampScore(bias[k] + (Math.random() * 10 - 5));

      candidates.push({
        start: windowClauses[0].start,
        end: windowClauses[windowClauses.length - 1].end,
        duration: actualDuration,
        title: windowClauses[0].text.slice(0, 60),
        hook: windowClauses[0].text.slice(0, 140),
        description: windowClauses.map((c) => c.text).join(" ").slice(0, 220),
        topic: TAG_TO_TOPIC[dominantTag] || "general",
        tone: TAG_TO_TONE[dominantTag] || "neutral",
        reason: `[mock provider] dominant clause type: ${dominantTag}`,
        scores,
      });
    }
  }
  return candidates;
}

async function rankCandidates({ candidates, countMode }) {
  const scored = candidates
    .map((c) => ({ ...c, viralScore: computeOverallScore(c.scores) }))
    .sort((a, b) => b.viralScore - a.viralScore);
  const requestedCount = countMode === "auto" ? Infinity : Number(countMode);
  const QUALITY_FLOOR = 58;
  const selected = [];

  for (const c of scored) {
    if (selected.length >= requestedCount) break;
    if (c.viralScore < QUALITY_FLOOR) continue;
    const overlapsExisting = selected.some((s) => c.start < s.end + 8 && s.start < c.end + 8);
    if (overlapsExisting) continue;
    const nearDuplicateTitle = selected.some((s) => s.topic === c.topic && Math.abs(s.start - c.start) < 45);
    if (nearDuplicateTitle) continue;
    selected.push({
      id: c.id,
      viralScore: c.viralScore,
      reason: `[mock provider] strong ${c.topic}/${c.tone} moment, diverse from other selections`,
    });
  }
  if (!selected.length && scored.length) {
    selected.push({ id: scored[0].id, viralScore: scored[0].viralScore, reason: "[mock provider] fallback: highest scoring candidate" });
  }
  return selected;
}

async function qualityCheck({ duration }) {
  // Mock provider trusts the heuristic boundary trimming already done in generateCandidates.
  return { pass: duration >= 8 && duration <= 100, extendStartBy: 0, extendEndBy: 0, reason: "[mock provider] heuristic boundaries assumed sound" };
}

module.exports = { generateCandidates, rankCandidates, qualityCheck, name: "mock" };
