import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from "firebase/auth";
import { auth, firebaseConfigured } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Firebase auth error codes → messages people can actually act on. */
function friendlyAuthError(err: any): string {
  const code = err?.code || "";
  const map: Record<string, string> = {
    "auth/email-already-in-use": "An account with that email already exists — try logging in instead.",
    "auth/invalid-email": "That email address doesn't look valid.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — please wait a moment and try again.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    // Persists across refreshes automatically (Firebase's default local persistence).
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function requireAuthInstance() {
    if (!auth) throw new Error("Firebase isn't configured — set the VITE_FIREBASE_* variables in frontend/.env.");
    return auth;
  }

  async function register(email: string, password: string, displayName?: string) {
    try {
      const instance = requireAuthInstance();
      const cred = await createUserWithEmailAndPassword(instance, email, password);
      if (displayName) await updateProfile(cred.user, { displayName });
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }

  async function login(email: string, password: string) {
    try {
      await signInWithEmailAndPassword(requireAuthInstance(), email, password);
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }

  async function loginWithGoogle() {
    try {
      await signInWithPopup(requireAuthInstance(), new GoogleAuthProvider());
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }

  async function logout() {
    await signOut(requireAuthInstance());
  }

  async function resetPassword(email: string) {
    try {
      await sendPasswordResetEmail(requireAuthInstance(), email);
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }

  async function getIdToken() {
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, configured: firebaseConfigured, register, login, loginWithGoogle, logout, resetPassword, getIdToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
