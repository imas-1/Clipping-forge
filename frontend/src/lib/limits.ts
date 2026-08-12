/**
 * Display-only mirror of backend/src/config/limits.js. The backend is the
 * real enforcement point (it never trusts the frontend) — this just lets
 * the UI show accurate numbers without an extra request. Keep these in
 * sync with the backend defaults; if you change LIMIT_* env vars on the
 * backend, update this too (or fetch them from an endpoint if they need
 * to be dynamic).
 */
export const LIMITS_INFO = {
  maxProjects: 10,
  maxClipsPerRequest: 10,
  maxSourceMinutes: 60,
  maxConcurrentJobs: 1,
};
