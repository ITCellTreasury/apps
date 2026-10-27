TREASURY CONTACTS PWA — GITHUB PAGES

Files:
- index.html: your existing page with only PWA installation additions
- manifest.json: app name, display mode and icon declarations
- sw.js: service worker for app-shell caching
- icons/icon-192.png and icons/icon-512.png: install icons

DEPLOY:
1. Create/open a GitHub repository.
2. Upload index.html, manifest.json, sw.js, and the icons folder to the repository root.
3. In GitHub, open Settings > Pages.
4. Select Deploy from a branch, choose your publishing branch (usually main) and folder / (root), then Save.
5. Open the published HTTPS GitHub Pages URL on your mobile device.
6. If testing an existing deployment, hard-refresh or clear the site's cache after replacing files.

NOTES:
- The first-visit prompt is a custom page dialog. The user must tap Install and approve any browser-native prompt.
- If native install prompting is unavailable, the Install button displays browser-specific manual instructions.
- The prompt is shown again on later visits until the page is running in standalone/installed mode.
- Google Sheets contact data still requires an internet connection; service-worker caching does not make the live sheet data available offline.
- Ensure the Google Sheets API key is restricted to the required APIs and domains where possible.
