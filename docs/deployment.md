# Vercel and Railway deployment checklist

## Before deploying

- [ ] Use a managed PostgreSQL database and keep `DATABASE_URL` private.
- [ ] Decide whether department users may see and update all departments' reports. The current schema has no user-to-department assignment, so the `department` role is not scoped; add server-side department ownership checks before using it for independently managed departments.
- [ ] Choose stable HTTPS custom domains for both apps, preferably on the same registrable domain (for example, `app.example.com` and `api.example.com`). Separate `vercel.app` and `railway.app` domains are cross-site; browsers that block third-party cookies may not retain the API auth cookie.
- [ ] Create strong, unique secrets for `JWT_SECRET` and any seeded admin password. Never commit production `.env` files.
- [ ] Review the [security and upload behavior](./api.md#request-limits-and-security) against the release's actual configuration.

## Railway backend

- [ ] Create a Railway service with the repository root directory set to `backend/`.
- [ ] Attach PostgreSQL and confirm Railway provides `DATABASE_URL`.
- [ ] Configure `NODE_ENV=production`, `JWT_SECRET`, `FRONTEND_URL`, `GEMINI_API_KEY`, and Cloudinary's `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Set `GEMINI_MODEL=gemini-3.5-flash-lite` or use the backend default. Set `CLOUDINARY_FOLDER` if desired.
- [ ] Configure a valid Gemini API key for analysis. Without it the API starts, but the assistant and agent pipeline cannot run. Cloudinary credentials are required for production uploads; local disk fallback is development-only.
- [ ] Ensure the repository-level `skills/` directory is included in the Railway service bundle. If Skills are stored elsewhere, set `SKILLS_DIR` to that directory.
- [ ] Set `FRONTEND_URL` to the exact HTTPS Vercel production origin, with no path or trailing slash. The REST API and Socket.IO both use this origin for credentialed CORS.
- [ ] Keep `FRONTEND_URL` aligned with the browser's `Origin`; state-changing REST requests with a different supplied origin are rejected.
- [ ] Use Railway's assigned `PORT`; the server reads `process.env.PORT`.
- [ ] Deploy, then run `npm run migrate` from the backend service/one-off command to apply `backend/db/schema.sql`.
- [ ] To create demo data, run `npm run seed` once with `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 16 characters in the one-off process environment. The script is idempotent and does not change the password of an existing admin. Remove the seed credentials from the environment after use.
- [ ] Verify `https://<api-domain>/health` returns `{ "ok": true }`.
- [ ] Confirm database backups, log retention, and Cloudinary access/usage limits are configured.

## Vercel frontend

- [ ] Create a Vercel project with the repository root directory set to `frontend/`.
- [ ] Configure `NEXT_PUBLIC_API_URL` as the HTTPS Railway API origin (or its custom domain), without a trailing slash. This value is public, not a secret.
- [ ] Deploy and verify the PWA loads over HTTPS.
- [ ] If Vercel preview deployments need API access, remember the backend currently allows one exact `FRONTEND_URL`. Use a stable preview domain or add an explicit, reviewed origin allowlist to both Express and Socket.IO; do not use `*` with credentials.

## Production smoke checks

- [ ] Sign in and verify the browser stores/sends the `HttpOnly`, `Secure`, `SameSite=None` auth cookie. Test on browsers with third-party-cookie blocking; same-site custom domains are strongly preferred.
- [ ] Verify unauthenticated report creation, `/api/reports/mine`, status changes, and `/api/stats` are denied; confirm citizens cannot use department/admin operations.
- [ ] Submit a compressed image and verify its Cloudinary URL is stored, the Vision step completes, and no base64 image is stored in the database.
- [ ] Verify report creation/status updates reach clients as `report:new` and `report:updated`.
- [ ] Test input, image-size, login, and global rate limits in staging. The in-process limiter is not a shared quota across multiple Railway replicas; add an edge or shared-store limiter before relying on it for multi-instance abuse protection.
- [ ] Run `npm run test:pipeline` in a staging environment only; it uses configured AI and image-storage services.
