import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();
  const location = useLocation();

  if (!configured) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 pt-28 text-center">
        <h2 className="font-display text-xl font-semibold">Sign-in isn't configured yet</h2>
        <p className="mt-2 text-sm text-white/50">
          Firebase client config is missing. Set the VITE_FIREBASE_* variables in frontend/.env and restart the dev server.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
