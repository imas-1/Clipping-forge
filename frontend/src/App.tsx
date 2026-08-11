import { NavLink, Route, Routes } from "react-router-dom";
import { Clapperboard, FolderClosed, Palette } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Processing from "./pages/Processing";
import Results from "./pages/Results";
import Projects from "./pages/Projects";
import BrandKitPage from "./pages/BrandKit";

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-ink-800 text-white" : "text-white/50 hover:text-white hover:bg-ink-800/60"
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal/15 border border-signal/30">
              <Clapperboard size={17} className="text-signal" strokeWidth={2.4} />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">ClipForge</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            <NavItem to="/" icon={<Clapperboard size={16} />} label="Generate" />
            <NavItem to="/projects" icon={<FolderClosed size={16} />} label="Projects" />
            <NavItem to="/brand-kit" icon={<Palette size={16} />} label="Brand kit" />
          </nav>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs/:jobId" element={<Processing />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Results />} />
          <Route path="/brand-kit" element={<BrandKitPage />} />
        </Routes>
      </main>
    </div>
  );
}
