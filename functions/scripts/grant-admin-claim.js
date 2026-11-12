'use strict';

// Run only from a trusted workstation authenticated with Firebase Admin
// credentials (for example, `gcloud auth application-default login`).
// Usage: node scripts/grant-admin-claim.js <firebase-auth-uid>
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const uid = process.argv[2];
if (!projectId || !uid || uid.length < 10) {
  console.error('Set FIREBASE_PROJECT_ID and provide the exact Firebase Auth UID.');
  process.exit(2);
}

initializeApp({ projectId });
async function main() {
  const user = await getAuth().getUser(uid);
  if (!user.email || !user.emailVerified) throw new Error('Admin account must have a verified email.');
  await getAuth().setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: true });
  console.log(`Admin claim assigned to verified account ${user.email} (${uid}) in ${projectId}.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
