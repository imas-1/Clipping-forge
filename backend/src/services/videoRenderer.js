"use strict";
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

/**
 * Real ffmpeg render pipeline. Operates on the ACTUAL downloaded source
 * video: seeks to the AI-selected timestamp range, crops a real 9:16 window
 * that tracks the real detected face position (see faceDetection.js),
 * burns in captions built from REAL word-level transcript timing, applies
 * a subtle automatic punch-in, and loudness-normalizes the real audio.
 * Nothing here is generated or simulated — every clip contains actual
 * footage and actual speech from the source video.
 */

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const OUT_WIDTH = 1080;
const OUT_HEIGHT = 1920;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 128 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr?.slice(-1500) || err.message}`));
      resolve({ stdout, stderr });
    });
  });
}

async function probeDimensions(sourcePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    sourcePath,
  ]);
  const info = JSON.parse(stdout);
  const s = info.streams?.[0];
  if (!s) throw new Error("Could not read source video dimensions.");
  return { width: s.width, height: s.height };
}

function escapeDrawtext(text) {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

/** Real caption cues from real word-level timestamps (clip-relative), not evenly divided guesswork. */
function buildCaptionCuesFromWords(words, clipStart, clipEnd) {
  const inClip = words.filter((w) => w.start >= clipStart - 0.05 && w.end <= clipEnd + 0.05);
  const wordsPerCue = 4;
  const cues = [];
  for (let i = 0; i < inClip.length; i += wordsPerCue) {
    const chunk = inClip.slice(i, i + wordsPerCue);
    if (!chunk.length) continue;
    cues.push({
      text: chunk.map((w) => w.word).join(" "),
      start: Math.max(0, chunk[0].start - clipStart),
      end: Math.max(0, chunk[chunk.length - 1].end - clipStart),
    });
  }
  return cues;
}

/** Builds the ffmpeg crop x-expression from real detected face keyframes (piecewise step function). */
function buildCropXExpr(keyframes, srcWidth, cropWidth) {
  const clamp = (px) => Math.max(0, Math.min(srcWidth - cropWidth, px));
  const pxFor = (cx) => clamp(Math.round(cx * srcWidth - cropWidth / 2));

  if (keyframes.length <= 1) return String(pxFor(keyframes[0]?.cx ?? 0.5));

  // Nested if(lt(t,tN), pxN, ...) chain — real per-segment crop x, not a constant center-crop.
  let expr = String(pxFor(keyframes[keyframes.length - 1].cx));
  for (let i = keyframes.length - 1; i > 0; i--) {
    expr = `if(lt(t,${keyframes[i].t.toFixed(2)}),${pxFor(keyframes[i - 1].cx)},${expr})`;
  }
  return expr;
}

function captionFilterChain(cues, inputLabel, outputLabel, style = "bold-pop") {
  if (!cues.length) return `[${inputLabel}]null[${outputLabel}]`;
  let chain = `[${inputLabel}]`;
  const parts = [];
  cues.forEach((cue, i) => {
    const isLast = i === cues.length - 1;
    const label = isLast ? outputLabel : `cap${i}`;
    const safe = escapeDrawtext(cue.text.toUpperCase());
    const fontsize = style === "minimal" ? 52 : 64;
    parts.push(
      `${chain}drawtext=fontfile=${FONT}:text='${safe}':fontsize=${fontsize}:fontcolor=white:` +
        `borderw=6:bordercolor=black@0.85:box=1:boxcolor=black@0.35:boxborderw=18:` +
        `x=(w-text_w)/2:y=h-420:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'[${label}]`
    );
    chain = `[${label}]`;
  });
  return parts.join(";");
}

/**
 * @param {object} p
 * @param {string} p.sourcePath - real downloaded source video
 * @param {string} p.outputPath
 * @param {number} p.clipStart - seconds into source
 * @param {number} p.clipEnd
 * @param {Array<{word,start,end}>} p.words - real word-level transcript (source-relative)
 * @param {Array<{t,cx}>} p.faceKeyframes - real detected face positions (clip-relative)
 * @param {"ai"|"center"|"speaker"} p.framing
 * @param {"ai"|"none"|"dynamic"|"cinematic"|"subtle"} p.effects
 * @param {string|null} p.watermarkText
 * @param {string|null} p.customText - overrides caption source with a single custom line
 */
async function renderClip(p) {
  const { sourcePath, outputPath, clipStart, clipEnd, words, framing = "ai", effects = "ai" } = p;
  if (!fs.existsSync(sourcePath)) throw new Error(`Source video not found at ${sourcePath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const duration = clipEnd - clipStart;
  const { width: srcW, height: srcH } = await probeDimensions(sourcePath);

  const cropH = srcH;
  const cropW = Math.min(srcW, Math.round(((srcH * 9) / 16) / 2) * 2);

  const keyframes = framing === "center" ? [{ t: 0, cx: 0.5 }] : p.faceKeyframes?.length ? p.faceKeyframes : [{ t: 0, cx: 0.5 }];
  const xExpr = buildCropXExpr(keyframes, srcW, cropW);

  const cues = p.customText
    ? [{ text: p.customText, start: 0, end: duration }]
    : buildCaptionCuesFromWords(words || [], clipStart, clipEnd);

  const zoomEnabled = effects !== "none";
  const zoomExpr = zoomEnabled ? `,zoompan=z='min(zoom+0.0006,1.08)':d=1:s=${OUT_WIDTH}x${OUT_HEIGHT}:fps=24` : "";

  const capChain = captionFilterChain(cues, "cropped", "captioned", p.captionStyle);
  const watermarkChain = p.watermarkText
    ? `;[captioned]drawtext=fontfile=${FONT}:text='${escapeDrawtext(p.watermarkText)}':fontsize=28:fontcolor=white@0.55:x=w-text_w-30:y=40[vout]`
    : `;[captioned]null[vout]`;

  const filterComplex =
    `[0:v]crop=w=${cropW}:h=${cropH}:x='${xExpr}':y=0,scale=${OUT_WIDTH}:${OUT_HEIGHT}${zoomExpr}[cropped];` +
    `${capChain}${watermarkChain}`;

  const args = [
    "-y",
    "-ss", String(clipStart),
    "-i", sourcePath,
    "-t", String(duration),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "0:a?",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];

  await run("ffmpeg", args);
  return { outputPath, cues, cropW, cropH, keyframesUsed: keyframes };
}

module.exports = { renderClip, buildCaptionCuesFromWords, buildCropXExpr, probeDimensions, OUT_WIDTH, OUT_HEIGHT };
