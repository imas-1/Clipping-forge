import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Loader2, AlertTriangle, Wrench } from "lucide-react";
import { api, Job } from "../api/client";

export default function Processing() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedJob, setFailedJob] = useState<Job | null>(null);
  const navigate = useNavigate();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const j = await api.getJob(jobId!);
        if (cancelled) return;
        setJob(j);
        if (j.status === "completed" && j.projectId) {
          navigate(`/projects/${j.projectId}`, { replace: true });
          return;
        }
        if (j.status === "failed") {
          setError(j.error || "Something went wrong while generating your clips.");
          setFailedJob(j);
          return;
        }
        timer.current = window.setTimeout(poll, 1200);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Lost connection to the render job.");
      }
    }
    poll();

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [jobId, navigate]);

  if (error) {
    const isSetupIssue = !!failedJob?.missingRequirements?.length;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 pt-32 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-signal/10 border border-signal/30">
          {isSetupIssue ? <Wrench size={22} className="text-signal-soft" /> : <AlertTriangle size={22} className="text-signal-soft" />}
        </div>
        <h2 className="mt-5 font-display text-2xl font-semibold">
          {isSetupIssue ? "Setup required" : "Generation failed"}
        </h2>
        <p className="mt-2 text-white/50">{error}</p>

        {isSetupIssue && (
          <div className="mt-4 w-full rounded-xl border border-ink-700 bg-ink-850 p-4 text-left">
            <p className="label-eyebrow mb-2">Missing</p>
            <ul className="mb-3 list-disc pl-4 text-sm text-white/70">
              {failedJob!.missingRequirements!.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {failedJob?.installHint && <p className="text-xs text-white/40">{failedJob.installHint}</p>}
          </div>
        )}

        <button onClick={() => navigate("/")} className="btn-secondary mt-6">
          Back to dashboard
        </button>
      </div>
    );
  }

  const progress = job?.progress ?? 0;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 pt-28 pb-24">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="#1d1d2a" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#ff3b5c"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 44}
            strokeDashoffset={2 * Math.PI * 44 * (1 - progress / 100)}
            style={{ transition: "stroke-dashoffset 0.4s ease" }}
          />
        </svg>
        <span className="absolute font-display text-xl font-semibold">{progress}%</span>
      </div>

      <h2 className="mt-6 font-display text-2xl font-semibold">AI is creating your clips…</h2>
      <p className="mt-1.5 text-sm text-white/45">This usually takes a few minutes — no need to configure anything.</p>

      <ul className="mt-9 w-full space-y-1">
        {job?.steps.map((step) => (
          <li
            key={step.key}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
              step.status === "active" ? "bg-ink-850" : ""
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {step.status === "done" && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-reel/15 text-reel">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              {step.status === "active" && <Loader2 size={16} className="animate-spin text-signal" />}
              {step.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-ink-600" />}
            </span>
            <span
              className={`text-sm ${
                step.status === "done"
                  ? "text-white/50"
                  : step.status === "active"
                  ? "font-medium text-white"
                  : "text-white/30"
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
