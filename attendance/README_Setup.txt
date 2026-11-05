# Attendance Register — setup guide

## Included files
- `User_Enrollment.html` — administrator user registration, management, per-user attendance report and CSV export.
- `Mark_Attendance.html` — staff ID lookup and GPS-verified attendance.
- `Configuration.html` — administrator API URL and office geofence settings.
- `Code.gs` — Google Apps Script backend.

All three HTML files are standalone. Each uses the API URL saved in that browser/device by the Configuration page. The files need internet access to call Apps Script. GPS generally requires HTTPS hosting; local `file://` use may not expose geolocation on many browsers. You can keep the HTML files locally but serve them from a secure HTTPS origin (for example, an internal HTTPS web server) for reliable GPS access. Do not assume a `file://` page can use GPS.

## 1. Create the spreadsheet backend
1. Create a new Google Spreadsheet.
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs`.
4. In Project Settings, set the script time zone to your local time zone (for example `Asia/Kolkata`).
5. Save, select `setupAttendanceSystem`, and Run. Authorize the script.
6. Return to the spreadsheet. It creates `Users`, `Attendance`, and `Configuration` tabs.
7. The initial configuration has placeholder coordinates for Thiruvananthapuram. Set the actual office coordinates and radius in the Configuration HTML before taking attendance.

## 2. Deploy the API
1. In Apps Script choose **Deploy → New deployment → Web app**.
2. Execute as: **Me**.
3. Who has access: **Anyone** (the API must be reachable by the standalone HTML pages).
4. Deploy and authorize. Copy the URL ending in `/exec` (not `/dev`).
5. Keep the Apps Script project owned and controlled by the responsible administrator. Do not publish the spreadsheet itself.

## 3. Connect the HTML pages
1. Open `Configuration.html` in a browser that can access the API.
2. Sign in using initial credentials: username `admin`, password `ChangeMe123!`.
3. Paste the deployed `/exec` URL and click **Save API URL on this device**.
4. Click **Test connection**.
5. Set office name, latitude, longitude, permitted radius (10 metres by default), and maximum accepted GPS accuracy. Save.
6. Immediately change the default admin password from the User Enrollment page's **Change Password** tab.

The API URL is stored in local browser storage separately on each device/browser. Set it once on each device. Admin login is shared across the three pages through the session token only within that browser tab/session; sign in separately if asked.

## 4. Usage
- Admin opens `User_Enrollment.html`, signs in, and registers users.
- Staff opens `Mark_Attendance.html`, enters their Attendance ID, fetches their name/office, then marks attendance.
- Every accepted mark is stored as an immutable row. The earliest mark for a user/date is `Opening`, the latest is `Closing`, and marks between them are `Intermediate`. With only one mark that day, it is `Opening` until another mark is made.
- Reports can be filtered by Attendance ID and date range, and exported to CSV.

## Security and operational notes
- Admin endpoints require a short-lived token. The initial password is a bootstrap credential; change it before operational use.
- Because the backend is deployed to execute as its owner and the HTML files are standalone, the web app is publicly reachable. Public endpoints are limited to user lookup and attendance submission. Anyone who knows a valid Attendance ID can attempt a lookup or submission; use non-obvious IDs and protect the pages operationally.
- JSONP is used to support local standalone HTML without browser CORS preflight. It is a compatibility trade-off: JSONP is a GET transport and request parameters may appear in browser/network logs. Do not put secrets or sensitive personal data in request parameters beyond what is necessary. For a hardened production deployment, host the front end on HTTPS and replace JSONP with a same-origin authenticated API.
- Browser GPS is not tamper-proof. A user with a modified device/browser may spoof location. GPS accuracy is variable, especially indoors. A 10 m geofence can reject genuine users if their device cannot obtain that precision.
- The first/last marking logic is chronological by server-recorded time. All marks are retained for audit.
- Apps Script and Google Sheets have quotas and practical concurrency limits. Back up the spreadsheet regularly.
- This system does not calculate payable working hours, breaks, leave, overtime, or attendance corrections. Those can be added as separate audited features.
