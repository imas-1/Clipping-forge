"use strict";
const { execFile } = require("child_process");
const path = require("path");
const { execFile: exec } = require("child_process");

const SCRIPT_PATH = path.join(__dirname, "..", "..", "scripts", "detect_faces.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

let _cvChecked = null;
function checkOpenCvAvailable() {
  if (_cvChecked !== null) return _cvChecked;
  _cvChecked = new Promise((resolve) => {
    exec(PYTHON_BIN, ["-c", "import cv2"], (err) => resolve(!err));
  });
  return _cvChecked;
}

/**
 * Architecture hook for future audio speaker-diarization. Video-only face
 * size is a legitimate heuristic (see detect_faces.py) but the reliable
 * signal for "who is actually talking right now" in a multi-speaker
 * podcast is audio diarization, not face size. This function is the single
 * integration point: when a diarization service is wired in (e.g. via
 * pyannote.audio or a cloud diarization API), it would return
 * `[{start,end,speakerId}]` segments; this function would then re-pick,
 * for each face-detection sample, whichever detected face's screen
 * position corresponds to the diarized active speaker for that timestamp.
 * Not implemented — no diarization data exists to consume yet, and this
 * function deliberately does NOT guess a mapping without it.
 */
function applyDiarizationHints(keyframes, _diarizationSegments) {
  return keyframes; // no-op until a real diarization source is connected
}

/**
 * Real per-frame face detection (see scripts/detect_faces.py). Returns a
 * list of {t, cx} keyframes describing where the detected speaker's face
 * is horizontally across the clip, used to drive a time-varying crop in
 * videoRenderer.js. If OpenCV isn't available or no face is ever found,
 * this degrades to a single center keyframe — a defensible fallback, never
 * a fabricated detection.
 */
async function detectFaceKeyframes(sourcePath, startTime, endTime, numSamples = 6) {
  const available = await checkOpenCvAvailable();
  if (!available) {
    // Not fatal — center-crop is a reasonable default framing.
    return { keyframes: [{ t: 0, cx: 0.5 }], faceTrackingAvailable: false };
  }

  return new Promise((resolve) => {
    execFile(
      PYTHON_BIN,
      [SCRIPT_PATH, sourcePath, String(startTime), String(endTime), String(numSamples)],
      { maxBuffer: 1024 * 1024 * 16 },
      (err, stdout) => {
        if (err) return resolve({ keyframes: [{ t: 0, cx: 0.5 }], faceTrackingAvailable: false });
        try {
          const raw = JSON.parse(stdout);
          if (raw.error) return resolve({ keyframes: [{ t: 0, cx: 0.5 }], faceTrackingAvailable: false });

          // Smooth: merge consecutive keyframes whose center barely moved, so the
          // crop doesn't jitter on detection noise — only reframes on a real move.
          const merged = [];
          for (const kf of raw) {
            const prev = merged[merged.length - 1];
            if (prev && Math.abs(prev.cx - kf.cx) < 0.07) continue;
            merged.push({ t: kf.t, cx: kf.cx });
          }
          resolve({ keyframes: merged.length ? merged : [{ t: 0, cx: 0.5 }], faceTrackingAvailable: true });
        } catch {
          resolve({ keyframes: [{ t: 0, cx: 0.5 }], faceTrackingAvailable: false });
        }
      }
    );
  });
}

module.exports = { detectFaceKeyframes, checkOpenCvAvailable };
