# Bank of Questions — GitHub Pages

1. Create a new repository on GitHub.
2. Upload `index.html` to the repository root.
3. Open Settings → Pages.
4. Select Deploy from a branch, branch `main`, folder `/(root)`, then Save.
5. Wait for GitHub Pages to publish the site.

## Admin notes
- The public demo activation code `123456` has been removed from the interface and seed data. Existing locally stored copies of that demo code are filtered out on load.
- Students enter their six-digit activation code and can use **طلب تغيير الجهاز** to submit a device-change request.
- The admin sees the request under **الطلبات** with type **تغيير الجهاز**, reviews it, and approves or rejects it. Approval clears the old device binding for that activation code.
- Questions and student records remain in the current local-storage/Firebase configuration. GitHub Pages itself is static hosting and does not provide a secure database or backend.
- Keep real student data and private activation codes out of a public repository.
