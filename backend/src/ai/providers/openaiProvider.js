"use strict";
const { SetupRequiredError } = require("../../lib/errors");

/**
 * Real OpenAI provider using Chat Completions with JSON-object response
 * mode. Requires AI_API_KEY (or OPENAI_API_KEY). This sandbox has no
 * outbound network access, so this call could not be exercised live here —
 * it follows OpenAI's documented request/response shape and fails loudly
 * (never silently) on any transport or auth error.
 */

const DEFAULT_MODEL = process.env.AI_MODEL_OPENAI || "gpt-4o-mini";
const DEFAULT_URL = "https://api.openai.com/v1/chat/completions";

function requireKey() {
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new SetupRequiredError("AI_PROVIDER is set to openai, but no API key is configured.", {
      missing: ["AI_API_KEY (or OPENAI_API_KEY)"],
      installHint: "Add AI_API_KEY=sk-... to backend/.env and restart the backend.",
    });
  }
  return key;
}

async function completeJSON({ system, user, maxTokens = 2000 }) {
  const apiKey = requireKey();
  const url = process.env.AI_BASE_URL_OPENAI || DEFAULT_URL;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach OpenAI at ${url}: ${e.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON despite json_object mode.");
  }
}

module.exports = { completeJSON, name: "openai" };
