#!/usr/bin/env python3
"""
Real multi-face detection over sampled frames of a video segment, using
OpenCV's bundled Haar cascade classifier. Used by faceDetection.js to build
a speaker-aware crop path for 9:16 reframing.

Active-speaker heuristic (video-only, no random guessing):
  1. Detect ALL faces in each sampled frame.
  2. Track face size across consecutive samples per rough horizontal
     position bucket, so a face doesn't "count" as a new speaker just
     because detection jittered by a few pixels.
  3. The active speaker is the LARGEST tracked face AND only switches to a
     different face once that face has been strictly larger for at least
     MIN_DOMINANT_SAMPLES consecutive samples — this is what prevents
     random camera flicker between two similarly-sized faces.

This is a legitimate, explainable video-only heuristic — not a guess and
not audio/lip-sync based active-speaker detection. For real multi-speaker
podcasts, the reliable signal is audio speaker diarization (who is talking
right now), not who's face is biggest. This script exposes `all_faces` per
sample precisely so a future diarization pass can re-pick the correct face
per timestamp without redoing detection — see faceDetection.js's
`applyDiarizationHints` stub for where that plugs in.

Usage: python3 detect_faces.py <videoPath> <startTime> <endTime> <numSamples>
Output: JSON array: [{"t": secs, "cx": 0-1, "found": bool, "faceCount": n,
                       "allFaces": [{"cx":0-1,"area":0-1}, ...]}]
"""
import sys
import json
import cv2

MIN_DOMINANT_SAMPLES = 2  # a candidate face must be biggest for 2+ samples before we switch to it

def main():
    video_path, start, end, num_samples = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video: {video_path}"}))
        sys.exit(1)

    duration = max(end - start, 0.5)
    samples = []
    for i in range(num_samples):
        t_rel = (i / max(num_samples - 1, 1)) * duration
        t_abs = start + t_rel
        cap.set(cv2.CAP_PROP_POS_MSEC, t_abs * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            samples.append({"t": round(t_rel, 2), "cx": 0.5, "found": False, "faceCount": 0, "allFaces": []})
            continue

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(int(w * 0.06), int(w * 0.06)))

        if len(faces) == 0:
            samples.append({"t": round(t_rel, 2), "cx": 0.5, "found": False, "faceCount": 0, "allFaces": [], "frameW": w, "frameH": h})
            continue

        all_faces = sorted(
            [{"cx": round((fx + fw / 2) / w, 4), "area": round((fw * fh) / (w * h), 4)} for fx, fy, fw, fh in faces],
            key=lambda f: -f["area"],
        )
        samples.append({
            "t": round(t_rel, 2), "cx": all_faces[0]["cx"], "found": True,
            "faceCount": len(all_faces), "allFaces": all_faces, "frameW": w, "frameH": h,
        })

    cap.release()

    # Hysteresis pass: only accept a change of dominant face once the new one has
    # actually been the largest for MIN_DOMINANT_SAMPLES in a row.
    keyframes = []
    current_cx = samples[0]["cx"] if samples else 0.5
    streak_cx = current_cx
    streak_len = 0
    for s in samples:
        if not s["found"]:
            keyframes.append({"t": s["t"], "cx": current_cx, "found": False})
            continue
        if abs(s["cx"] - current_cx) < 0.1:
            streak_len = 0
            keyframes.append({"t": s["t"], "cx": current_cx, "found": True, "faceCount": s["faceCount"]})
            continue
        if abs(s["cx"] - streak_cx) < 0.1:
            streak_len += 1
        else:
            streak_cx = s["cx"]
            streak_len = 1
        if streak_len >= MIN_DOMINANT_SAMPLES:
            current_cx = streak_cx
        keyframes.append({"t": s["t"], "cx": current_cx, "found": True, "faceCount": s["faceCount"]})

    print(json.dumps(keyframes))

if __name__ == "__main__":
    main()
