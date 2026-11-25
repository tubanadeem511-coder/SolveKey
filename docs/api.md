# SolveKey API

Base URL: `http://localhost:4000` in local development; use the deployed Railway API origin in production. JSON API requests use cookie authentication where noted. Browser clients must send credentials (`credentials: "include"`).

## Authentication

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a citizen account. Body: `{ "name": string, "email": string, "password": string }`. |
| `POST` | `/api/auth/login` | Public | Authenticate. Body: `{ "email": string, "password": string }`; sets the auth cookie. |
| `POST` | `/api/auth/logout` | Public | Clear the auth cookie. |
| `GET` | `/api/auth/session` | Public | Return the current profile when a valid auth cookie exists, otherwise `{ "user": null }`. |
| `GET` | `/api/auth/me` | Authenticated | Return the current user's profile, points, and level. |

## Reports

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/reports` | Public | List up to 200 non-duplicate reports, newest first. Optional `department_id`, canonical category, status, and text query filters. Includes `department_id` and `department_name`. |
| `POST` | `/api/reports` | Authenticated | Create a report and start the agent pipeline. Body: `{ "lat": number, "lng": number, "address"?: string, "image_base64": string, "media_type": "image/jpeg" \| "image/png" \| "image/webp" }`. Returns the created report; analysis continues asynchronously. |
| `GET` | `/api/reports/mine` | Authenticated | List the signed-in user's reports. |
| `GET` | `/api/reports/track/:reportNumber` | Public | Look up a report by its Report Number and return public issue details and current status; no personal account data is returned. |
| `GET` | `/api/reports/:id/trace` | Public | Return the report's agent log timeline. |
| `POST` | `/api/reports/:id/upvote` | Authenticated | Upvote a report. |
| `PATCH` | `/api/reports/:id/status` | Department or admin | Set status to `reported`, `in_progress`, or `resolved`. Body: `{ "status": string }`. Resolution awards the reporter 20 points once. |
| `GET` | `/api/reports/leaderboard/top` | Public | Return the top 20 users by points. |

Report categories are classified by the Vision Agent and assigned through the department category mappings in the database:

| Department | Categories |
| --- | --- |
| K-Electric | Street Light, Electricity Issue |
| Karachi Water Board | Water Leakage, Water Supply, Sewerage / Drainage |
| KMC Roads | Pothole, Broken Road, Damaged Footpath |
| KMC Sanitation | Garbage, Overflowing Dustbin, Waste Collection, Dirty Street |

## Statistics

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/stats` | Department or admin | Return `open`, `resolved`, `average_severity`, `by_category`, and `departments`. Optional `department_id` filters report aggregates. Open excludes resolved and duplicate reports; all aggregates exclude duplicate rows. |

Department accounts are not currently associated with a specific department in the user schema. Consequently, the department role can select any department (or all departments) and update any report; add server-side user-to-department scoping before using the role for separately managed departments.

New Report Numbers use `SK-YYYY-NNNNNN` (for example, `SK-2026-000123`); the numeric portion is based on the unique report ID and may exceed six digits. Existing UUID-shaped Report Numbers remain valid for tracking.

## Health

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Liveness response: `{ "ok": true }`. |

## Realtime events

Connect to the backend Socket.IO origin using the credentialed CORS configuration.

- `report:new`: `{ "id": number, "lat": number, "lng": number }` when a report is created.
- `report:updated`: includes `id` and whichever pipeline/status fields changed, such as `status`, `category`, `severity`, or `duplicate_of`.

Most errors are JSON responses with an `error` field. Authentication failures return `401`; role failures return `403`; invalid report inputs return `400`; missing report status targets return `404`.

## Request limits and security

- Express allows one configured `FRONTEND_URL` origin for credentialed REST and Socket.IO CORS. Do not replace it with a wildcard.
- State-changing REST methods reject a supplied `Origin` that differs from `FRONTEND_URL`. Browser POST/PATCH requests include their origin; non-browser clients that omit the header remain supported.
- In production, the auth cookie is `HttpOnly`, `Secure`, and `SameSite=None`; development uses `SameSite=Lax` without `Secure`. Browser clients must use HTTPS and include credentials in production.
- The global in-process rate limit is 120 requests per minute per client IP. Authentication routes have an additional 30 requests per 15 minutes.
- The JSON request body limit is 10 MB. Report creation validates coordinate ranges, image media type, and caps the base64 field at 8,000,000 characters; the frontend compresses its images to under 1.5 MB before submission.
- Registration validates email, name, and password inputs. Status changes validate the numeric report id and permitted status values.
