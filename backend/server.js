"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { Router } = require("./src/lib/router");
const jobQueue = require("./src/jobQueue");
const { renderClip } = require("./src/services/videoRenderer");
const { checkRenderedClip } = require("./src/services/qualityControl");
const { isValidYoutubeUrl, checkYtDlpAvailable } = require("./src/services/youtubeService");
const { checkOpenCvAvailable, detectFaceKeyframes } = require("./src/services/faceDetection");
const { checkLocalSttAvailable } = require("./src/services/transcriptService");
const { checkOllamaAvailable } = require("./src/ai/providers/localProvider");
const { requireAuth } = require("./src/lib/auth");
const firestoreStore = require("./src/lib/firestoreStore");
const storageService = require("./src/lib/storageService");
const { LIMITS } = require("./src/config/limits");

const PORT = process.env.PORT || 8787;
const router = new Router();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Loads a project and 404s (not 403 — never confirm existence of another user's project) if it isn't this user's. */
function loadOwnedProject(req, res) {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  if (!project || project.userId !== req.user.uid) {
    sendJson(res, 404, { error: "Project not found." });
    return null;
  }
  return project;
}

// ---------- Routes ----------

router.post(
  "/api/generate",
  requireAuth(async (req, res) => {
    const body = await readJsonBody(req);
    const { url, countMode = "auto", brandKit = null } = body;
    if (!url || !isValidYoutubeUrl(url)) {
      return sendJson(res, 400, { error: "Please paste a valid YouTube URL." });
    }

    const validCountModes = ["auto", "5", "10", "15", "20"];
    let normalizedCount = validCountModes.includes(String(countMode)) ? String(countMode) : "auto";
    if (normalizedCount !== "auto" && Number(normalizedCount) > LIMITS.MAX_CLIPS_PER_REQUEST) {
      normalizedCount = String(LIMITS.MAX_CLIPS_PER_REQUEST);
    }

    if (jobQueue.countActiveJobsForUser(req.user.uid) >= LIMITS.MAX_CONCURRENT_JOBS_PER_USER) {
      return sendJson(res, 429, {
        error: `You already have a generation in progress. Wait for it to finish before starting another (limit: ${LIMITS.MAX_CONCURRENT_JOBS_PER_USER} at a time).`,
      });
    }

    try {
      const existingCount = await firestoreStore.countProjectsForUser(req.user.uid);
      if (existingCount >= LIMITS.MAX_PROJECTS_PER_USER) {
        return sendJson(res, 429, {
          error: `You've reached the current limit of ${LIMITS.MAX_PROJECTS_PER_USER} projects. Delete an older one to make room.`,
        });
      }
    } catch (e) {
      if (e.name === "SetupRequiredError") {
        return sendJson(res, 500, { error: e.message, missingRequirements: e.missing, installHint: e.installHint });
      }
      throw e;
    }

    const job = jobQueue.createJob({ url, countMode: normalizedCount, brandKit, userId: req.user.uid });
    sendJson(res, 202, { jobId: job.id, projectId: job.projectId });
  })
);

router.get(
  "/api/jobs/:jobId",
  requireAuth((req, res) => {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job || job.params?.userId !== req.user.uid) return sendJson(res, 404, { error: "Job not found." });
    sendJson(res, 200, job);
  })
);

router.get(
  "/api/projects",
  requireAuth(async (req, res) => {
    try {
      const docs = await firestoreStore.listProjectDocsForUser(req.user.uid);
      sendJson(res, 200, {
        projects: docs.map((d) => ({
          id: d.id,
          title: d.title,
          thumbnailUrl: d.thumbnailUrl,
          clipCount: d.clipCount,
          status: d.status,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
      });
    } catch (e) {
      if (e.name === "SetupRequiredError") {
        return sendJson(res, 500, { error: e.message, missingRequirements: e.missing, installHint: e.installHint });
      }
      throw e;
    }
  })
);

router.get(
  "/api/projects/:projectId",
  requireAuth((req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    sendJson(res, 200, project);
  })
);

router.patch(
  "/api/projects/:projectId",
  requireAuth(async (req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const body = await readJsonBody(req);
    if (typeof body.title === "string" && body.title.trim()) project.title = body.title.trim();
    project.updatedAt = new Date().toISOString();
    jobQueue.projectsStore.save(project.id, project);
    await firestoreStore.updateProjectDoc(project.id, { title: project.title }).catch(() => {});
    sendJson(res, 200, project);
  })
);

router.delete(
  "/api/projects/:projectId",
  requireAuth(async (req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    jobQueue.projectsStore.delete(project.id);
    await firestoreStore.deleteProjectDoc(project.id).catch(() => {});
    await storageService.deleteProjectFiles({ localDir: path.join(jobQueue.RENDERS_DIR, project.id) });
    sendJson(res, 200, { deleted: true });
  })
);

router.get(
  "/api/projects/:projectId/clips/:clipId/file",
  requireAuth((req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const clip = project.clips.find((c) => c.id === req.params.clipId);
    if (!clip || !fs.existsSync(clip.filePath)) return sendJson(res, 404, { error: "Clip not found." });
    const stat = fs.statSync(clip.filePath);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `inline; filename="clip-${clip.rank}.mp4"`,
    });
    fs.createReadStream(clip.filePath).pipe(res);
  })
);

router.get(
  "/api/projects/:projectId/clips/:clipId/download",
  requireAuth((req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const clip = project.clips.find((c) => c.id === req.params.clipId);
    if (!clip || !fs.existsSync(clip.filePath)) return sendJson(res, 404, { error: "Clip not found." });
    const stat = fs.statSync(clip.filePath);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `attachment; filename="${(project.title || "clip").replace(/[^a-z0-9]+/gi, "-")}-${clip.rank}.mp4"`,
    });
    fs.createReadStream(clip.filePath).pipe(res);
  })
);

router.get(
  "/api/projects/:projectId/download-all",
  requireAuth((req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const dir = path.join(jobQueue.RENDERS_DIR, project.id);
    const zipName = `${(project.title || "clips").replace(/[^a-z0-9]+/gi, "-")}.zip`;
    const zipPath = path.join(dir, "_all.zip");

    execFile("zip", ["-j", zipPath, ...project.clips.map((c) => c.filePath)], (err) => {
      if (err) return sendJson(res, 500, { error: "Could not build the zip file." });
      const stat = fs.statSync(zipPath);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": stat.size,
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      });
      fs.createReadStream(zipPath).pipe(res);
    });
  })
);

// Manual adjustment + regenerate — the "fallback" editing path, only reachable after real generation.
router.patch(
  "/api/projects/:projectId/clips/:clipId",
  requireAuth(async (req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const clip = project.clips.find((c) => c.id === req.params.clipId);
    if (!clip) return sendJson(res, 404, { error: "Clip not found." });
    const body = await readJsonBody(req);
    Object.assign(clip.settings, body.settings || {});
    project.updatedAt = new Date().toISOString();
    jobQueue.projectsStore.save(project.id, project);
    sendJson(res, 200, clip);
  })
);

router.post(
  "/api/projects/:projectId/clips/:clipId/regenerate",
  requireAuth(async (req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    const clip = project.clips.find((c) => c.id === req.params.clipId);
    if (!clip) return sendJson(res, 404, { error: "Clip not found." });
    const body = await readJsonBody(req);

    const quickActionMap = {
      make_shorter: () => (clip.duration = Math.max(10, Math.round(clip.duration * 0.7))),
      make_longer: () => (clip.duration = Math.min(90, Math.round(clip.duration * 1.3))),
      more_dynamic_captions: () => (clip.settings.effects = "dynamic"),
      remove_effects: () => (clip.settings.effects = "none"),
      add_more_effects: () => (clip.settings.effects = "cinematic"),
      change_framing: () => (clip.settings.framing = clip.settings.framing === "speaker" ? "center" : "speaker"),
    };
    if (body.quickAction && quickActionMap[body.quickAction]) quickActionMap[body.quickAction]();
    if (body.settings) Object.assign(clip.settings, body.settings);

    if (!project.sourcePath || !fs.existsSync(project.sourcePath)) {
      return sendJson(res, 422, {
        error: "The original source video for this project is no longer available, so it can't be re-rendered.",
      });
    }

    try {
      const { keyframes } =
        clip.settings.framing === "center"
          ? { keyframes: [{ t: 0, cx: 0.5 }] }
          : await detectFaceKeyframes(project.sourcePath, clip.startTime, clip.endTime);

      await renderClip({
        sourcePath: project.sourcePath,
        outputPath: clip.filePath,
        clipStart: clip.startTime,
        clipEnd: clip.endTime,
        words: project.transcript?.words || [],
        faceKeyframes: keyframes,
        framing: clip.settings.framing,
        effects: clip.settings.effects,
        captionStyle: clip.settings.captionStyle,
        watermarkText:
          project.brandKit?.watermark && clip.settings.effects !== "none"
            ? (project.brandKit.brandName || "").toUpperCase()
            : null,
        customText: clip.settings.customText || null,
        tone: clip.tone,
        scores: clip.scores,
        accentColor: project.brandKit?.accentColor,
      });
      clip.faceKeyframes = keyframes;
      clip.qc = await checkRenderedClip(clip.filePath, clip.duration);
      project.updatedAt = new Date().toISOString();
      jobQueue.projectsStore.save(project.id, project);
      sendJson(res, 200, clip);
    } catch (err) {
      sendJson(res, 500, { error: `Regeneration failed: ${err.message}` });
    }
  })
);

router.get(
  "/api/me",
  requireAuth((req, res) => sendJson(res, 200, { uid: req.user.uid, email: req.user.email, name: req.user.name }))
);

router.get("/api/health", (req, res) => sendJson(res, 200, { ok: true }));

// Public — server configuration status, no user data. Lets the frontend show a clear
// "what's missing" banner (even pre-login) instead of a confusing failure.
router.get("/api/setup-status", async (req, res) => {
  const [ytDlp, openCv, localSttOk, localAiOk] = await Promise.all([
    checkYtDlpAvailable(),
    checkOpenCvAvailable(),
    checkLocalSttAvailable(),
    checkOllamaAvailable(),
  ]);
  const firebaseConfigured = !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);

  const sttProvider = (process.env.STT_PROVIDER || "local").trim().toLowerCase();
  const sttOk = sttProvider === "openai" ? !!(process.env.STT_API_KEY || process.env.OPENAI_API_KEY) : localSttOk;
  const sttFix =
    sttProvider === "openai"
      ? "STT_PROVIDER=openai is set but its key is missing — add STT_API_KEY, or unset STT_PROVIDER to use the free local default."
      : "Run `pip install -r backend/requirements.txt` (installs faster-whisper, free/local, no API key).";

  const aiProviderName = (process.env.AI_PROVIDER || "local").trim().toLowerCase();
  const aiOk =
    aiProviderName === "local"
      ? localAiOk
      : aiProviderName === "openai"
      ? !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY)
      : aiProviderName === "anthropic"
      ? !!process.env.ANTHROPIC_API_KEY
      : aiProviderName === "mock";
  const aiFix =
    aiProviderName === "local"
      ? "Install Ollama (https://ollama.com, free) and run `ollama pull llama3.1:8b`, then make sure `ollama serve` is running."
      : `AI_PROVIDER=${aiProviderName} is set but its API key is missing — see backend/.env.example, or unset AI_PROVIDER to use the free local default.`;

  const checks = [
    {
      key: "firebase",
      label: "Authentication & project storage (Firebase Admin)",
      ok: firebaseConfigured,
      required: true,
      fix: "Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to backend/.env — see backend/.env.example.",
    },
    {
      key: "yt-dlp",
      label: "YouTube acquisition (yt-dlp, free)",
      ok: ytDlp,
      required: true,
      fix: "Install with `pip install yt-dlp` (also in backend/requirements.txt), ensure it's on PATH, restart the backend.",
    },
    {
      key: "stt",
      label: `Speech-to-text (${sttProvider === "openai" ? "OpenAI, paid" : "local Whisper, free"})`,
      ok: sttOk,
      required: true,
      fix: sttFix,
    },
    {
      key: "ai",
      label: `Semantic clip analysis (${aiProviderName === "local" ? "Ollama, free" : aiProviderName})`,
      ok: aiOk,
      required: true,
      fix: aiFix,
    },
    {
      key: "opencv",
      label: "Face-aware reframing (OpenCV, free)",
      ok: openCv,
      required: false,
      fix: "Install with `pip install -r backend/requirements.txt`. Optional — without it, clips fall back to center-crop framing.",
    },
  ];

  sendJson(res, 200, { ready: checks.filter((c) => c.required).every((c) => c.ok), checks });
});

// ---------- Server ----------

/** Maps internal errors to safe, user-facing messages — never a raw stack trace to the client. */
function toClientError(err) {
  if (err.name === "SetupRequiredError") {
    return { status: 500, body: { error: err.message, missingRequirements: err.missing, installHint: err.installHint } };
  }
  if (typeof err.status === "number") {
    return { status: err.status, body: { error: err.message } };
  }
  return { status: 500, body: { error: "Something went wrong on our end. Please try again." } };
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  const match = router.match(req.method, pathname);
  if (!match) return sendJson(res, 404, { error: "Not found." });

  try {
    req.params = match.params;
    await match.handler(req, res);
  } catch (err) {
    console.error(err); // full detail server-side only
    const { status, body } = toClientError(err);
    sendJson(res, status, body);
  }
});

server.listen(PORT, () => {
  console.log(`ClipForge API listening on http://localhost:${PORT}`);
});
