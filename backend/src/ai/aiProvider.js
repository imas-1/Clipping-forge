"use strict";
const localRaw = require("./providers/localProvider");
const openaiRaw = require("./providers/openaiProvider");
const anthropicRaw = require("./providers/anthropicProvider");
const mockProvider = require("./providers/mockProvider");
const prompts = require("./prompts");
const validators = require("./validators");

/**
 * Provider factory.
 *
 * DEFAULT (AI_PROVIDER unset, or explicitly "local"): free, self-hosted
 * Ollama — no API key, no per-request cost. This is the genuinely free
 * path required for this app to run at €0.
 *
 * "openai"/"anthropic" are OPTIONAL, PAID upgrades — only ever used if you
 * explicitly set AI_PROVIDER to one of them (plus its key). They are never
 * silently substituted in.
 *
 * "mock" is an explicit, visible development-only choice (never chosen
 * automatically) that needs no live model at all — useful for the test
 * suite and offline UI work.
 */

function wrapRealProvider(raw) {
  return {
    name: raw.name,
    async generateCandidates({ chunkText, chunkWords, offsetStart, offsetEnd, isFirstChunk, isLastChunk }) {
      const { system, user } = prompts.buildCandidatePrompt({ chunkText, offsetStart, offsetEnd, isFirstChunk, isLastChunk });
      const json = await raw.completeJSON({ system, user, maxTokens: 2200 });
      return validators.validateCandidateArray(json, { min: offsetStart, max: offsetEnd });
    },
    async rankCandidates({ candidates, countMode }) {
      const { system, user } = prompts.buildRankingPrompt({ candidates, countMode });
      const json = await raw.completeJSON({ system, user, maxTokens: 1500 });
      return validators.validateRankingResult(json, candidates.map((c) => c.id));
    },
    async qualityCheck({ text, hook, title, duration }) {
      const { system, user } = prompts.buildQcPrompt({ text, hook, title, duration });
      const json = await raw.completeJSON({ system, user, maxTokens: 400 });
      return validators.validateQcResult(json) || { pass: true, extendStartBy: 0, extendEndBy: 0, reason: "unparseable QC response, defaulting to pass" };
    },
  };
}

function getAIProvider() {
  const providerName = (process.env.AI_PROVIDER || "local").trim().toLowerCase();

  if (providerName === "local") return wrapRealProvider(localRaw);
  if (providerName === "mock") return mockProvider;
  if (providerName === "openai") return wrapRealProvider(openaiRaw);
  if (providerName === "anthropic") return wrapRealProvider(anthropicRaw);

  throw new Error(`Unknown AI_PROVIDER "${providerName}" — expected "local" (free, default), "openai", "anthropic", or "mock".`);
}

module.exports = { getAIProvider };
