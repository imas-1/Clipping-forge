import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Clapperboard, FolderClosed, Palette, User as UserIcon, LogIn } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Processing from "./pages/Processing";
import Results from "./pages/Results";
import Projects from "./pages/Projects";
import BrandKitPage from "./pages/BrandKit";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import Profile from "./pages/Profile";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 ${
          isActive ? "bg-ink-800 text-white" : "text-white/50 hover:text-white hover:bg-ink-800/60"
        }`
      }
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  );
}

function Header() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4">
        <NavLink to="/" className="flex min-w-0 shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal/15 border border-signal/30">
            <Clapperboard size={17} className="text-signal" strokeWidth={2.4} />
          </div>
          <span className="hidden font-display text-lg font-semibold tracking-tight xs:inline">ClipForge</span>
        </NavLink>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
          <NavItem to="/" icon={<Clapperboard size={16} />} label="Generate" />
          <NavItem to="/projects" icon={<FolderClosed size={16} />} label="Projects" />
          <NavItem to="/brand-kit" icon={<Palette size={16} />} label="Brand kit" />
          {user ? (
            <NavItem to="/profile" icon={<UserIcon size={16} />} label="Profile" />
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-white/50 hover:text-white sm:px-3"
            >
              <LogIn size={16} />
              <span className="hidden sm:inline">Sign in</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Header />

      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/:jobId"
            element={
              <ProtectedRoute>
                <Processing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <Projects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <ProtectedRoute>
                <Results />
              </ProtectedRoute>
            }
          />
          <Route
            path="/brand-kit"
            element={
              <ProtectedRoute>
                <BrandKitPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

