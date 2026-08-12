"use strict";
const { getAdminApp } = require("./auth");

/**
 * Firestore is the metadata source of truth for "which projects exist and
 * who owns them" — required so project history/authorization don't depend
 * only on local disk (which doesn't survive a redeploy on most hosts, and
 * can't be queried "give me this user's projects" cheaply). The heavy
 * per-clip render data (scores, face keyframes, transcript text, local
 * file paths) stays in the local JSON store (see lib/store.js) — mirroring
 * that into Firestore too would burn through the free-tier document-write
 * quota fast for no real benefit, since it's only ever read back by its
 * own project's job, not listed or queried.
 *
 * Collection shape:
 *   projects/{projectId}
 *     userId, title, thumbnailUrl, sourceUrl, clipCount, status,
 *     createdAt, updatedAt
 *
 * This sandbox has no outbound network access, so live Firestore calls
 * could not be exercised here — this follows firebase-admin's documented
 * Firestore API exactly and fails loudly (never silently) on any error.
 */

function db() {
  const admin = getAdminApp(); // throws SetupRequiredError if Firebase Admin creds are missing
  return admin.firestore();
}

async function createProjectDoc(projectId, { userId, title, thumbnailUrl, sourceUrl, clipCount, status }) {
  const now = new Date().toISOString();
  const doc = { userId, title, thumbnailUrl: thumbnailUrl || null, sourceUrl, clipCount, status, createdAt: now, updatedAt: now };
  await db().collection("projects").doc(projectId).set(doc);
  return { id: projectId, ...doc };
}

async function updateProjectDoc(projectId, patch) {
  await db().collection("projects").doc(projectId).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

/** Real per-user query — Firestore only ever returns documents matching this user's uid, never all projects. */
async function listProjectDocsForUser(userId) {
  const snap = await db().collection("projects").where("userId", "==", userId).orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getProjectDoc(projectId) {
  const doc = await db().collection("projects").doc(projectId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function deleteProjectDoc(projectId) {
  await db().collection("projects").doc(projectId).delete();
}

/** Real per-user count, used to enforce the free-tier project limit (see config/limits.js). */
async function countProjectsForUser(userId) {
  const snap = await db().collection("projects").where("userId", "==", userId).count().get();
  return snap.data().count;
}

module.exports = { createProjectDoc, updateProjectDoc, listProjectDocsForUser, getProjectDoc, deleteProjectDoc, countProjectsForUser };
