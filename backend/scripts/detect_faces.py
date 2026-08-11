#!/usr/bin/env python3
"""
Real face detection over sampled frames of a video segment, using OpenCV's
bundled Haar cascade classifier. Used by faceDetection.js to build a
speaker-aware crop path for 9:16 reframing — this is genuine per-frame
detection on the actual source footage, not a placeholder.

Usage: python3 detect_faces.py <videoPath> <startTime> <endTime> <numSamples>
Output: JSON array on stdout: [{"t": <seconds from clip start>, "cx": <0-1>, "found": bool}]
"""
import sys
import json
import cv2

def main():
    video_path, start, end, num_samples = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video: {video_path}"}))
        sys.exit(1)

    duration = max(end - start, 0.5)
    keyframes = []
    for i in range(num_samples):
        t_rel = (i / max(num_samples - 1, 1)) * duration
        t_abs = start + t_rel
        cap.set(cv2.CAP_PROP_POS_MSEC, t_abs * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            keyframes.append({"t": round(t_rel, 2), "cx": 0.5, "found": False})
            continue

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(int(w * 0.06), int(w * 0.06)))

        if len(faces) == 0:
            keyframes.append({"t": round(t_rel, 2), "cx": 0.5, "found": False, "frameW": w, "frameH": h})
            continue

        # Largest face = the active/on-camera speaker in most single-subject or podcast framing.
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        cx = (fx + fw / 2) / w
        keyframes.append({"t": round(t_rel, 2), "cx": round(float(cx), 4), "found": True, "frameW": w, "frameH": h})

    cap.release()
    print(json.dumps(keyframes))

if __name__ == "__main__":
    main()
