import { useNavigate } from "react-router-dom";
import { LogOut, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LIMITS_INFO } from "../lib/limits";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="mx-auto max-w-xl px-4 sm:px-6 pt-14 pb-24">
      <h1 className="font-display text-3xl font-semibold">Profile</h1>

      <div className="card mt-8 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-signal/15 border border-signal/30">
            <UserIcon size={22} className="text-signal-soft" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{user?.displayName || "ClipForge user"}</p>
            <p className="flex items-center gap-1.5 truncate text-sm text-white/45">
              <Mail size={13} className="shrink-0" />
              <span className="truncate">{user?.email}</span>
            </p>
          </div>
        </div>

        <button onClick={handleLogout} className="btn-secondary mt-6 w-full">
          <LogOut size={16} /> Sign out
        </button>
      </div>

      <div className="card mt-4 p-6">
        <p className="label-eyebrow mb-3">Current plan limits</p>
        <ul className="space-y-2 text-sm text-white/60">
          <li>Up to {LIMITS_INFO.maxProjects} saved projects</li>
          <li>Up to {LIMITS_INFO.maxClipsPerRequest} clips per generation</li>
          <li>Source videos up to {LIMITS_INFO.maxSourceMinutes} minutes</li>
          <li>{LIMITS_INFO.maxConcurrentJobs} generation running at a time</li>
        </ul>
      </div>
    </div>
  );
}
