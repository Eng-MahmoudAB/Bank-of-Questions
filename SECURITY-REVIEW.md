# Security review and required migration

## Current application risks (confirmed from index.html)

- The administrator password is stored in the client-side seed/settings object and checked in browser JavaScript. Anyone who can inspect the published page can inspect or bypass this check. This is not secure administrator authentication.
- The browser writes the entire platform database document to Firestore using `fs.set({d: JSON.stringify(db)})`. Client-side validation cannot protect student records or admin data from a modified browser.
- Student access uses six-digit activation codes stored in the same client-side database. These codes are not a substitute for authenticated server-side authorization.
- Firebase web configuration is embedded in the page. That configuration is expected to be public; Firestore Security Rules and trusted server-side authorization must protect the data.
- The repository currently has no `firestore.rules`, `firebase.json`, or Cloud Functions project files on the feature branch.

## Important current state

The Firestore rules were manually changed in Firebase Console to deny all reads and writes. Keep them closed until a secure replacement is deployed. This means cloud synchronization is currently expected to fail; do not loosen the rules to `allow read, write: if true`.

## Required secure architecture before restoring cloud access

1. Enable Firebase Authentication and require sign-in for administrators.
2. Assign the administrator role only from a trusted environment (Firebase Admin SDK / Cloud Functions custom claims). Never let the browser assign its own role or rely only on a UID embedded in JavaScript.
3. Move privileged database operations behind authenticated Cloud Functions or another trusted backend. Validate every request and the caller's role on the server.
4. Separate public/student-readable content from private student records and administrator data. Do not let student browsers replace the entire shared database document.
5. Use Firestore rules that deny by default and permit only the exact authenticated operations needed by each role.
6. Move media uploads to Firebase Storage with authenticated upload rules, size/type limits, and safe public delivery.
7. Add audit logs, rate limits, backups, and recovery tests.
8. Test student and administrator workflows with the Firebase Emulator Suite before publishing any rules.

## Do not deploy this feature branch as a security fix

The UI updates in this branch do not complete the backend security migration. In particular, the old password check and whole-document Firestore write must be replaced before the platform can be described as secure. The deny-all Firestore rules should remain in place until that migration is implemented and tested.
