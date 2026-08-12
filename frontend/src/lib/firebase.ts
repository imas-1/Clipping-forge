import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/**
 * These VITE_FIREBASE_* values are Firebase's public client-side config —
 * they identify the project, they are not secrets (Firebase's security
 * model relies on server-side rules and Admin SDK verification, not on
 * hiding this object). The private service-account credentials
 * (FIREBASE_PRIVATE_KEY etc.) live only in backend/.env and are never sent
 * to the browser — see backend/src/lib/auth.js.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

export const app = firebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
