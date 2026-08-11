const API_BASE = import.meta.env.VITE_API_BASE || "/api";

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
  clarity: number;
  standalone: number;
  retention: number;
  overall: number;
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
  hookLine: string;
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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
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

  clipStreamUrl: (projectId: string, clipId: string) => `${API_BASE}/projects/${projectId}/clips/${clipId}/file`,
  clipDownloadUrl: (projectId: string, clipId: string) => `${API_BASE}/projects/${projectId}/clips/${clipId}/download`,
  downloadAllUrl: (projectId: string) => `${API_BASE}/projects/${projectId}/download-all`,

  updateClipSettings: (projectId: string, clipId: string, settings: Partial<ClipSettings>) =>
    request<Clip>(`/projects/${projectId}/clips/${clipId}`, { method: "PATCH", body: JSON.stringify({ settings }) }),

  regenerateClip: (projectId: string, clipId: string, payload: { quickAction?: string; settings?: Partial<ClipSettings> }) =>
    request<Clip>(`/projects/${projectId}/clips/${clipId}/regenerate`, { method: "POST", body: JSON.stringify(payload) }),
};
