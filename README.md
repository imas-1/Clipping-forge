# ClipForge — €0 edition

Sign in → paste a YouTube link → click **Generate Clips** → AI understands the whole
video, finds the best moments, and renders finished 9:16 clips → download. Every step
in that pipeline now defaults to a genuinely free, open-source, self-hosted component —
paid providers still exist in the code as opt-in upgrades, never as a silent requirement.

---

## 1. FILES CHANGED this round

- `backend/src/ai/providers/localProvider.js` — **new**: free, self-hosted Ollama provider.
- `backend/src/ai/aiProvider.js` — default is now `local` (Ollama) instead of throwing
  when `AI_PROVIDER` is unset.
- `backend/src/services/transcriptService.js` — rewritten: default is now local
  `faster-whisper`; the OpenAI Whisper API path still exists but only runs if you set
  `STT_PROVIDER=openai` explicitly.
- `backend/scripts/transcribe_local.py` — **new**: real local STT via faster-whisper,
  same output shape the OpenAI path already produced.
- `backend/src/config/limits.js` — env var names changed to the requested
  `FREE_MAX_*` convention (internal code untouched, so nothing else needed to change).
- `backend/requirements.txt` — **new**: `faster-whisper`, `opencv-python`, `yt-dlp` —
  the whole free Python stack in one file.
- `backend/server.js` — `/api/setup-status` now reports the free-by-default providers
  (Ollama reachability, faster-whisper importability) instead of assuming paid keys.
- `backend/.env.example` — restructured into an explicit **FREE REQUIRED** section and
  an **OPTIONAL PAID** section.
- `vercel.json`, `firestore.rules`, `firestore.indexes.json` — unchanged from last round
  (still correct for this round's architecture — see section 6).

Nothing was deleted: the OpenAI/Anthropic AI providers and the OpenAI Whisper STT path
are all still in the codebase and fully functional — they're just no longer required or
defaulted-to.

## 2. FEATURES IMPLEMENTED

- Free/local speech-to-text as the real default (word-level timestamps, same downstream
  contract as before).
- Free/local semantic AI analysis as the real default (same two-pass chunking → generate
  → rank pipeline as before, just pointed at a local model by default).
- Automatic provider detection stays honest: if the free local tool isn't installed/
  running, the app tells you exactly what to install — it does not silently fall back to
  a paid provider, and does not fake a result.
- Paid providers (OpenAI, Anthropic, OpenAI Whisper) remain fully implemented and
  available as an explicit opt-in (`AI_PROVIDER=openai`/`anthropic`, `STT_PROVIDER=openai`).

## 3. FREE COMPONENTS USED (the real default path)

| Stage | Component | Cost |
|---|---|---|
| Auth + project metadata | Firebase (Spark plan) | €0 |
| YouTube acquisition | yt-dlp | €0, open-source |
| Audio/video processing | ffmpeg | €0, open-source |
| Speech-to-text | faster-whisper (local, CPU) | €0, open-source |
| Semantic clip analysis | Ollama + a local LLM (e.g. `llama3.1:8b`) | €0, open-source, self-hosted |
| Face detection / reframing | OpenCV (Haar cascade) | €0, open-source |
| Frontend hosting | Vercel free tier | €0 |
| Backend hosting | see section 10 — **this is the one honest gap** | see below |

## 4. OPTIONAL PAID COMPONENTS (never required, never defaulted-to)

- OpenAI Whisper API (`STT_PROVIDER=openai`) — faster/more accurate than local Whisper,
  costs per minute of audio.
- OpenAI or Anthropic chat completions (`AI_PROVIDER=openai`/`anthropic`) — likely higher
  semantic-analysis quality than a small local model, costs per token.
- Both require their own API key, set explicitly — the app will not call them unless you
  choose to.

## 5. FIREBASE — exact settings required

Unchanged from your existing setup: Authentication (email/password + Google) enabled,
Firestore (Standard, Production mode), Spark plan, no Storage, no Blaze. What the code
needs from you:

1. Deploy the included rules + index once (`firebase deploy --only firestore:rules,firestore:indexes`).
2. A service account for the backend (`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/
   `FIREBASE_PRIVATE_KEY` in `backend/.env` — a secret, never commit it).
3. The web app's public client config (`VITE_FIREBASE_*` in `frontend/.env` — not a
   secret, safe in the bundle).

## 6. VERCEL — exact settings required

Same as last round, unchanged: I found no pre-existing `vercel.json` in the project as
I have it, so the one included (frontend-only static build of `frontend/`, SPA rewrite)
is what's actually there now — not something "preserved" from elsewhere. If you have a
different working one, keep yours.

**The backend still cannot run on Vercel** (see section 10) — set `VITE_API_BASE` in
Vercel's dashboard to wherever you deploy the backend, plus the four `VITE_FIREBASE_*`
vars (all must be set in Vercel's env settings, not just locally, since Vite inlines
them at build time).

## 7. EXACT ENVIRONMENT VARIABLES

See `backend/.env.example` (now split into FREE REQUIRED / OPTIONAL PAID) and
`frontend/.env.example`. Summary of what's actually required for the €0 path:

**Backend (free path):** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`. That's it for required env vars — `STT_PROVIDER`/`AI_PROVIDER`
can stay unset (defaults to local/free); yt-dlp/faster-whisper/OpenCV/Ollama are
installed tools, not env vars.

**Frontend:** `VITE_API_BASE`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

## 8. LOCAL INSTALLATION COMMANDS

```bash
# 1. Free Python stack (yt-dlp, faster-whisper, OpenCV)
pip install -r backend/requirements.txt

# 2. Free local LLM runtime
# Install Ollama from https://ollama.com, then:
ollama pull llama3.1:8b       # or a smaller/larger model — see note in section 12
ollama serve                   # usually auto-starts after install

# 3. Backend
cd backend
npm install                    # firebase-admin only — everything else is Python/system tools
cp .env.example .env
# fill in FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
node server.js                  # http://localhost:8787

# 4. Firestore rules/index (one-time)
firebase deploy --only firestore:rules,firestore:indexes

# 5. Frontend
cd frontend
npm install
cp .env.example .env
# fill in VITE_FIREBASE_*, VITE_API_BASE=http://localhost:8787/api
npm run dev                     # http://localhost:5173
```

## 9. RUNNING THE COMPLETE PIPELINE LOCALLY FOR €0

With the four commands above (Ollama running, `pip install -r requirements.txt` done,
backend + frontend running), the entire pipeline —
YouTube → yt-dlp → ffmpeg audio extraction → faster-whisper transcript → Ollama semantic
analysis → ffmpeg render/caption/crop → OpenCV face detection → technical QC →
finished MP4 — runs end-to-end on your own machine with **zero API keys and zero
recurring cost**. This was verified in this sandbox at the code level (every free-path
service correctly detects its own absence and reports exactly what to install, rather
than faking success) — see section 12 for what wasn't verified with an actual live model
running, and why.

`npm test` in `backend/` (15/15 passing) exercises the full semantic-analysis pipeline
end-to-end against the deterministic mock provider, without needing Ollama or any key at
all — useful for CI or quick sanity checks independent of the free LLM being installed.

## 10. WHAT CAN RUN PUBLICLY FOR €0

- **Frontend**: yes, indefinitely, on Vercel's free tier.
- **Firebase Auth + Firestore**: yes, indefinitely, on the Spark plan, at this app's
  scale (the usage limits in `limits.js` exist specifically to keep it within free-tier
  quotas).
- **yt-dlp, ffmpeg, OpenCV**: yes, free forever, no usage-based cost at any scale.

## 11. WHAT CANNOT REALISTICALLY RUN PUBLICLY FOR €0

**THIS PART CANNOT RELIABLY RUN FOR €0 AT SCALE: the backend compute itself.**

Concretely: yt-dlp downloads, ffmpeg encoding, and — now — local Whisper transcription
and local LLM inference are all real CPU/RAM-intensive work that has to run *somewhere*,
continuously, reachable from the internet, for the app to be usable by anyone other than
you on your own machine. Every genuinely free hosting tier I'm aware of (Render free,
Railway free, Fly.io free allowance, Google Cloud Run free tier, etc.) either:

- sleeps/cold-starts the instance (breaks a long-running job queue and makes generation
  unpredictably slow or fail mid-job), or
- caps CPU/RAM/execution time well below what local Whisper + a 8B-parameter local LLM +
  ffmpeg encoding need to run reliably for even one concurrent user, or
- both.

So: **local/self-hosted AI genuinely eliminates the per-request API cost**, but it does
**not** eliminate the need for a machine with real, sustained CPU/RAM to run it on. That
machine is either:
1. **Your own computer** (genuinely €0, this is what section 9 describes, and it's a
   completely legitimate way to run ClipForge for personal use), or
2. **A paid VPS/cloud instance** (Hetzner/DigitalOcean/etc. — often a few euros a month,
   which is real money, just typically less than metered API costs at any meaningful
   volume), or
3. A machine you already own that's on 24/7 (a home server, a spare machine) — €0
   marginal cost, but not "public cloud."

I will not claim option 2 is free — it isn't — and I won't pretend a free-tier serverless
host can reliably run this workload continuously, because it can't. This is the one part
of the "developer pays €0" requirement I cannot satisfy for a *publicly reachable*
deployment; personal/local use (option 1) genuinely is €0.

## 12. REMAINING LIMITATIONS — honest

- **The Ollama and faster-whisper integrations were built and unit-tested for correct
  failure behavior in this sandbox (confirmed: both detect their own absence and report
  exact install instructions rather than faking a result), but were NOT run against a
  live model** — this sandbox has no outbound internet access to download Ollama/model
  weights, and Ollama isn't pre-installed here. The loopback HTTP calls themselves
  (`localhost:11434`) are not blocked by the sandbox's network policy — only internet
  egress is — so this is purely a "not installed in this session" gap, not an
  architectural one. Test the full flow with a real model on first local run.
- **Local LLM quality is genuinely lower than GPT-4-class hosted models**, especially for
  the more nuanced parts of the spec (understanding a subtle emotional beat, judging
  whether a payoff really lands). `llama3.1:8b` is a reasonable free default that runs on
  a normal laptop CPU, but if clip quality matters more than cost to you, the
  `AI_PROVIDER=openai`/`anthropic` opt-in exists exactly for that tradeoff — nothing
  needs to be rewritten to switch.
- **Local Whisper is slower than the API** on CPU — a 10-minute video's audio might take
  a few minutes to transcribe locally vs. seconds via the API. This is the real,
  expected cost of "free" here, not a bug.
- **Storage is still local disk** (unchanged from last round — Firebase Storage isn't
  enabled, by your choice, to stay off Blaze); doesn't scale past one backend instance.
- **Firestore security rules are defense-in-depth, not the active enforcement mechanism**
  (the backend, using Admin SDK + verified tokens, is what actually isolates users —
  unchanged from last round).
- Everything else from prior rounds' limitations still applies: 25MB STT upload cap on
  the OpenAI path (not applicable to the local path, which has no such limit but is
  correspondingly slower on long audio), active-speaker framing is a real video-only
  heuristic (not audio-diarization-based), content QC makes at most one bounded boundary
  adjustment per clip.
