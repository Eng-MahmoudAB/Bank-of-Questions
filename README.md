# Bank of Questions

The site is hosted as a static GitHub Pages application. Firebase backend files are prepared on the feature branch; nothing in this repository deploys itself to the live Firebase project.

## Security work on this branch

- Administrators sign in with Firebase Authentication. Admin Functions also require a verified email and the server-assigned `admin` custom claim.
- Students redeem their six-digit activation code through a callable Function. The server checks expiry, disabled status, device binding, and rate limits before issuing a scoped Firebase custom token.
- Student functions return only that student's record. Exam scores and history are computed and stored by the server; students cannot submit or replace the shared database document.
- App Check is enforced on all student functions. The browser initializes the reCAPTCHA v3 provider with the site key supplied for the Firebase web app.
- The page sends a `noindex` directive to search engines. This discourages search indexing but does not make a public GitHub Pages URL private; authentication and server authorization remain required.
- Firestore client rules deny all direct reads and writes. Trusted Functions use the Admin SDK and check the caller's role.
- The server still stores the platform in the legacy single Firestore document. Its 900 KB application limit and concurrent-write contention mean a physical split into content and per-student documents remains before a high-volume production rollout.

## Firebase setup for a maintainer

1. Verify the supplied reCAPTCHA v3 site key is registered for this Firebase web app and the published domain. Keep the reCAPTCHA secret key inside Google/Firebase Console; do not send or commit it. Monitor App Check metrics before production use.
2. Confirm the Firebase project is `bank-of-questions-c646f` and check the Firestore database region before selecting a Functions region. The current code uses `europe-west1`; verify this choice against the project location and expected latency.
3. Cloud Functions deployment requires the Firebase project to use the Blaze pay-as-you-go plan. Set a budget alert before enabling it. Do not deploy without reviewing the billing impact.
4. Install Firebase CLI and Functions dependencies, then run `npm install` in `functions/`.
5. Create/verify the administrator account in Firebase Authentication and verify its email.
6. From a trusted workstation authenticated with Google Application Default Credentials, assign the custom claim with:

   ```sh
   FIREBASE_PROJECT_ID=bank-of-questions-c646f node functions/scripts/grant-admin-claim.js RWVY1V82kfYl2SoulHoxjzeaYiJ2
   ```

   This script uses Firebase Admin credentials and must never be run from the website or a public CI job. It checks that the account exists and its email is verified.
7. Run `npm run check --prefix functions` and `npm run test:unit --prefix functions`. Run `npm run test:rules --prefix functions` with Java and Firebase CLI installed. Deploying Functions and rules changes live access and needs a separate production review.

## Existing platform and backups

The platform previously stored settings, questions, activation codes, and student history together in `platform/db`. Existing browser backups may contain student personal data and activation codes; keep them private and outside the public repository. The backend intentionally does not import or overwrite a backup automatically.

## Hosting

GitHub Pages serves the static `index.html`; it does not host Functions. Firebase and GitHub Pages remain separate services. Keep changes on the feature branch until the student flow, App Check key, physical data split, emulator coverage, and browser testing are complete.
