#!/usr/bin/env python3
"""
Real, free, local speech-to-text using faster-whisper (open-source,
CTranslate2-based Whisper reimplementation — runs entirely on this
machine's CPU/GPU, no API key, no per-request cost, no internet needed at
inference time — only the model weights need a one-time download the
first time a given size is used).

Usage: python3 transcribe_local.py <audioPath> [modelSize]
Output: JSON on stdout: {"language": "en", "duration": 123.4,
                          "words": [{"word": "hello", "start": 0.12, "end": 0.4}, ...]}

This mirrors the exact shape backend/src/services/transcriptService.js
already expects from the (optional, paid) OpenAI Whisper API path, so
nothing downstream (segmentTagger, semanticAnalysis chunking) needed to
change to support this as the new default provider.
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: transcribe_local.py <audioPath> [modelSize]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper is not installed",
            "installHint": "pip install faster-whisper (see backend/requirements.txt)",
        }))
        sys.exit(1)

    try:
        # CPU by default — genuinely free, no GPU required (slower than an API,
        # but $0). Set WHISPER_DEVICE=cuda in the environment if a GPU is available.
        import os
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute_type = "int8" if device == "cpu" else "float16"
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        segments, info = model.transcribe(audio_path, word_timestamps=True, vad_filter=True)

        words = []
        duration = 0.0
        for segment in segments:
            duration = max(duration, segment.end)
            if segment.words:
                for w in segment.words:
                    words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})

        print(json.dumps({"language": info.language, "duration": round(duration, 3), "words": words}))
    except Exception as e:
        print(json.dumps({"error": f"Local transcription failed: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
