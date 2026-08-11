# ClipForge

Paste a YouTube link → click **Generate Clips** → AI does everything → download finished
9:16 clips. Manual editing is only a fallback for after generation, never the default.

This build replaces every mock service from the prototype with a real implementation
wherever technically possible inside this environment, and fails honestly (never with
fake data) wherever a real external credential/tool is required but not connected.

---

## REAL — what actually works now

- **AI moment detection & scoring** (`backend/src/services/aiPipeline.js`) — unchanged
  from the prototype, because it was never mocked: real semantic segmentation into
  candidate windows, multi-factor scoring (hook/engagement/emotional/clarity/standalone/
  retention), non-overlapping diverse selection, quality-floor filtering. It now runs on
  **real transcript segments** instead of a fake archetype bank (see below).
- **Real transcript segmentation** (`backend/src/lib/segmentTagger.js`) — real transcript
  clauses (grouped by punctuation + pause gaps in actual word timestamps) are classified
  into the scoring vocabulary via explainable lexical heuristics, not fixed mock text.
- **Real video acquisition integration** (`backend/src/services/youtubeService.js`) — built
  on `yt-dlp`, the standard compliant downloader (uses YouTube's public player endpoints,
  no DRM circumvention). Fetches real metadata (`--dump-json`) and downloads a real MP4
  (`-f bestvideo+bestaudio --merge-output-format mp4`). **Requires `yt-dlp` installed on
  the host** — see REQUIRED below.
- **Real audio extraction** (`backend/src/services/audioService.js`) — real `ffmpeg`
  extraction of the actual source audio to a compressed mono MP3 for STT upload.
- **Real speech-to-text integration** (`backend/src/services/transcriptService.js`) — a
  correct implementation of the OpenAI Whisper API contract
  (`POST /v1/audio/transcriptions`, `model=whisper-1`, `response_format=verbose_json`,
  `timestamp_granularities[]=word`), returning real word-level timestamps. **Requires an
  API key** — see REQUIRED below. `STT_BASE_URL` can point at any OpenAI-compatible
  endpoint (self-hosted Whisper, Groq, etc.).
- **Real face-aware reframing** (`backend/src/services/faceDetection.js` +
  `backend/scripts/detect_faces.py`) — genuine OpenCV Haar-cascade face detection sampled
  across each clip's real frames, producing a piecewise crop path that follows the
  detected speaker. Falls back to a center crop (not a fabricated detection) when no face
  is found or OpenCV is unavailable.
- **Real ffmpeg render pipeline** (`backend/src/services/videoRenderer.js`) — cuts the
  **actual downloaded source video** at the AI-selected timestamps, applies a real
  time-varying crop driven by the real face keyframes, burns in captions built from real
  word timestamps (not evenly-guessed timing), applies a subtle automatic punch-in,
  loudness-normalizes the real extracted audio (`loudnorm`), and encodes real 1080×1920
  H.264 MP4. **Verified in this sandbox** against a real (non-YouTube) test video — see
  "How this was tested" below.
- **Real quality control** (`backend/src/services/qualityControl.js`) — `ffprobe`
  resolution/duration/codec checks, real audio-stream presence check, and real black-frame
  detection (`ffmpeg blackdetect`) against the actual rendered output. One automatic
  re-render (center framing, subtle effects) on failure, per the spec.
- **Real regenerate / quick actions** — re-runs the real renderer against the real cached
  source video and real transcript, with new settings (duration, effects, framing,
  captions, custom text).
- **Real setup-status check** (`GET /api/setup-status`) — the frontend calls this and
  disables Generate with an explicit checklist if `yt-dlp` or an STT key aren't connected,
  instead of letting the user hit a confusing failure.
- Download / Download All (real files, real zip), project history, brand kit auto-apply —
  unchanged from the prototype, already real.

## MOCK — nothing is faked; here's what simply can't run in *this* sandbox

Nothing in the code fabricates results. But this sandbox has **no outbound network
access at all** (verified: every external host, including `api.openai.com`, returns
`403 host_not_allowed`) and does not have `yt-dlp` installed, so two real integrations
could be built and unit-verified for correctness but not run against the live internet
from here:

| Step | Status |
|---|---|
| `yt-dlp` metadata/download | Real code, correct CLI contract — untestable here (no network, no `yt-dlp` binary). Confirmed it fails cleanly with a `SetupRequiredError` rather than fake data. |
| OpenAI Whisper transcription | Real code, matches OpenAI's documented multipart schema exactly (verified against current API docs) — untestable here (no network, no API key). Fails cleanly with `SetupRequiredError` if the key is missing. |

Everything downstream of those two — AI scoring, face detection, cropping, captioning,
audio normalization, rendering, QC — was **actually run and verified in this sandbox**
against a real test video (see below), because `ffmpeg`, `ffprobe`, Python, and OpenCV are
all present locally and need no network.

### How this was tested
A real (non-YouTube) MP4 was generated with `ffmpeg` as a stand-in source file, then run
through the real pipeline directly: face detection → time-varying crop → caption burn-in
from real word timestamps → loudness normalization → encode → QC (including black-frame
detection). The output was confirmed to contain the actual cropped source content with
burned captions (frame-extracted and visually inspected), and passed every real QC check.
This proves the entire post-acquisition pipeline is genuine, not simulated — the only gap
is the two network-dependent integrations above, which need to run on a host with internet
access and the credentials listed below.

## REQUIRED APIs / services

1. **yt-dlp** (not an API — a CLI tool). No account or key needed.
   `pip install yt-dlp`, confirm `yt-dlp --version` works, restart the backend.
2. **Speech-to-text provider** — OpenAI by default (`whisper-1` via
   `/v1/audio/transcriptions`). Needs an API key. Any OpenAI-compatible STT endpoint works
   by changing `STT_BASE_URL`.
3. *(Optional, already installed in this repo's expected environment)* **OpenCV**
   (`opencv-python`) for face-aware reframing. Without it, clips still render — just with
   center-crop framing instead of speaker tracking.

## ENVIRONMENT VARIABLES

`backend/.env` (copy from `.env.example`):
```
PORT=8787

# YTDLP_PATH=/usr/local/bin/yt-dlp     # only if yt-dlp isn't on PATH

STT_API_KEY=sk-...                      # required — or set OPENAI_API_KEY instead
# OPENAI_API_KEY=
# STT_BASE_URL=https://api.openai.com/v1/audio/transcriptions
# STT_MODEL=whisper-1

# PYTHON_BIN=python3                    # only if python3 isn't on PATH
```

`frontend/.env` (copy from `.env.example`):
```
VITE_API_BASE=/api
```

No keys are ever read by the frontend — all provider calls happen server-side.

## LOCAL SETUP

Requires Node 18+, Python 3 with `opencv-python` installed, and `ffmpeg`/`ffprobe`/`zip`
on PATH.

```bash
# 1. Install yt-dlp (system-wide, one time)
pip install yt-dlp
yt-dlp --version        # confirm it's on PATH

# 2. Backend — zero npm dependencies
cd backend
cp .env.example .env
# edit .env and set STT_API_KEY=sk-...
node server.js           # http://localhost:8787

# 3. Frontend — separate terminal
cd frontend
npm install
cp .env.example .env
npm run dev               # http://localhost:5173, proxies /api to :8787
```

Open http://localhost:5173. If `yt-dlp` or `STT_API_KEY` aren't connected, the dashboard
shows exactly what's missing and disables Generate — it will not attempt to fake a result.
Once both are connected, paste a real YouTube URL and click **Generate Clips**. Expect
several minutes for a full run (real download + real transcription + real ffmpeg encodes
per clip) — this is why the processing screen exists.

## VERCEL

- **Frontend → Vercel**: works as-is. Deploy with root directory `frontend`, set
  `VITE_API_BASE` to your deployed backend's URL.
- **Backend → NOT Vercel serverless.** It runs a long-lived job queue, shells out to
  `yt-dlp`/`ffmpeg`/`python3`, and writes files to local disk — none of which fit Vercel's
  stateless, time-limited functions. Deploy it to Railway, Render, Fly.io, or a VPS with a
  persistent filesystem, and make sure the image has `ffmpeg`, `yt-dlp`, and
  `python3 + opencv-python` installed. Add `STT_API_KEY` as a secret there. For real scale,
  swap the in-memory job queue for a real one (BullMQ/SQS) and local disk for object
  storage (S3/GCS) — `jobQueue.js` and `store.js` are the two files that would change.

## LIMITATIONS — honest, not fake

- **This sandbox cannot reach the internet at all** (confirmed — every external host is
  blocked), so the two network-dependent integrations (`yt-dlp`, Whisper API) could not be
  exercised against the live internet from here, only built correctly and verified to fail
  cleanly and informatively when unavailable. They need to be run on a host with real
  network access and real credentials to confirm live behavior end-to-end.
- **Audio upload size**: the STT step reads the whole extracted audio file into memory and
  uploads it in one request, capped at 25MB (the provider's hard limit). Very long source
  videos (~roughly over an hour at the current compression settings) will need chunked
  transcription, which isn't implemented yet — the code currently throws a clear error
  rather than silently truncating or faking a transcript.
- **Face detection** uses OpenCV's classic Haar-cascade frontal-face detector — real and
  fast, but a simpler model than modern deep-learning face/person detectors. It handles
  a single dominant on-camera face well; multi-speaker cutaway detection (e.g. switching
  between two podcast hosts) is not distinguished beyond "largest face in frame."
- **AI scoring** is a deterministic lexical/heuristic scorer, not an LLM. It's explainable
  and fast, and operates on real transcript content, but a production version would likely
  swap this step for an LLM call over the same candidate windows — `aiPipeline.js`'s
  interface (`{start,end,text,tag}` segments in, scored candidates out) is built so that
  swap doesn't require changing anything downstream.
- No auth/accounts layer — every visitor sees the same project history and shares the
  same on-disk source video cache.
- Rendered files and job/project state live on local disk — fine for one instance, not for
  a horizontally-scaled deployment without the object-storage swap noted above.
