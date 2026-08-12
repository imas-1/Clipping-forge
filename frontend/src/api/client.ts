const API_BASE = import.meta.env.VITE_API_BASE || "/api";
import { auth } from "../lib/firebase";

export type CountMode = "auto" | "5" | "10" | "15" | "20";

export interface BrandKit {
  brandName: string;
  accentColor: string;
  watermark: boolean;
}

export interface JobStep {
  key: string;
  label: string;
  status: "pending" | "active" | "done";
}

export interface Job {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  currentStep: string | null;
  steps: JobStep[];
  error: string | null;
  missingRequirements: string[] | null;
  installHint: string | null;
  projectId: string | null;
  createdAt: string;
}

export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  fix: string;
}

export interface SetupStatus {
  ready: boolean;
  checks: SetupCheck[];
}

export interface ClipScores {
  hook: number;
  engagement: number;
  emotional: number;
  information: number;
  clarity: number;
  standalone: number;
  story: number;
  retention: number;
  shareability: number;
}

export interface ClipSettings {
  durationMode: "ai" | "shorter" | "longer" | "custom";
  captionStyle: string;
  effects: "ai" | "none" | "dynamic" | "cinematic" | "subtle";
  framing: "ai" | "center" | "speaker";
  voiceVolume: number;
  musicVolume: number;
  customText: string;
}

export interface Clip {
  id: string;
  rank: number;
  startTime: number;
  endTime: number;
  duration: number;
  scores: ClipScores;
  viralScore: number;
  title: string;
  hookLine: string;
  description: string;
  topic: string;
  tone: string;
  reason: string;
  tags: string[];
  settings: ClipSettings;
  qc: { passed: boolean } | null;
}

export interface Project {
  id: string;
  title: string;
  countMode: CountMode;
  videoInfo: { title: string; channel: string; durationSeconds: number; thumbnailUrl: string; url: string };
  clips: Clip[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  thumbnailUrl: string;
  clipCount: number;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

/**
 * Video/zip endpoints are auth-protected server-side, but a plain <a href>
 * or <video src> can't attach an Authorization header — so these fetch the
 * file as an authenticated request and hand back a blob: URL the browser
 * can play/download normally. Callers should revoke the URL when done
 * (e.g. on unmount) to avoid leaking memory.
 */
async function fetchAuthedBlobUrl(path: string): Promise<string> {
  const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Could not load file (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function triggerBrowserDownload(blobUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const api = {
  getSetupStatus: () => request<SetupStatus>("/setup-status"),

  generate: (url: string, countMode: CountMode, brandKit: BrandKit | null) =>
    request<{ jobId: string; projectId: string }>("/generate", {
      method: "POST",
      body: JSON.stringify({ url, countMode, brandKit }),
    }),

  getJob: (jobId: string) => request<Job>(`/jobs/${jobId}`),

  listProjects: () => request<{ projects: ProjectSummary[] }>("/projects"),

  getProject: (projectId: string) => request<Project>(`/projects/${projectId}`),

  renameProject: (projectId: string, title: string) =>
    request<Project>(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  deleteProject: (projectId: string) => request<{ deleted: boolean }>(`/projects/${projectId}`, { method: "DELETE" }),

  loadClipVideoBlobUrl: (projectId: string, clipId: string) => fetchAuthedBlobUrl(`/projects/${projectId}/clips/${clipId}/file`),
  downloadClip: async (projectId: string, clipId: string, filename: string) => {
    const url = await fetchAuthedBlobUrl(`/projects/${projectId}/clips/${clipId}/download`);
    triggerBrowserDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
  downloadAll: async (projectId: string, filename: string) => {
    const url = await fetchAuthedBlobUrl(`/projects/${projectId}/download-all`);
    triggerBrowserDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },

  updateClipSettings: (projectId: string, clipId: string, settings: Partial<ClipSettings>) =>
    request<Clip>(`/projects/${projectId}/clips/${clipId}`, { method: "PATCH", body: JSON.stringify({ settings }) }),

  regenerateClip: (projectId: string, clipId: string, payload: { quickAction?: string; settings?: Partial<ClipSettings> }) =>
    request<Clip>(`/projects/${projectId}/clips/${clipId}/regenerate`, { method: "POST", body: JSON.stringify(payload) }),
};
