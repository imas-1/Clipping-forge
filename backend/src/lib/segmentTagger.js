"use strict";
/**
 * Classifies a clause of REAL transcript text into the same tag vocabulary
 * aiPipeline.js already scores against. This replaces the old mock
 * archetype bank — the tag is now derived from what was actually said,
 * via explainable keyword/pattern heuristics (a legitimate lightweight NLP
 * v1; swap for an LLM classification call for v2 without touching
 * aiPipeline.js, which only needs {start,end,text,tag} segments).
 */

const HOOK_PATTERNS = /\b(nobody talks about|here's the thing|the truth is|what nobody tells you|the reason|secret|you won't believe|here's what)\b/i;
const CONTROVERSIAL_PATTERNS = /\b(wrong|backwards|unpopular|controversial|everyone thinks|actually|myth|lie)\b/i;
const EMOTIONAL_PATTERNS = /\b(cried|crying|scared|terrified|heartbroken|broke down|love|hate|afraid|devastat\w+|proud)\b/i;
const HUMOR_PATTERNS = /\b(hilarious|funny|joke|laugh\w*|ridiculous|absurd)\b/i;
const FACT_PATTERNS = /\b(\d+%|percent|study|data|research|statistics|according to)\b/i;
const CONCLUSION_PATTERNS = /\b(so if there's one thing|bottom line|in the end|that's why|the point is|lesson)\b/i;
const REACTION_PATTERNS = /\b(wait|hold on|what|no way|seriously|oh my)\b/i;
const FILLER_PATTERNS = /\b(um+|uh+|like,|you know,|i mean,|sort of|kind of)\b/i;
const QUESTION = /\?\s*$/;

function classify(text) {
  const t = text.trim();
  if (!t) return "context";

  if (FILLER_PATTERNS.test(t) && t.split(/\s+/).length < 8) return "filler";
  if (HOOK_PATTERNS.test(t) || QUESTION.test(t)) return "hook";
  if (CONTROVERSIAL_PATTERNS.test(t)) return "controversial";
  if (EMOTIONAL_PATTERNS.test(t)) return "emotional";
  if (HUMOR_PATTERNS.test(t)) return "humor";
  if (FACT_PATTERNS.test(t)) return "fact";
  if (CONCLUSION_PATTERNS.test(t)) return "conclusion";
  if (REACTION_PATTERNS.test(t) && t.split(/\s+/).length < 6) return "reaction";

  // Longer, plain-narrative clauses read as story; short low-signal ones as context.
  return t.split(/\s+/).length >= 10 ? "story" : "context";
}

module.exports = { classify };
