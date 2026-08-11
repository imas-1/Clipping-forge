import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Film, Trash2, Sparkles } from "lucide-react";
import { api, ProjectSummary } from "../api/client";

export default function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.projects));
  }, []);

  async function handleDelete(id: string) {
    await api.deleteProject(id);
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pt-14 pb-24">
      <h1 className="font-display text-3xl font-semibold">My Projects</h1>
      <p className="mt-1 text-white/45">Every video you've turned into clips.</p>

      {projects && projects.length === 0 && (
        <div className="card mt-10 flex flex-col items-center gap-3 py-16 text-center">
          <Film size={28} className="text-white/25" />
          <p className="text-white/50">No projects yet — paste a link to generate your first clips.</p>
          <Link to="/" className="btn-primary mt-2">
            <Sparkles size={16} /> Generate Clips
          </Link>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <div key={p.id} className="card group relative overflow-hidden">
            <Link to={`/projects/${p.id}`} className="block">
              <div className="aspect-video bg-ink-900 flex items-center justify-center text-white/20">
                <Film size={28} />
              </div>
              <div className="p-4">
                <p className="line-clamp-1 font-medium">{p.title}</p>
                <p className="mt-1 text-xs text-white/40">
                  {p.clipCount} clips · {new Date(p.createdAt).toLocaleDateString()}
                </p>
              </div>
            </Link>
            <button
              onClick={() => handleDelete(p.id)}
              className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white/60 opacity-0 backdrop-blur transition-opacity hover:text-signal-soft group-hover:opacity-100"
              title="Delete project"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
