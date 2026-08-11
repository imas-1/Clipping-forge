"use strict";
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { Store } = require("./lib/store");
const { SetupRequiredError } = require("./lib/errors");
const { fetchVideoInfo, downloadSource } = require("./services/youtubeService");
const { extractAudio } = require("./services/audioService");
const { transcribeAudio } = require("./services/transcriptService");
const { analyzeTranscript } = require("./services/aiPipeline");
const { detectFaceKeyframes } = require("./services/faceDetection");
const { renderClip } = require("./services/videoRenderer");
const { checkRenderedClip } = require("./services/qualityControl");

const DATA_DIR = path.join(__dirname, "..", "data");
const jobsStore = new Store(path.join(DATA_DIR, "jobs"));
const projectsStore = new Store(path.join(DATA_DIR, "projects"));
const RENDERS_DIR = path.join(DATA_DIR, "renders");
const SOURCES_DIR = path.join(DATA_DIR, "sources");

const PIPELINE_STEPS = [
  { key: "fetch_info", label: "Analyzing video" },
  { key: "acquire_source", label: "Retrieving source video" },
  { key: "extract_audio", label: "Extracting audio" },
  { key: "transcript", label: "Transcribing speech" },
  { key: "moments", label: "Finding best moments" },
  { key: "ranking", label: "Ranking clips" },
  { key: "rendering", label: "Cutting & reframing clips" },
  { key: "captions", label: "Generating captions" },
  { key: "quality", label: "Quality checking" },
];

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function newJobRecord(jobId, params) {
  return {
    id: jobId,
    status: "queued",
    progress: 0,
    currentStep: null,
    steps: PIPELINE_STEPS.map((s) => ({ ...s, status: "pending" })),
    params,
    error: null,
    missingRequirements: null,
    installHint: null,
    projectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function updateJob(jobId, patch) {
  const job = jobsStore.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobsStore.save(jobId, job);
  return job;
}

function setStep(jobId, key, status) {
  const job = jobsStore.get(jobId);
  if (!job) return;
  const step = job.steps.find((s) => s.key === key);
  if (step) step.status = status;
  const doneCount = job.steps.filter((s) => s.status === "done").length;
  job.progress = Math.round((doneCount / job.steps.length) * 100);
  job.currentStep = status === "active" ? key : job.currentStep;
  job.updatedAt = new Date().toISOString();
  jobsStore.save(jobId, job);
}

async function step(jobId, key, fn) {
  setStep(jobId, key, "active");
  const result = await fn();
  setStep(jobId, key, "done");
  return result;
}

function applyBrandKit(clip, brandKit) {
  if (!brandKit) return clip;
  return { ...clip, watermarkText: brandKit.watermark ? (brandKit.brandName || "").toUpperCase() : null };
}

function defaultClipSettings() {
  return {
    durationMode: "ai",
    captionStyle: "bold-pop",
    effects: "ai",
    framing: "ai",
    voiceVolume: 100,
    musicVolume: 0,
    customText: "",
  };
}

async function runPipeline(jobId) {
  try {
    updateJob(jobId, { status: "processing" });
    const job = jobsStore.get(jobId);
    const { url, countMode, brandKit } = job.params;
    const projectId = job.projectId;
    const projectDir = path.join(SOURCES_DIR, projectId);

    const videoInfo = await step(jobId, "fetch_info", () => fetchVideoInfo(url));
    const sourcePath = await step(jobId, "acquire_source", () => downloadSource(url, projectDir));
    const audioPath = await step(jobId, "extract_audio", () =>
      extractAudio(sourcePath, path.join(projectDir, "audio.mp3"))
    );
    const transcript = await step(jobId, "transcript", () => transcribeAudio(audioPath));

    const moments = await step(jobId, "moments", () => analyzeTranscript(transcript, countMode));
    const ranked = await step(jobId, "ranking", () => [...moments].sort((a, b) => b.scores.overall - a.scores.overall));

    const clips = [];
    await step(jobId, "rendering", async () => {
      let i = 0;
      for (const moment of ranked) {
        i++;
        const clipId = id("clip");
        const outputPath = path.join(RENDERS_DIR, projectId, `${clipId}.mp4`);

        const { keyframes, faceTrackingAvailable } = await detectFaceKeyframes(
          sourcePath,
          moment.startTime,
          moment.endTime
        );

        const settings = defaultClipSettings();
        const renderCfg = applyBrandKit({ watermarkText: null }, brandKit);

        await renderClip({
          sourcePath,
          outputPath,
          clipStart: moment.startTime,
          clipEnd: moment.endTime,
          words: transcript.words,
          faceKeyframes: keyframes,
          framing: settings.framing,
          effects: settings.effects,
          captionStyle: settings.captionStyle,
          watermarkText: renderCfg.watermarkText,
          customText: null,
        });

        clips.push({
          id: clipId,
          rank: i,
          startTime: moment.startTime,
          endTime: moment.endTime,
          duration: moment.duration,
          scores: moment.scores,
          hookLine: moment.hookLine,
          tags: moment.tags,
          filePath: outputPath,
          faceKeyframes: keyframes,
          faceTrackingAvailable,
          settings,
          qc: null,
        });
      }
    });

    await step(jobId, "captions", async () => true); // captions are burned in during rendering above

    await step(jobId, "quality", async () => {
      for (const clip of clips) {
        let qc = await checkRenderedClip(clip.filePath, clip.duration);
        if (!qc.passed) {
          // one automatic re-render attempt with center framing as a safer fallback
          await renderClip({
            sourcePath,
            outputPath: clip.filePath,
            clipStart: clip.startTime,
            clipEnd: clip.endTime,
            words: transcript.words,
            faceKeyframes: [{ t: 0, cx: 0.5 }],
            framing: "center",
            effects: "subtle",
            captionStyle: clip.settings.captionStyle,
            watermarkText: null,
            customText: null,
          });
          qc = await checkRenderedClip(clip.filePath, clip.duration);
        }
        clip.qc = qc;
      }
    });

    const project = {
      id: projectId,
      videoInfo,
      countMode,
      brandKit: brandKit || null,
      sourcePath,
      transcript: { words: transcript.words, language: transcript.language, duration: transcript.duration },
      clips,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
      title: videoInfo.title,
    };
    projectsStore.save(project.id, project);

    updateJob(jobId, { status: "completed", progress: 100, projectId: project.id });
  } catch (err) {
    if (err instanceof SetupRequiredError) {
      updateJob(jobId, {
        status: "failed",
        error: err.message,
        missingRequirements: err.missing,
        installHint: err.installHint,
      });
    } else {
      updateJob(jobId, { status: "failed", error: err.message });
    }
  }
}

function createJob(params) {
  const jobId = id("job");
  const projectId = id("proj");
  const job = newJobRecord(jobId, params);
  job.projectId = projectId;
  jobsStore.save(jobId, job);
  setImmediate(() => runPipeline(jobId));
  return job;
}

function getJob(jobId) {
  return jobsStore.get(jobId);
}

module.exports = {
  createJob,
  getJob,
  jobsStore,
  projectsStore,
  RENDERS_DIR,
  SOURCES_DIR,
  applyBrandKit,
  defaultClipSettings,
  id,
};
