"use strict";
const { SetupRequiredError } = require("../../lib/errors");

/**
 * Real Anthropic provider. Anthropic's Messages API doesn't have a bare
 * "JSON mode" flag, so structured output is obtained the reliable way:
 * a forced tool call (`tool_choice: {type: "tool", name: "submit"}`) whose
 * input_schema IS the desired JSON shape — the model's tool_use.input
 * arrives already parsed, no text-JSON round-trip needed.
 *
 * Requires ANTHROPIC_API_KEY. Not exercised live in this sandbox (no
 * outbound network access) — built to the documented Messages API + tools
 * contract and fails loudly on any transport/auth error.
 */

const DEFAULT_MODEL = process.env.AI_MODEL_ANTHROPIC || "claude-sonnet-4-6";
const DEFAULT_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function requireKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new SetupRequiredError("AI_PROVIDER is set to anthropic, but no API key is configured.", {
      missing: ["ANTHROPIC_API_KEY"],
      installHint: "Add ANTHROPIC_API_KEY=sk-ant-... to backend/.env and restart the backend.",
    });
  }
  return key;
}

/** A permissive open-ended schema — validators.js does the real shape checking downstream. */
const GENERIC_SCHEMA = {
  type: "object",
  additionalProperties: true,
};

async function completeJSON({ system, user, maxTokens = 2000 }) {
  const apiKey = requireKey();
  const url = process.env.AI_BASE_URL_ANTHROPIC || DEFAULT_URL;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: "submit", description: "Submit the structured result.", input_schema: GENERIC_SCHEMA }],
        tool_choice: { type: "tool", name: "submit" },
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach Anthropic at ${url}: ${e.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const toolUse = data.content?.find((block) => block.type === "tool_use");
  if (!toolUse?.input) throw new Error("Anthropic did not return a tool_use block with structured input.");
  return toolUse.input;
}

module.exports = { completeJSON, name: "anthropic" };
