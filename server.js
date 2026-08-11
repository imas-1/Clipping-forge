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

// ---------- Routes ----------

router.post("/api/generate", async (req, res) => {
  const body = await readJsonBody(req);
  const { url, countMode = "auto", brandKit = null } = body;
  if (!url || !isValidYoutubeUrl(url)) {
    return sendJson(res, 400, { error: "Please paste a valid YouTube URL." });
  }
  const validCountModes = ["auto", "5", "10", "15", "20"];
  const normalizedCount = validCountModes.includes(String(countMode)) ? String(countMode) : "auto";

  const job = jobQueue.createJob({ url, countMode: normalizedCount, brandKit });
  sendJson(res, 202, { jobId: job.id, projectId: job.projectId });
});

router.get("/api/jobs/:jobId", (req, res) => {
  const job = jobQueue.getJob(req.params.jobId);
  if (!job) return sendJson(res, 404, { error: "Job not found." });
  sendJson(res, 200, job);
});

router.get("/api/projects", (req, res) => {
  const projects = jobQueue.projectsStore.all().map((p) => ({
    id: p.id,
    title: p.title,
    thumbnailUrl: p.videoInfo?.thumbnailUrl,
    clipCount: p.clips.length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
  sendJson(res, 200, { projects });
});

router.get("/api/projects/:projectId", (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  if (!project) return sendJson(res, 404, { error: "Project not found." });
  sendJson(res, 200, project);
});

router.patch("/api/projects/:projectId", async (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  if (!project) return sendJson(res, 404, { error: "Project not found." });
  const body = await readJsonBody(req);
  if (typeof body.title === "string" && body.title.trim()) project.title = body.title.trim();
  project.updatedAt = new Date().toISOString();
  jobQueue.projectsStore.save(project.id, project);
  sendJson(res, 200, project);
});

router.delete("/api/projects/:projectId", (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  if (!project) return sendJson(res, 404, { error: "Project not found." });
  jobQueue.projectsStore.delete(project.id);
  const dir = path.join(jobQueue.RENDERS_DIR, project.id);
  fs.rmSync(dir, { recursive: true, force: true });
  sendJson(res, 200, { deleted: true });
});

router.get("/api/projects/:projectId/clips/:clipId/file", (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  const clip = project?.clips.find((c) => c.id === req.params.clipId);
  if (!clip || !fs.existsSync(clip.filePath)) return sendJson(res, 404, { error: "Clip not found." });
  const stat = fs.statSync(clip.filePath);
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": stat.size,
    "Access-Control-Allow-Origin": "*",
    "Content-Disposition": `inline; filename="clip-${clip.rank}.mp4"`,
  });
  fs.createReadStream(clip.filePath).pipe(res);
});

router.get("/api/projects/:projectId/clips/:clipId/download", (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  const clip = project?.clips.find((c) => c.id === req.params.clipId);
  if (!clip || !fs.existsSync(clip.filePath)) return sendJson(res, 404, { error: "Clip not found." });
  const stat = fs.statSync(clip.filePath);
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": stat.size,
    "Access-Control-Allow-Origin": "*",
    "Content-Disposition": `attachment; filename="${(project.title || "clip").replace(/[^a-z0-9]+/gi, "-")}-${clip.rank}.mp4"`,
  });
  fs.createReadStream(clip.filePath).pipe(res);
});

router.get("/api/projects/:projectId/download-all", (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  if (!project) return sendJson(res, 404, { error: "Project not found." });
  const dir = path.join(jobQueue.RENDERS_DIR, project.id);
  const zipName = `${(project.title || "clips").replace(/[^a-z0-9]+/gi, "-")}.zip`;
  const zipPath = path.join(dir, "_all.zip");

  execFile("zip", ["-j", zipPath, ...project.clips.map((c) => c.filePath)], (err) => {
    if (err) return sendJson(res, 500, { error: "Could not build zip." });
    const stat = fs.statSync(zipPath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    });
    fs.createReadStream(zipPath).pipe(res);
  });
});

// Manual adjustment + regenerate — the "fallback" editing path (section 15/16 of spec)
router.patch("/api/projects/:projectId/clips/:clipId", async (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  const clip = project?.clips.find((c) => c.id === req.params.clipId);
  if (!clip) return sendJson(res, 404, { error: "Clip not found." });
  const body = await readJsonBody(req);
  Object.assign(clip.settings, body.settings || {});
  project.updatedAt = new Date().toISOString();
  jobQueue.projectsStore.save(project.id, project);
  sendJson(res, 200, clip);
});

router.post("/api/projects/:projectId/clips/:clipId/regenerate", async (req, res) => {
  const project = jobQueue.projectsStore.get(req.params.projectId);
  const clip = project?.clips.find((c) => c.id === req.params.clipId);
  if (!clip) return sendJson(res, 404, { error: "Clip not found." });
  const body = await readJsonBody(req);

  // Quick AI actions map onto concrete parameter changes, per spec section 17.
  const quickActionMap = {
    make_shorter: () => (clip.duration = Math.max(10, Math.round(clip.duration * 0.7))),
    make_longer: () => (clip.duration = Math.min(90, Math.round(clip.duration * 1.3))),
    more_dynamic_captions: () => (clip.settings.effects = "dynamic"),
    remove_effects: () => (clip.settings.effects = "none"),
    add_more_effects: () => (clip.settings.effects = "cinematic"),
    change_framing: () =>
      (clip.settings.framing = clip.settings.framing === "speaker" ? "center" : "speaker"),
  };
  if (body.quickAction && quickActionMap[body.quickAction]) quickActionMap[body.quickAction]();
  if (body.settings) Object.assign(clip.settings, body.settings);

  if (!project.sourcePath || !fs.existsSync(project.sourcePath)) {
    return sendJson(res, 422, {
      error: "The original source video for this project is no longer available, so it can't be re-rendered.",
    });
  }

  try {
    // Re-detect face keyframes only if framing changed away from a cached/forced mode —
    // cheap enough (a handful of sampled frames) to just always refresh on regenerate.
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
    });
    clip.faceKeyframes = keyframes;
    clip.qc = await checkRenderedClip(clip.filePath, clip.duration);
    project.updatedAt = new Date().toISOString();
    jobQueue.projectsStore.save(project.id, project);
    sendJson(res, 200, clip);
  } catch (err) {
    sendJson(res, 500, { error: `Regeneration failed: ${err.message}` });
  }
});

router.get("/api/health", (req, res) => sendJson(res, 200, { ok: true }));

// Lets the frontend show a clear "what's missing" banner instead of a failed job.
router.get("/api/setup-status", async (req, res) => {
  const [ytDlp, openCv] = await Promise.all([checkYtDlpAvailable(), checkOpenCvAvailable()]);
  const sttKeyPresent = !!(process.env.STT_API_KEY || process.env.OPENAI_API_KEY);

  const checks = [
    {
      key: "yt-dlp",
      label: "YouTube acquisition (yt-dlp)",
      ok: ytDlp,
      required: true,
      fix: "Install with `pip install yt-dlp`, ensure it's on PATH, restart the backend.",
    },
    {
      key: "stt",
      label: "Speech-to-text (STT_API_KEY)",
      ok: sttKeyPresent,
      required: true,
      fix: "Add STT_API_KEY (or OPENAI_API_KEY) to backend/.env, restart the backend.",
    },
    {
      key: "opencv",
      label: "Face-aware reframing (OpenCV)",
      ok: openCv,
      required: false,
      fix: "Install with `pip install opencv-python`. Optional — without it, clips fall back to center-crop framing.",
    },
  ];

  sendJson(res, 200, { ready: checks.filter((c) => c.required).every((c) => c.ok), checks });
});

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const match = router.match(req.method, pathname);
  if (!match) return sendJson(res, 404, { error: "Not found." });

  try {
    req.params = match.params;
    await match.handler(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`ClipForge API listening on http://localhost:${PORT}`);
});
