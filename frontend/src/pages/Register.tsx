import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clapperboard, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email, password, name.trim() || undefined);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-sm flex-col justify-center px-4 sm:px-6">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal/15 border border-signal/30">
          <Clapperboard size={17} className="text-signal" strokeWidth={2.4} />
        </div>
        <span className="font-display text-lg font-semibold">ClipForge</span>
      </div>

      <h1 className="font-display text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-white/45">Paste a link, get finished clips.</p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="w-full min-w-0 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-signal/40"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full min-w-0 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-signal/40"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min. 6 characters)"
          className="w-full min-w-0 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-signal/40"
        />

        {error && (
          <div className="flex items-start gap-2 text-sm text-signal-soft">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading && <Loader2 size={16} className="animate-spin" />}
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/45">
        Already have an account?{" "}
        <Link to="/login" className="text-signal-soft hover:text-signal">
          Sign in
        </Link>
      </p>
    </div>
  );
}
