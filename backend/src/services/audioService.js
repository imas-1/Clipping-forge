"use strict";
const { execFile } = require("child_process");
const fs = require("fs");

/** Extracts real audio from the downloaded source video, compressed for STT upload. */
function extractAudio(sourcePath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-b:a", "64k", outPath],
      { maxBuffer: 1024 * 1024 * 32 },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`Audio extraction failed: ${stderr?.slice(-800) || err.message}`));
        if (!fs.existsSync(outPath)) return reject(new Error("Audio extraction produced no file."));
        resolve(outPath);
      }
    );
  });
}

module.exports = { extractAudio };
