"use strict";

/**
 * Central usage limits — every enforcement point in the app reads from
 * here, never a hardcoded number scattered inline. All overridable via env
 * so they can be raised later without a code change. Defaults are
 * deliberately conservative: this app targets €0 (free Firebase tier,
 * local/free AI+STT, a single self-hosted backend instance doing real
 * ffmpeg/CPU-bound work), so limits exist to keep it usable at that scale
 * rather than to monetize.
 */

function intFromEnv(name, fallback) {
  const v = process.env[name];
  const n = v !== undefined ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LIMITS = {
  MAX_PROJECTS_PER_USER: intFromEnv("FREE_MAX_PROJECTS", 10),
  MAX_CLIPS_PER_REQUEST: intFromEnv("FREE_MAX_CLIPS_PER_PROJECT", 10), // caps "20" from the count-mode options
  MAX_SOURCE_VIDEO_SECONDS: intFromEnv("FREE_MAX_VIDEO_DURATION", 60 * 60), // seconds, default 1 hour
  MAX_CONCURRENT_JOBS_PER_USER: intFromEnv("FREE_MAX_CONCURRENT_JOBS", 1),
};

module.exports = { LIMITS };
