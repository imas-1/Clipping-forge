import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Pencil, Play, Loader2, X, RotateCcw, Wand2 } from "lucide-react";
import { api, Clip, Project } from "../api/client";

function ScoreRing({ score }: { score: number }) {
  const color = score >= 90 ? "#17e9b6" : score >= 75 ? "#ff3b5c" : "#8b8ba3";
  const circumference = 2 * Math.PI * 15;
  return (
    <div className="relative flex h-9 w-9 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1d1d2a" strokeWidth="3.5" />
        <circle
          cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-medium">{score}</span>
    </div>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ClipCard({ project, clip, onEdit }: { project: Project; clip: Clip; onEdit: () => void }) {
  const [showVideo, setShowVideo] = useState(false);
  return (
    <div className="card overflow-hidden animate-rise">
      <div className="relative aspect-[9/16] bg-ink-900">
        {showVideo ? (
          <video src={api.clipStreamUrl(project.id, clip.id)} controls autoPlay className="h-full w-full object-cover" />
        ) : (
          <button onClick={() => setShowVideo(true)} className="group flex h-full w-full flex-col items-center justify-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur transition-transform group-hover:scale-105">
              <Play size={22} className="ml-0.5 text-white" fill="white" />
            </div>
            <span className="px-6 text-center text-sm text-white/60">{clip.hookLine}</span>
          </button>
        )}
        <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] backdrop-blur">
          #{clip.rank}
        </div>
        <div className="absolute right-3 top-3">
          <ScoreRing score={clip.scores.overall} />
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between text-xs text-white/40">
          <span className="font-mono">{formatDuration(clip.duration)}</span>
          <span>AI score {clip.scores.overall}/100</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-white/75">“{clip.hookLine}”</p>

        <div className="mt-4 flex gap-2">
          <button onClick={() => setShowVideo(true)} className="btn-secondary flex-1 !py-2.5 text-sm">
            <Play size={14} /> Watch
          </button>
          <button onClick={onEdit} className="btn-secondary !py-2.5 !px-3">
            <Pencil size={14} />
          </button>
          <a href={api.clipDownloadUrl(project.id, clip.id)} className="btn-secondary !py-2.5 !px-3">
            <Download size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}

const QUICK_ACTIONS: { key: string; label: string }[] = [
  { key: "make_shorter", label: "Make it shorter" },
  { key: "make_longer", label: "Make it longer" },
  { key: "more_dynamic_captions", label: "Make captions more dynamic" },
  { key: "remove_effects", label: "Remove effects" },
  { key: "add_more_effects", label: "Add more effects" },
  { key: "change_framing", label: "Change framing" },
];

function EditDrawer({ project, clip, onClose, onUpdated }: { project: Project; clip: Clip; onClose: () => void; onUpdated: (c: Clip) => void }) {
  const [settings, setSettings] = useState(clip.settings);
  const [customText, setCustomText] = useState(clip.settings.customText);
  const [regenerating, setRegenerating] = useState(false);

  async function persistSettings(next: typeof settings) {
    setSettings(next);
    await api.updateClipSettings(project.id, clip.id, next);
  }

  async function regenerate(quickAction?: string) {
    setRegenerating(true);
    try {
      const updated = await api.regenerateClip(project.id, clip.id, {
        quickAction,
        settings: { ...settings, customText },
      });
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col border-l border-ink-700 bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-4">
          <div>
            <h3 className="font-display font-semibold">Edit clip #{clip.rank}</h3>
            <p className="text-xs text-white/40">Small adjustments only — AI handles the rest</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <section>
            <p className="label-eyebrow mb-2">Quick AI actions</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.key}
                  disabled={regenerating}
                  onClick={() => regenerate(a.key)}
                  className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:border-signal/40 hover:text-white disabled:opacity-40"
                >
                  <Wand2 size={11} className="mr-1.5 inline -mt-0.5 text-signal-soft" />
                  {a.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="label-eyebrow mb-2">Effects</p>
            <div className="grid grid-cols-4 gap-2">
              {(["ai", "subtle", "dynamic", "cinematic"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => persistSettings({ ...settings, effects: v })}
                  className={`rounded-lg border px-2 py-2 text-xs capitalize transition-colors ${
                    settings.effects === v ? "border-signal/50 bg-signal/10 text-white" : "border-ink-700 text-white/50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="label-eyebrow mb-2">Framing</p>
            <div className="grid grid-cols-3 gap-2">
              {(["ai", "center", "speaker"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => persistSettings({ ...settings, framing: v })}
                  className={`rounded-lg border px-2 py-2 text-xs capitalize transition-colors ${
                    settings.framing === v ? "border-signal/50 bg-signal/10 text-white" : "border-ink-700 text-white/50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="label-eyebrow mb-2">Audio</p>
            <label className="mb-1 flex justify-between text-xs text-white/50">
              <span>Voice volume</span><span>{settings.voiceVolume}%</span>
            </label>
            <input
              type="range" min={0} max={150} value={settings.voiceVolume}
              onChange={(e) => setSettings({ ...settings, voiceVolume: Number(e.target.value) })}
              onMouseUp={() => persistSettings(settings)}
              className="w-full accent-signal"
            />
            <label className="mb-1 mt-3 flex justify-between text-xs text-white/50">
              <span>Music volume</span><span>{settings.musicVolume}%</span>
            </label>
            <input
              type="range" min={0} max={100} value={settings.musicVolume}
              onChange={(e) => setSettings({ ...settings, musicVolume: Number(e.target.value) })}
              onMouseUp={() => persistSettings(settings)}
              className="w-full accent-signal"
            />
          </section>

          <section>
            <p className="label-eyebrow mb-2">Custom text (optional)</p>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Overlay a specific line instead of the AI-picked caption…"
              className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm placeholder:text-white/25 focus:outline-none focus:border-signal/40"
              rows={3}
            />
          </section>
        </div>

        <div className="border-t border-ink-800 p-5">
          <button onClick={() => regenerate()} disabled={regenerating} className="btn-primary w-full">
            {regenerating ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Results() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId).then(setProject).catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="mx-auto max-w-md px-6 pt-28 text-center text-white/50">{error}</div>;
  if (!project) return <div className="mx-auto max-w-md px-6 pt-28 text-center text-white/40">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl px-6 pt-14 pb-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow mb-2">{project.clips.length} clips ready</p>
          <h1 className="font-display text-3xl font-semibold">Your clips are ready.</h1>
          <p className="mt-1 text-white/45">From “{project.videoInfo.title}”</p>
        </div>
        <a href={api.downloadAllUrl(project.id)} className="btn-primary">
          <Download size={16} /> Download All
        </a>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {project.clips.map((clip) => (
          <ClipCard key={clip.id} project={project} clip={clip} onEdit={() => setEditingClip(clip)} />
        ))}
      </div>

      {editingClip && (
        <EditDrawer
          project={project}
          clip={editingClip}
          onClose={() => setEditingClip(null)}
          onUpdated={(updated) => {
            setProject((p) => (p ? { ...p, clips: p.clips.map((c) => (c.id === updated.id ? updated : c)) } : p));
            setEditingClip(updated);
          }}
        />
      )}
    </div>
  );
}
