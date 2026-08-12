"use strict";
const { SetupRequiredError } = require("./errors");

/**
 * Real Firebase Authentication verification, via firebase-admin. Every
 * protected route calls requireAuth(req) which verifies the bearer ID
 * token cryptographically against Firebase's public keys and returns the
 * real decoded uid — the backend NEVER trusts a userId sent in a request
 * body or query string. This sandbox has no outbound network access, so
 * the live token-verification call could not be exercised here (same
 * caveat as the yt-dlp/Whisper/LLM integrations) — it follows the
 * documented firebase-admin API exactly and fails loudly, never silently,
 * if credentials are missing or a token is invalid/expired.
 */

let _adminApp = null;
function getAdminApp() {
  if (_adminApp) return _adminApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new SetupRequiredError("Firebase Admin credentials are not configured, so authentication can't run.", {
      missing: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"],
      installHint:
        "Create a Firebase service account (Project Settings → Service Accounts → Generate new private key) " +
        "and set the three FIREBASE_* variables in backend/.env — see backend/.env.example.",
    });
  }

  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });
  }
  _adminApp = admin;
  return admin;
}

/** Verifies the Authorization: Bearer <idToken> header. Returns {uid, email, name} or throws. */
async function verifyRequestToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    const err = new Error("Missing Authorization header.");
    err.status = 401;
    throw err;
  }

  const admin = getAdminApp(); // throws SetupRequiredError if not configured
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return { uid: decoded.uid, email: decoded.email || null, name: decoded.name || null };
  } catch (e) {
    const err = new Error("Invalid or expired session — please sign in again.");
    err.status = 401;
    err.cause = e.message;
    throw err;
  }
}

/** Wraps a route handler so req.user is populated (or the request is rejected) before the handler runs. */
function requireAuth(handler) {
  return async (req, res) => {
    req.user = await verifyRequestToken(req); // lets thrown errors propagate to the router's catch-all
    return handler(req, res);
  };
}

module.exports = { requireAuth, verifyRequestToken, getAdminApp };
