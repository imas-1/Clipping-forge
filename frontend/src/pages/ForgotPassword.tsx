import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Clapperboard, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
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

      <h1 className="font-display text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-white/45">We'll email you a link to choose a new one.</p>

      {sent ? (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-reel/25 bg-reel/5 p-4 text-sm text-white/70">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-reel" />
          <span>Check {email} for a password reset link.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
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
            Send reset link
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-white/45">
        <Link to="/login" className="text-signal-soft hover:text-signal">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
