# Bank of Questions

The site is currently hosted as a static GitHub Pages application. Firebase backend files are being prepared on the feature branch; nothing in this repository deploys itself to the live Firebase project.

## Current security work

- Administrator sign-in uses Firebase Authentication and requires a verified email plus a server-assigned `admin` custom claim.
- Only trusted Cloud Functions can read or write the legacy `platform/db` document. Firestore client rules deny all direct client access.
- Student code login and student record synchronization are still local to the browser. Do not treat this branch as a complete multi-device student migration or deploy it as a finished platform update yet. App Check is not enforced yet; configure the provider and test it before enabling enforcement.
- Admin data remains in the legacy single-document format during this transition. The server rejects malformed payloads and documents above 900 KB. A later migration must split public question content from private student records.

## Firebase setup for a maintainer

1. Confirm the Firebase project is `bank-of-questions-c646f` and check the Firestore database region before selecting a Functions region. The current code uses `europe-west1`; change `FUNCTION_REGION` only after checking the project location and expected latency.
2. Cloud Functions deployment requires the Firebase project to use the Blaze pay-as-you-go plan. Set a budget alert before enabling it. Do not deploy without reviewing the billing impact.
3. Install Firebase CLI and Functions dependencies, then run `npm install` in `functions/`.
4. Create/verify the administrator account in Firebase Authentication and verify its email.
5. From a trusted workstation authenticated with Google Application Default Credentials, assign the custom claim with:

   ```sh
   FIREBASE_PROJECT_ID=bank-of-questions-c646f node functions/scripts/grant-admin-claim.js RWVY1V82kfYl2SoulHoxjzeaYiJ2
   ```

   This script uses Firebase Admin credentials and must never be run from the website or a public CI job. It checks that the account exists and its email is verified.
6. Run local checks and Firebase Emulator tests before deployment. Deploying Functions and rules changes live access and requires a separate production review.

## Existing platform and backups

The platform previously stored settings, questions, activation codes, and student history together in `platform/db`. Existing browser backups may contain student personal data and activation codes; keep them private and outside the public repository. The backend intentionally does not import or overwrite a backup automatically.

## GitHub Pages

GitHub Pages serves the static `index.html`; it does not host the Functions backend. The Firebase project and GitHub Pages deployment are separate. Keep all changes on the feature branch until the student migration and full workflow testing are complete.
