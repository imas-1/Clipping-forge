"use strict";
const { execFile } = require("child_process");
const fs = require("fs");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      // ffmpeg writes blackdetect output to stderr even on "success" (exit 0 with -f null)
      if (err && cmd === "ffprobe") return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

async function probeStreams(outputPath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    outputPath,
  ]);
  return JSON.parse(stdout);
}

/** Real black-frame detection over the actual rendered output. */
async function detectBlackFrames(outputPath, clipDuration) {
  const { stderr } = await run("ffmpeg", [
    "-i", outputPath,
    "-vf", "blackdetect=d=0.5:pix_th=0.10",
    "-an",
    "-f", "null",
    "-",
  ]);
  const matches = [...(stderr || "").matchAll(/black_duration:([\d.]+)/g)];
  const totalBlack = matches.reduce((sum, m) => sum + parseFloat(m[1]), 0);
  return { totalBlackSeconds: totalBlack, blackRatio: clipDuration ? totalBlack / clipDuration : 0 };
}

/** Full real QC pass. */
async function checkRenderedClip(outputPath, expectedDuration) {
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 2048) {
    return { passed: false, checks: { fileExists: false }, reason: "Output file missing or too small." };
  }

  const info = await probeStreams(outputPath);
  const vStream = info.streams?.find((s) => s.codec_type === "video");
  const aStream = info.streams?.find((s) => s.codec_type === "audio");
  const actualDuration = parseFloat(info.format?.duration || vStream?.duration || 0);

  const { totalBlackSeconds, blackRatio } = await detectBlackFrames(outputPath, expectedDuration);

  const checks = {
    fileExists: true,
    hasVideoStream: !!vStream,
    hasAudioStream: !!aStream,
    correctResolution: vStream?.width === 1080 && vStream?.height === 1920,
    durationWithinTolerance: Math.abs(actualDuration - expectedDuration) < 2,
    codecOk: vStream?.codec_name === "h264",
    noExcessiveBlackFrames: blackRatio < 0.15,
  };
  const passed = Object.values(checks).every(Boolean);

  return { passed, checks, width: vStream?.width, height: vStream?.height, actualDuration, totalBlackSeconds };
}

module.exports = { checkRenderedClip, probeStreams, detectBlackFrames };
