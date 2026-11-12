# Security review and migration status

## Work prepared on this feature branch

- Removed the default administrator password from the browser seed and settings UI.
- Added Firebase Authentication email/password sign-in for administrators.
- Administrator Functions require both a verified email and the server-side `admin: true` custom claim. The UID is granted by a trusted Firebase Admin SDK script, never by browser code.
- Added Admin SDK callable functions for reading and saving the legacy platform document. Inputs are structurally checked and limited to 900 KB.
- Added Firestore rules that deny all client reads and writes. Cloud Functions use the Admin SDK, which bypasses Firestore rules; every callable therefore checks the administrator claim.
- The static student workflow continues to use browser-local data. It does not receive privileged cloud access.

## Not complete yet

- Student activation, question delivery, answer submission, device binding, student profiles, and history have not yet been migrated to server-validated operations. Do not deploy this as a completed platform update.
- The legacy shared JSON document still combines questions, answer keys, activation codes, and student records. It is accessible only to an authorized administrator through the new Functions, but it must be split before student cloud synchronization is restored.
- The existing Firestore deny-all rules are expected to block direct client synchronization. This branch keeps that protection in place.
- The custom-claim bootstrap, Functions, Rules, and browser sign-in have not been deployed to Firebase. Production behavior is unverified. App Check is not enforced yet.
- Firebase Emulator security tests and browser end-to-end tests are still required.

## Safe rollout sequence

1. Back up the existing Firestore document and any browser-only data. Do not put backups in the public repository.
2. Confirm Firestore region and Functions billing/region settings.
3. Run emulator tests, including unauthenticated, ordinary-user, unverified-email, and admin cases.
4. Assign the admin claim using the trusted bootstrap script and verified Firebase Auth account.
5. Deploy Functions and deny-by-default rules only after reviewing the tested build. Expect the legacy client to have no cloud access until the remaining student migration ships.
6. Migrate student flows to narrow server operations and separated collections, then retest before restoring student cloud access.

Never use `allow read, write: if true`, and never reintroduce client-side whole-database writes.

