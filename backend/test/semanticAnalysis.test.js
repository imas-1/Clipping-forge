"use strict";
const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

process.env.AI_PROVIDER = "mock"; // deterministic dev provider — no live API needed for tests

const { analyzeTranscript, chunkWords, diversityFilter } = require("../src/services/semanticAnalysis");
const { computeOverallScore, validateCandidate } = require("../src/ai/validators");
const { classify } = require("../src/lib/segmentTagger");

// --- Shared synthetic transcript builder -----------------------------------

const ARCHETYPES = {
  hook: "Nobody talks about this, and honestly, it is the reason most people fail in the first year.",
  story: "So here is what actually happened, we were three weeks from running out of money completely, and had to decide fast.",
  controversial: "I think the advice everyone gives about this is actually backwards, and I can prove it with real numbers.",
  emotional: "I remember calling my mom that night and just breaking down, because I did not know what else to do.",
  humor: "And the investor just looked at me, dead silence, like I had just proposed marriage on a first date, it was hilarious.",
  fact: "The data shows something wild, ninety percent of the people who tried this quit within six weeks according to the study.",
  conclusion: "So if there is one thing I would tell you, it is this, start before you are ready, every single time, that is the lesson.",
  filler: "Yeah so um that is kind of roughly how the whole thing started, more or less, I guess, you know.",
  context: "Anyway going back a bit, this was around the time we had just moved offices for the second time that year.",
  reaction: "Wait hold on say that again, because I do not think people understand how big that actually is, seriously.",
};

function buildTranscript({ totalSeconds, pattern, wordsPerSecond = 2.5, speakers = 1 }) {
  const words = [];
  let t = 0;
  let i = 0;
  while (t < totalSeconds) {
    const key = pattern[i % pattern.length];
    i++;
    const sentence = ARCHETYPES[key] || key; // allow raw strings for poor-quality-transcript test
    for (const w of sentence.split(/\s+/)) {
      const dur = 1 / wordsPerSecond + (Math.random() * 0.05 - 0.025);
      words.push({ word: w, start: +t.toFixed(2), end: +(t + dur).toFixed(2) });
      t += dur;
    }
    t += 0.45; // inter-clause pause
  }
  return { words, language: "en", duration: words.length ? words[words.length - 1].end : 0 };
}

// --- 1. Podcast-style (long, multi-speaker cadence, varied tags) -----------

describe("Podcast-style video", () => {
  test("produces diverse, non-overlapping clips", async () => {
    const transcript = buildTranscript({
      totalSeconds: 25 * 60,
      pattern: ["hook", "story", "filler", "controversial", "context", "humor", "fact", "conclusion", "emotional", "reaction"],
    });
    const moments = await analyzeTranscript(transcript, "6");
    assert.ok(moments.length > 0, "should return at least one clip");
    assert.ok(moments.length <= 6, "should not exceed requested count");

    for (let i = 1; i < moments.length; i++) {
      assert.ok(moments[i].startTime >= moments[i - 1].endTime, "clips must not overlap");
    }
    for (const m of moments) {
      assert.ok(m.duration >= 6 && m.duration <= 150, `duration ${m.duration} out of sane bounds`);
      assert.ok(m.title && m.hookLine, "every clip needs a title and hook for the UI");
      assert.ok(typeof m.viralScore === "number" && m.viralScore >= 0 && m.viralScore <= 100);
    }
  });
});

// --- 2. Long video forces multi-chunk analysis ------------------------------

describe("Long video (chunking)", () => {
  test("splits into multiple chunks and still returns valid clips", async () => {
    const transcript = buildTranscript({ totalSeconds: 40 * 60, pattern: ["hook", "story", "fact", "controversial"] });
    const chunks = chunkWords(transcript.words);
    assert.ok(chunks.length > 1, `expected multiple chunks for a 40-minute video, got ${chunks.length}`);

    const moments = await analyzeTranscript(transcript, "auto");
    assert.ok(moments.length > 0, "auto mode should still find clips across a long video");
    // Auto mode should not just dump every window — quality floor should apply.
    assert.ok(moments.length < 60, "auto mode should not return an unbounded flood of clips");
  });
});

// --- 3. Short video ----------------------------------------------------------

describe("Short video", () => {
  test("handles a short (90s) clip without crashing, may return few or zero strong moments", async () => {
    const transcript = buildTranscript({ totalSeconds: 90, pattern: ["hook", "conclusion"] });
    const moments = await analyzeTranscript(transcript, "auto");
    assert.ok(Array.isArray(moments));
    for (const m of moments) assert.ok(m.endTime <= transcript.duration + 1);
  });
});

// --- 4. Educational / informative video (fact-heavy) ------------------------

describe("Educational video", () => {
  test("fact-heavy content scores reasonably on information/clarity", async () => {
    const transcript = buildTranscript({ totalSeconds: 8 * 60, pattern: ["fact", "context", "fact", "conclusion", "fact"] });
    const moments = await analyzeTranscript(transcript, "3");
    assert.ok(moments.length > 0);
    const avgInfo = moments.reduce((s, m) => s + m.scores.information, 0) / moments.length;
    assert.ok(avgInfo >= 50, `expected fact-heavy content to score decently on information, got ${avgInfo}`);
  });
});

// --- 5. Motivational / storytelling video -----------------------------------

describe("Motivational / storytelling video", () => {
  test("story-heavy content is picked up and scored on story/emotional axes", async () => {
    const transcript = buildTranscript({ totalSeconds: 10 * 60, pattern: ["story", "emotional", "conclusion", "story"] });
    const moments = await analyzeTranscript(transcript, "4");
    assert.ok(moments.length > 0);
    assert.ok(moments.some((m) => m.scores.story >= 60 || m.scores.emotional >= 60));
  });
});

// --- 6. Multiple speakers (transcript-level — cadence proxy) ---------------

describe("Multiple speakers", () => {
  test("alternating short bursts (proxy for speaker turns) still produce valid clips", async () => {
    const pattern = ["reaction", "hook", "reaction", "humor", "reaction", "controversial"];
    const transcript = buildTranscript({ totalSeconds: 6 * 60, pattern, wordsPerSecond: 3.2 });
    const moments = await analyzeTranscript(transcript, "auto");
    assert.ok(Array.isArray(moments));
    for (const m of moments) assert.ok(m.duration > 0);
  });
});

// --- 7. Gaming-style (high energy, choppy) ----------------------------------

describe("High-energy / gaming-style video", () => {
  test("handles rapid short reaction bursts without producing garbage durations", async () => {
    const transcript = buildTranscript({ totalSeconds: 5 * 60, pattern: ["reaction", "humor", "reaction"], wordsPerSecond: 4 });
    const moments = await analyzeTranscript(transcript, "auto");
    for (const m of moments) assert.ok(m.duration >= 6, "clips should never degrade to sub-6s garbage");
  });
});

// --- 8. Poor-quality transcript (fragmented, low signal) --------------------

describe("Poor-quality transcript", () => {
  test("mostly filler/context content does not crash and does not force bad clips", async () => {
    const transcript = buildTranscript({ totalSeconds: 5 * 60, pattern: ["filler", "context", "filler", "context"] });
    await assert.doesNotReject(() => analyzeTranscript(transcript, "auto"));
  });

  test("empty transcript throws a clear error instead of fabricating clips", async () => {
    await assert.rejects(() => analyzeTranscript({ words: [] }, "auto"), /no words to analyze/i);
  });
});

// --- 9. Keyword-independence check ------------------------------------------

describe("Not simple keyword matching", () => {
  test("classifier is context-sensitive, not a single-keyword trigger", () => {
    // "actually" alone shouldn't force "controversial" without other signal in a long plain sentence.
    const plain = classify("We went to the store and then we came home and had dinner with the family.");
    assert.notEqual(plain, "hook");
  });

  test("scoring is a weighted function, not a plain average", () => {
    const scores = { hook: 100, engagement: 0, emotional: 0, information: 0, clarity: 0, standalone: 0, story: 0, retention: 0, shareability: 0 };
    const overall = computeOverallScore(scores);
    const plainAverage = 100 / 9;
    assert.notEqual(overall, Math.round(plainAverage), "weighted score should differ from a naive average");
  });
});

// --- 10. Validators reject malformed AI output ------------------------------

describe("Structured-output validation", () => {
  test("rejects a candidate with end before start", () => {
    const result = validateCandidate({ start: 10, end: 5, title: "x", hook: "y", scores: {} });
    assert.equal(result, null);
  });
  test("rejects a candidate missing title/hook", () => {
    const result = validateCandidate({ start: 10, end: 30, scores: {} });
    assert.equal(result, null);
  });
  test("accepts a well-formed candidate and fills missing sub-scores neutrally", () => {
    const result = validateCandidate({ start: 10, end: 30, title: "T", hook: "H", scores: { hook: 90 } });
    assert.ok(result);
    assert.equal(result.scores.hook, 90);
    assert.equal(result.scores.clarity, 50); // neutral default, not a crash
  });
});

// --- 11. Diversity filter enforces minimum gap ------------------------------

describe("diversityFilter", () => {
  test("drops candidates that overlap or sit too close together", () => {
    const candidates = [
      { start: 0, end: 20, id: 1 },
      { start: 15, end: 35, id: 2 }, // overlaps #1
      { start: 60, end: 80, id: 3 }, // far enough away
    ];
    const result = diversityFilter(candidates, { minGapSeconds: 10 });
    const ids = result.map((c) => c.id);
    assert.ok(ids.includes(1));
    assert.ok(!ids.includes(2));
    assert.ok(ids.includes(3));
  });
});
