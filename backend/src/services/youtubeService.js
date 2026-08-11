"use strict";
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { SetupRequiredError } = require("../lib/errors");

/**
 * Real YouTube acquisition layer, built on yt-dlp (the standard compliant
 * tool for downloading video the user is authorized to process — it does
 * not circumvent DRM or platform protections; it uses YouTube's public
 * player endpoints the same way a browser does).
 *
 * This module NEVER returns synthetic metadata or a synthetic video file.
 * If yt-dlp isn't installed, or the download/metadata fetch fails for any
 * reason (private video, region lock, removed video, network error), it
 * throws — the caller (jobQueue.js) fails the job with that exact reason
 * instead of falling back to fake data.
 */

const YOUTUBE_URL_RE =
  /^(https?:\/\/)?(www\.)?(m\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{6,})/;

function isValidYoutubeUrl(url) {
  return YOUTUBE_URL_RE.test((url || "").trim());
}

function extractVideoId(url) {
  const m = YOUTUBE_URL_RE.exec((url || "").trim());
  return m ? m[5] : null;
}

let _ytDlpChecked = null;
function checkYtDlpAvailable() {
  if (_ytDlpChecked !== null) return _ytDlpChecked;
  _ytDlpChecked = new Promise((resolve) => {
    execFile(process.env.YTDLP_PATH || "yt-dlp", ["--version"], (err) => resolve(!err));
  });
  return _ytDlpChecked;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 * 64, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr?.trim() || err.message);
        e.stderr = stderr;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

function requireYtDlp() {
  return checkYtDlpAvailable().then((ok) => {
    if (!ok) {
      throw new SetupRequiredError(
        "yt-dlp is not installed on this server, so video acquisition can't run for real.",
        {
          missing: ["yt-dlp"],
          installHint:
            "Install it with `pip install yt-dlp` (or `brew install yt-dlp`), make sure it's on PATH, then restart the backend. " +
            "Set YTDLP_PATH in backend/.env if it's installed somewhere non-standard.",
        }
      );
    }
  });
}

/** Real metadata fetch via `yt-dlp --dump-json`. No fallback data on failure. */
async function fetchVideoInfo(url) {
  if (!isValidYoutubeUrl(url)) {
    const err = new Error("That doesn't look like a valid YouTube URL.");
    err.status = 400;
    throw err;
  }
  await requireYtDlp();

  const videoId = extractVideoId(url);
  let stdout;
  try {
    stdout = await run(process.env.YTDLP_PATH || "yt-dlp", [
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      url,
    ]);
  } catch (e) {
    const err = new Error(`Couldn't retrieve video info from YouTube: ${e.message}`);
    err.status = 422;
    throw err;
  }

  const info = JSON.parse(stdout);
  return {
    videoId: info.id || videoId,
    url,
    title: info.title || "Untitled video",
    channel: info.uploader || info.channel || "Unknown channel",
    durationSeconds: Math.round(info.duration || 0),
    thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${info.id || videoId}/hqdefault.jpg`,
    fetchedAt: new Date().toISOString(),
    width: info.width || null,
    height: info.height || null,
  };
}

/** Real download of an mp4 the render pipeline actually reads and cuts. */
async function downloadSource(url, destDir) {
  await requireYtDlp();
  fs.mkdirSync(destDir, { recursive: true });
  const outputTemplate = path.join(destDir, "source.%(ext)s");

  try {
    await run(
      process.env.YTDLP_PATH || "yt-dlp",
      [
        "-f",
        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--no-warnings",
        "-o",
        outputTemplate,
        url,
      ],
      { maxBuffer: 1024 * 1024 * 256 }
    );
  } catch (e) {
    const err = new Error(`Couldn't download the source video: ${e.message}`);
    err.status = 422;
    throw err;
  }

  const produced = fs.readdirSync(destDir).find((f) => f.startsWith("source."));
  if (!produced) throw new Error("yt-dlp reported success but no source file was produced.");
  return path.join(destDir, produced);
}

module.exports = { isValidYoutubeUrl, extractVideoId, fetchVideoInfo, downloadSource, checkYtDlpAvailable };
