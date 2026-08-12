"use strict";
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { Store } = require("./lib/store");
const { SetupRequiredError } = require("./lib/errors");
const { fetchVideoInfo, downloadSource } = require("./services/youtubeService");
const { extractAudio } = require("./services/audioService");
const { transcribeAudio } = require("./services/transcriptService");
const { analyzeTranscript, runContentQualityCheck, generateAllCandidates, rankAndSelect } = require("./services/semanticAnalysis");
const { detectFaceKeyframes } = require("./services/faceDetection");
const { renderClip } = require("./services/videoRenderer");
const { checkRenderedClip } = require("./services/qualityControl");
const { LIMITS } = require("./config/limits");
const firestoreStore = require("./lib/firestoreStore");

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
  { key: "moments", label: "AI understanding the video" },
  { key: "ranking", label: "Ranking & diversifying clips" },
  { key: "content_qc", label: "AI reviewing clip boundaries" },
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
    const { url, countMode, brandKit, userId } = job.params;
    const projectId = job.projectId;
    const projectDir = path.join(SOURCES_DIR, projectId);

    const videoInfo = await step(jobId, "fetch_info", () => fetchVideoInfo(url));

    if (videoInfo.durationSeconds > LIMITS.MAX_SOURCE_VIDEO_SECONDS) {
      const maxMinutes = Math.round(LIMITS.MAX_SOURCE_VIDEO_SECONDS / 60);
      throw new Error(
        `This video is ${Math.round(videoInfo.durationSeconds / 60)} minutes long, which is over the current ${maxMinutes}-minute limit for this deployment.`
      );
    }

    // Firestore doc created early (status: "processing") so it shows up in the user's
    // project history immediately, not only once rendering finishes.
    if (userId) {
      await firestoreStore.createProjectDoc(projectId, {
        userId,
        title: videoInfo.title,
        thumbnailUrl: videoInfo.thumbnailUrl,
        sourceUrl: url,
        clipCount: 0,
        status: "processing",
      });
    }

    const sourcePath = await step(jobId, "acquire_source", () => downloadSource(url, projectDir));
    const audioPath = await step(jobId, "extract_audio", () =>
      extractAudio(sourcePath, path.join(projectDir, "audio.mp3"))
    );
    const transcript = await step(jobId, "transcript", () => transcribeAudio(audioPath));

    const moments = await step(jobId, "moments", () => generateAllCandidates(transcript));
    const ranked = await step(jobId, "ranking", () => rankAndSelect(moments, countMode, transcript.words));

    const reviewed = await step(jobId, "content_qc", async () => {
      const out = [];
      for (const m of ranked) {
        const { candidate } = await runContentQualityCheck(m, transcript.words);
        out.push(candidate);
      }
      return out;
    });

    const clips = [];
    await step(jobId, "rendering", async () => {
      let i = 0;
      for (const moment of reviewed) {
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
          tone: moment.tone,
          scores: moment.scores,
          accentColor: brandKit?.accentColor,
        });

        clips.push({
          id: clipId,
          rank: i,
          startTime: moment.startTime,
          endTime: moment.endTime,
          duration: moment.duration,
          scores: moment.scores,
          viralScore: moment.viralScore,
          title: moment.title,
          hookLine: moment.hookLine,
          description: moment.description,
          topic: moment.topic,
          tone: moment.tone,
          reason: moment.reason,
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
      userId: userId || null,
      videoInfo,
      countMode,
      brandKit: brandKit || null,
      sourcePath,
      transcript: { words: transcript.words, language: transcript.language, duration: transcript.duration },
      clips,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
      title: videoInfo.title,
      status: "completed",
    };
    projectsStore.save(project.id, project);

    if (userId) {
      await firestoreStore.updateProjectDoc(projectId, {
        clipCount: clips.length,
        status: "completed",
        thumbnailUrl: videoInfo.thumbnailUrl,
      });
    }

    updateJob(jobId, { status: "completed", progress: 100, projectId: project.id });
  } catch (err) {
    const job = jobsStore.get(jobId);
    if (job?.params?.userId) {
      await firestoreStore.updateProjectDoc(job.projectId, { status: "failed" }).catch(() => {});
    }
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

function countActiveJobsForUser(userId) {
  if (!userId) return 0;
  return jobsStore
    .all()
    .filter((j) => j.params?.userId === userId && (j.status === "queued" || j.status === "processing")).length;
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
  countActiveJobsForUser,
  id,
};
