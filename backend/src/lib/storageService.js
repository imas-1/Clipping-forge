"use strict";
const fs = require("fs");
const path = require("path");

/**
 * Storage layer for rendered clips.
 *
 * ⚠️ CURRENT MODE: LOCAL DISK ONLY.
 * Firebase Storage is deliberately NOT enabled on this project (it would
 * require the Blaze plan) and no other paid object storage is configured.
 * So — per the "don't fake what can't run for free" instruction — rendered
 * MP4s are served directly from local disk (backend/data/renders) by
 * server.js. This is a real, working, zero-cost strategy for a
 * single-instance deployment; it is NOT a horizontally-scalable production
 * strategy, and that limitation is called out explicitly in the README.
 *
 * The module is still shaped as a swap point: `uploadClip` and
 * `deleteProjectFiles` are the two functions a future paid tier (Firebase
 * Storage on Blaze, S3, R2, etc.) would replace — nothing outside this
 * file would need to change. Nothing here pretends cloud storage is
 * active when it isn't.
 */

function isCloudConfigured() {
  return false; // flips to a real check once a paid storage tier is actually connected
}

/** No-op today (local mode) — kept as the real upload path's call site so the swap-in later is a one-file change. */
async function uploadClip(localPath, { userId, projectId, clipId }) {
  return { provider: "local", url: null, key: null, localPath, userId, projectId, clipId };
}

/** Deletes a project's locally rendered files. */
async function deleteProjectFiles({ localDir }) {
  if (localDir && fs.existsSync(localDir)) {
    fs.rmSync(localDir, { recursive: true, force: true });
  }
}

module.exports = { isCloudConfigured, uploadClip, deleteProjectFiles };
