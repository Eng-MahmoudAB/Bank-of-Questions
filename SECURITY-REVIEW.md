# Security review and migration status

## Implemented on this feature branch

- Removed the default administrator password from the browser seed, settings UI, and exported server payloads.
- Administrator sign-in uses Firebase Authentication; Admin SDK Functions require a verified email and the server-side `admin: true` custom claim. A trusted bootstrap script grants that claim.
- Replaced client Firestore access and whole-document writes with callable Functions.
- Student activation codes are checked on the server for format, status, expiry, and device binding. Successful login receives a custom Firebase token for that student's hashed code identity.
- Student reads are scoped to the authenticated student's record. Exam scores, mistake history, and submissions are calculated and written by the server. Profile image changes, clearing the mistake bank, and device-change requests use narrow Functions.
- Student Functions enforce Firebase App Check. The client has a placeholder for the public reCAPTCHA v3 site key and blocks student sign-in until configured.
- Firestore rules deny all client reads and writes. Admin SDK access bypasses Rules, so the Functions enforce the role claim themselves.
- Admin writes use a revision check so stale administrator pages cannot silently overwrite newer updates.

## Remaining before production

- The legacy data is still stored in one Firestore document. The backend rejects data over 900 KB, and every student result currently updates that document. Split public content, requests, and student records into separate documents/collections before a high-volume rollout.
- Replace the App Check site-key placeholder after the owner registers the web app. Keep the secret key in Console. Confirm Functions App Check enforcement and service-account permissions in the emulator/deployment environment.
- Existing Firestore deny-all Rules remain in effect. This branch has not deployed any Functions or Rules; live Firebase behavior is unverified.
- Ten callable unit tests pass with mocked Firebase services. The Rules emulator suite is included but could not run here because Java is unavailable. Browser end-to-end tests and live Firebase tests remain unverified.
- The default administrator password appeared in earlier public Git history. Rotate any credential that reused it; removing it from the current file does not erase prior commits.

## Safe rollout sequence

1. Preserve a private backup of the legacy Firestore record and any browser-only data.
2. Register App Check for the website, provide the public site key, and confirm Firestore/Functions region and billing settings.
3. Run unit tests, Rules emulator tests, and browser flows for admin, active student, expired/disabled code, device mismatch, result submission, and concurrent writes.
4. Verify the admin Auth account's email, then assign its custom claim from a trusted workstation.
5. Review and deploy Functions and deny-by-default Rules only after the tests pass. Keep the legacy client cloud access closed during this step.
6. Split legacy storage into content, request, and per-student records; then load-test before restoring full production use.

Never use `allow read, write: if true`, and never reintroduce browser-side shared-database writes.
