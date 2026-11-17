# Dinner Pair — Smart Registration & Automated Gift Pairing System

Dinner Pair is a full-stack web application for managing dinner event registrations, attendance confirmations, and automated one-to-one gift pairing with private recipient retrieval and Google Forms integration.

## Project Folder Structure

```text
/
├── server.ts                         # Express + Vite full-stack entry point (port 3000)
├── prisma/
│   └── schema.prisma                 # Production PostgreSQL Prisma schema
├── src/
│   ├── App.tsx                       # Root view router (Register, Assignment, Details, Admin)
│   ├── index.css                     # Tailwind CSS v4 + typography & print styles
│   ├── main.tsx                      # React entry point
│   ├── types/
│   │   ├── index.ts                  # Shared frontend TypeScript contracts
│   │   └── node-sqlite.d.ts          # Node 22 built-in SQLite type definitions
│   ├── lib/
│   │   ├── api.ts                    # Typed REST client with cookie credentials
│   │   └── firebase.ts               # Firebase Auth & Google Forms OAuth in-memory token helper
│   ├── components/
│   │   ├── TopNav.tsx                # 3-zone responsive navigation header
│   │   ├── PublicRegistrationView.tsx# Mobile-first registration form & confirmation receipt
│   │   ├── PrivateAssignmentView.tsx # Verified gift assignment reveal & RSVP update
│   │   ├── DashboardCharts.tsx       # Attendance, consent, pairing & trend charts
│   │   ├── AdminGoogleFormsPanel.tsx # Google Forms creation & response sync panel
│   │   └── AdminDashboardView.tsx    # 7-section protected administrator dashboard
│   └── server/
│       ├── db.ts                     # Persistent relational SQLite DB with foreign keys & transactions
│       ├── auth.ts                   # Bcrypt + session cookies, Firebase token verification, audit logs
│       ├── validation.ts             # Input sanitization, phone normalization, CSV/XML escaping
│       ├── pairing.ts                # Cryptographic Mutual & Secret Derangement pairing engine
│       └── routes.ts                 # Public, Admin, Export, and Google Forms API routes
├── .env.example                      # Environment variable template
├── firebase-applet-config.json       # Firebase client configuration
├── index.html                        # HTML entry point & Google Fonts
└── package.json                      # Build, lint, dev, and production scripts
```

## Database Schema

Six relational tables with foreign keys, unique constraints, check constraints, and indexes:
- `events` — Event metadata, registration deadline, status (`OPEN`, `CLOSED`, `COMPLETED`), Google Form link.
- `participants` — Unique `registration_reference` (`DP-2026-XXXX`), normalized unique `(event_id, phone_number)`, attendance status, gift consent, hashed personal access & OTP codes.
- `pairing_batches` — Batch metadata (`MUTUAL` or `SECRET`), eligibility counts, `DRAFT` / `LOCKED` status.
- `pairings` — Permanent giver-to-recipient assignments with `CHECK (giver_participant_id != recipient_participant_id)` and `UNIQUE` giver/recipient constraints per event.
- `administrators` & `admin_sessions` — Salted `bcryptjs` credentials, RBAC roles (`SUPER_ADMIN`, `ADMIN`), HTTP-only session hashes.
- `audit_logs` — Immutable trail of administrator logins, participant edits, pairing generations, locks, reassignments, exports, and Google Form syncs.

## REST API Documentation

### Public Endpoints
- `GET /api/public/event` — Returns active dinner event details and aggregate attendance summary (no PII).
- `POST /api/public/register` — Validates inputs, prevents duplicate phone numbers, generates unique reference and 6-digit personal access code.
- `POST /api/public/assignment/request-otp` — Issues a 10-minute 6-digit OTP for verified `(registrationReference, phoneNumber)`.
- `POST /api/public/assignment/verify` — Verifies access code/OTP and returns ONLY the authenticated participant's locked gift recipient.
- `PATCH /api/public/attendance` — Allows verified participants to update attendance/consent when permitted.

### Protected Administrator Endpoints (Requires Admin Session Cookie)
- `POST /api/admin/login` & `POST /api/admin/google-login` & `POST /api/admin/logout` & `GET /api/admin/me`
- `GET /api/admin/overview` — Dashboard KPIs, withdrawal alerts, and daily registration trend.
- `GET/POST/PATCH/DELETE /api/admin/participants` — Search, filter, create, edit, and remove registrations.
- `POST /api/admin/participants/:id/issue-otp` — Generates a 6-digit access code for WhatsApp/SMS dispatch.
- `GET /api/admin/pairings` — Previews Mutual & Secret pairing plans, batches, active pairings, and unpaired queue.
- `POST /api/admin/pairings/generate` — Runs Mutual Pairing or Secret Derangement without touching locked pairs.
- `POST /api/admin/pairings/:batchId/lock` — Permanently locks a draft batch for participant retrieval.
- `POST /api/admin/pairings/reassign` — Transactional unlink, recipient swap, or manual pair.
- `GET /api/admin/export/participants?format=csv|xls` & `/api/admin/export/pairings?format=csv|xls`
- `PUT /api/admin/event` — Updates event schedule, venue, deadline, and status.
- `POST /api/admin/google-forms/create` & `POST /api/admin/google-forms/sync` — Creates a Dinner Pair Google Form and imports responses.
- `GET /api/admin/settings`, `POST/DELETE /api/admin/administrators`, `POST /api/admin/change-password`

## Installation & Running Locally

```bash
npm install
cp .env.example .env
npm run dev
```
Default bootstrap admin username: `admin` (password in `ADMIN_BOOTSTRAP_PASSWORD`, default `DinnerPair2026!`). Change immediately in **Admin Settings**.

## Production Build & Deployment

1. **Build**: `npm run build` (bundles React frontend into `dist/` and Express server into `server.js`).
2. **Start**: `npm start` (runs `node server.js` on `PORT`, default `3000`).
3. **External PostgreSQL (Supabase / Neon)**: Configure `DATABASE_URL` in your hosting environment and apply `prisma/schema.prisma` using `npx prisma migrate deploy`.

## Testing Workflow

1. Open `/` and register multiple guests (confirming attendance + gift exchange consent).
2. Open `/#admin`, sign in with credentials or Google Sign-In, or click **Load 12 Sample Guests** in Overview.
3. Open **Gift Pairings**, preview **Mutual Pairing** vs **Secret Gift Exchange**, click **Generate Draft Pairings**, inspect assignments, and click **Confirm & Lock Batch**.
4. Open `/#assignment`, enter a guest's Registration Reference, Telephone Number, and 6-digit Access Code (or issue a code from Admin > Registrations > Code) to verify private gift assignment retrieval.
