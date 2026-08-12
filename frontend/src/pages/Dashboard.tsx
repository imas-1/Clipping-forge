import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Link2, ChevronDown, AlertCircle, ShieldAlert, CheckCircle2 } from "lucide-react";
import { api, CountMode, BrandKit, SetupStatus } from "../api/client";
import { loadBrandKit } from "../lib/brandKitStorage";

const COUNT_OPTIONS: { value: CountMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "15", label: "15" },
  { value: "20", label: "20" },
];

export default function Dashboard() {
  const [url, setUrl] = useState("");
  const [countMode, setCountMode] = useState<CountMode>("auto");
  const [showCount, setShowCount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getSetupStatus().then(setSetup).catch(() => setSetup(null));
  }, []);

  const blockingChecks = setup?.checks.filter((c) => c.required && !c.ok) ?? [];

  async function handleGenerate() {
    setError(null);
    if (!url.trim()) {
      setError("Paste a YouTube link first.");
      return;
    }
    setLoading(true);
    try {
      const brandKit: BrandKit | null = loadBrandKit();
      const { jobId } = await api.generate(url.trim(), countMode, brandKit);
      navigate(`/jobs/${jobId}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong starting generation.");
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      {/* ambient scanning line — the one signature motion element on this page */}
      <div className="pointer-events-none absolute inset-x-0 top-24 h-px overflow-hidden opacity-40">
        <div className="h-px w-1/3 bg-gradient-to-r from-transparent via-signal to-transparent animate-scan" />
      </div>

      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-28 pb-24 text-center">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-1.5">
          <span className="rec-dot" />
          <span className="label-eyebrow">AI editing pipeline, fully automatic</span>
        </div>

        <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Turn any YouTube video
          <br />
          into <span className="text-signal">viral clips</span>.
        </h1>
        <p className="mt-5 max-w-lg text-lg text-white/55">
          Paste a link and let AI do the editing — hooks, cuts, captions, and framing, decided for you.
        </p>

        {setup && blockingChecks.length > 0 && (
          <div className="mt-8 w-full rounded-xl border border-signal/30 bg-signal/5 p-4 text-left">
            <div className="flex items-center gap-2 text-signal-soft">
              <ShieldAlert size={16} />
              <p className="text-sm font-semibold">Backend setup required before real clips can be generated</p>
            </div>
            <ul className="mt-3 space-y-2">
              {blockingChecks.map((c) => (
                <li key={c.key} className="text-sm text-white/60">
                  <span className="font-medium text-white/80">{c.label}</span> — {c.fix}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-white/35">
              This app never fakes results — Generate is disabled until these are connected. See the README for exact
              setup steps.
            </p>
          </div>
        )}
        {setup && blockingChecks.length === 0 && (
          <div className="mt-8 flex items-center gap-2 text-xs text-reel/80">
            <CheckCircle2 size={14} /> AI pipeline connected and ready
          </div>
        )}

        <div className="mt-10 w-full">
          <div className="card flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3.5">
              <Link2 size={18} className="shrink-0 text-white/35" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleGenerate()}
                placeholder="Paste YouTube URL"
                disabled={blockingChecks.length > 0}
                className="w-full bg-transparent font-medium text-white placeholder:text-white/30 focus:outline-none disabled:opacity-40"
                autoFocus
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || blockingChecks.length > 0}
              className="btn-primary shrink-0 sm:w-auto w-full"
            >
              <Sparkles size={17} />
              {loading ? "Starting…" : "Generate Clips"}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-signal-soft">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setShowCount((s) => !s)}
              className="btn-ghost"
            >
              Number of clips: <span className="text-white/90">{COUNT_OPTIONS.find((c) => c.value === countMode)?.label}</span>
              <ChevronDown size={14} className={`transition-transform ${showCount ? "rotate-180" : ""}`} />
            </button>
          </div>

          {showCount && (
            <div className="mt-2 flex flex-wrap justify-center gap-2 animate-rise">
              {COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCountMode(opt.value)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    countMode === opt.value
                      ? "border-signal/50 bg-signal/10 text-white"
                      : "border-ink-700 bg-ink-850 text-white/55 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-16 text-sm text-white/30">
          The AI decides moments, duration, framing, captions, and effects. You only adjust something after — if you want to.
        </p>
      </div>
    </div>
  );
}
