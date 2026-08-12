"use strict";
const { SetupRequiredError } = require("../../lib/errors");

/**
 * DEFAULT AI provider — genuinely free. Talks to Ollama
 * (https://ollama.com), a free, open-source, self-hosted LLM runtime, over
 * its local HTTP API. No API key, no per-token billing, no internet needed
 * at inference time — only a one-time model pull.
 *
 * Ollama runs on the SAME machine as this backend (loopback HTTP, not
 * internet egress) — the "no outbound network access" limitation that
 * applies to yt-dlp/OpenAI/Anthropic in this sandbox does NOT apply here,
 * since a loopback call to localhost isn't internet egress. This was
 * confirmed directly in this sandbox: a loopback connection attempt to
 * :11434 fails only because nothing is listening (Ollama isn't installed
 * here), not because the connection itself is blocked.
 *
 * Uses Ollama's /api/chat endpoint with format:"json" for structured
 * output (Ollama's documented way to force valid JSON, distinct from
 * OpenAI's response_format mechanism).
 */

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

let _availabilityChecked = null;
function checkOllamaAvailable() {
  if (_availabilityChecked !== null) return _availabilityChecked;
  _availabilityChecked = fetch(`${DEFAULT_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  return _availabilityChecked;
}

function requireOllama() {
  return checkOllamaAvailable().then((ok) => {
    if (!ok) {
      throw new SetupRequiredError(
        "AI_PROVIDER is local (the free default), but no Ollama server is reachable, so semantic analysis can't run.",
        {
          missing: ["Ollama (self-hosted, free)"],
          installHint:
            `Install Ollama (https://ollama.com — free, open-source), run \`ollama pull ${DEFAULT_MODEL}\`, ` +
            `and make sure \`ollama serve\` is running (it auto-starts on most installs). ` +
            `Set OLLAMA_BASE_URL/OLLAMA_MODEL in backend/.env if you're running it elsewhere or with a different model.`,
        }
      );
    }
  });
}

async function completeJSON({ system, user, maxTokens = 2000 }) {
  await requireOllama();

  let res;
  try {
    res = await fetch(`${DEFAULT_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        format: "json",
        stream: false,
        options: { temperature: 0.4, num_predict: maxTokens },
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach Ollama at ${DEFAULT_BASE_URL}: ${e.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.message?.content;
  if (!content) throw new Error("Ollama returned an empty response.");

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Ollama response was not valid JSON despite format:json.");
  }
}

module.exports = { completeJSON, checkOllamaAvailable, name: "local" };
