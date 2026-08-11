"use strict";

/**
 * Thrown whenever a real pipeline step cannot run because a required
 * external tool, binary, or credential isn't present. Never caught and
 * papered over with fake data — jobQueue.js lets this propagate to the job
 * record so the user sees exactly what's missing and how to fix it.
 */
class SetupRequiredError extends Error {
  constructor(message, { missing = [], installHint = null } = {}) {
    super(message);
    this.name = "SetupRequiredError";
    this.missing = missing; // e.g. ["yt-dlp"]
    this.installHint = installHint; // human-readable fix
  }
}

module.exports = { SetupRequiredError };
