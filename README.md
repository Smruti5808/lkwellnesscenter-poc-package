# LK Wellness — Doctor–Patient App (POC)

Developer and AI-agent handoff. Last updated **2 October 2026**.

A working proof of concept of the components in [`docs/Doctor_Patient_App_Components.docx`](docs/Doctor_Patient_App_Components.docx): a **patient portal**, a **doctor portal**, and an **admin area**, built as one Next.js app. In local Node mode, all data lives in one JSON file. Cloudflare hosting retains that JSON structure and private documents in a persistent SQLite Durable Object on Workers Free, without R2 or payment activation. Every record type supports create, read, update, and delete through the same generic API. All data is dummy data.

**Status:** feature-complete for the scope below. Typecheck and a warning-free production build pass, along with 33 API tests, four Cloudflare storage/import tests, 15 existing browser tests, and five browser checks against the complete Cloudflare Worker.

**Documents** (in [`docs/`](docs/)):
- [`Doctor_Patient_App_Components.docx`](docs/Doctor_Patient_App_Components.docx): the components this POC implements.
- [`LK_Wellness_POC_Demo_Guide.docx`](docs/LK_Wellness_POC_Demo_Guide.docx): a walkthrough of every main screen, a 15-minute demo script, and coverage against the components document.
- [`LK_Wellness_POC_Demo.pptx`](docs/LK_Wellness_POC_Demo.pptx): a 21-slide demo deck with speaker notes.

The demo guide and deck were updated on 2 October 2026 to include the shared health-record timeline, prescription uploads, and the latest test counts (33 API, 15 browser).

## 1. Run it

Requires Node.js 22 or newer. Run from this `codebase` folder (PowerShell shown; `npm` works the same in other shells):

```powershell
npm.cmd ci                      # first time only
npm.cmd run data:seed           # creates data/app-data.json with dummy data if it doesn't exist
npm.cmd run build
npm.cmd run start               # http://127.0.0.1:3000
```

For development, use `npm.cmd run dev` instead of build + start.

**Sign in:** use any account's email or phone with the PIN **`1234`**. The sign-in page lists every demo account; tap one to fill it in.

| Account | Role | Notes |
|---|---|---|
| `ananya@example.com` | Patient | Rich history; has a dependent son (Aarav); appointment today at 10:30; a further booking request |
| `vikram@example.com` | Patient | Diabetes; checked in for today's 10:00 visit; pending HbA1c result |
| `meera@example.com` | Patient | New patient with a booking request awaiting the doctor |
| `padmanaban@example.com` | Doctor | **Dr. Padmanaban, Integrative Expert Practitioner** — the clinic's only doctor; today's queue, requests, alerts, messages |
| `admin@example.com` | Admin | Doctor verification, users, analytics |

The dummy data has **one doctor**. His registration and licence numbers (`DEMO-REG-0001`, `DEMO-LIC-0001`), qualifications, and clinic address are placeholders: update them under **Profile** after signing in as the doctor, or in `demo/seed-data.ts` so a reset keeps them. Doctor registration, admin verification, and referrals still work if more doctors join later, but the dummy data has nobody to refer to.

Dummy-data dates are relative to when the data was seeded, so "today" always has a clinic queue. To restore the dummy data (this also signs everyone out and deletes uploads):

```powershell
npm.cmd run data:reset
npm.cmd run data:check          # validates the file and prints record counts
```

## 2. What is implemented (against the document)

The document's annotations are applied:
- PIN 1234 login for both portals.
- Consultations are **always face-to-face**.
- Payments are **to be decided**.

Features marked *simulated* behave correctly inside the app but do not connect to real external services.

### Patient portal

| Document item | Implementation |
|---|---|
| Onboarding: registration and login | Registration (`/register`) and sign-in by email or phone + PIN 1234. *OTP, email verification, and biometrics are not implemented.* |
| Consent | Terms, remote follow-up, and data-sharing consent; captured at registration, editable under Privacy |
| Family and dependent profiles | Add, edit, and delete dependents; a switcher sets whose records are shown |
| Health profile | Demographics and contact; medical history (past, chronic, surgery, hospitalization, family); allergies (drug, food, environmental); medications; vitals (height, weight, BP, pulse, glucose, SpO₂; source "device" is *simulated*); document upload and view (PDF, PNG, JPEG ≤ 5 MB) |
| Finding and booking | Doctor search with filters (specialty, language, fee, availability, rating); slot booking from real schedules; reschedule; cancel; appointment types are in person |
| Reminders | In-app notification centre; each notification records the channels it would use (push, SMS, email — *simulated*) |
| Consultation | Pre-consultation intake (chief complaint, symptoms, duration, questions); **check-in on arrival** replaces the video "waiting room"; emergency disclaimer with a call-112 link. *Video, audio, and chat calls are omitted because consultations are face-to-face.* |
| After the visit | **Visits & results** opens on an **All records** timeline (modelled on a personal health record): visits, clinic e-prescriptions, uploaded prescriptions, lab and imaging results, and reports, grouped by month with counts, type filters, and search. **Upload prescription** (Prescriptions tab or timeline) stores a PDF or photo of any prescription with date, prescriber, and notes; each seed patient has one fictional sample. E-prescriptions (view, print or save as PDF); lab and imaging results with out-of-range flags; follow-up booking; medication adherence (7-day tracker); refill reminders; visit history with care summaries; feedback and ratings |
| Payments | *To be decided.* Fees are shown; the app notes that payment is collected at the clinic |
| Privacy controls | Block specific doctors from the record; access log of who viewed or changed records; download all data (JSON); delete account and all data |

### Doctor portal

| Document item | Implementation |
|---|---|
| Onboarding and verification | Registration with council number, licence, specialty, qualifications; profile stays **pending** until an admin verifies it; editable profile (bio, languages, clinic, experience) |
| Schedule management | Weekly working hours with breaks and buffer time; leave; appointment types and fees; calendar with accept, reject, reschedule, cancel; today's queue with check-in and no-show handling |
| Patient record view | **Health records** tab: the same timeline the patient sees, including prescriptions the patient uploaded (the doctor is notified of uploads before a visit). Single-screen summary: demographics, history, allergies, medications, vitals, intake answers, previous consultation notes, prescriptions, results, and uploaded reports; health profile is also editable |
| Consultation workspace | SOAP notes with templates, quick text, and voice dictation (browser speech recognition, where supported); ICD-10 coding from a built-in subset; follow-up scheduling; care summary generated from the notes (template-based, no AI) |
| Prescriptions and orders | E-prescriptions with the required fields and a *simulated* digital signature (SHA-256 hash; not a legal e-signature); built-in demo drug list with dose and frequency defaults; safety checks for interactions, allergy conflicts, duplicate therapy, and dose limits (signing requires acknowledging warnings); favourite prescriptions; lab and imaging orders whose results return to the record. *Pharmacy routing is not implemented (it was optional).* |
| Continuity of care | Secure messaging with patients; referrals (sent and received; accepting grants record access); care summaries; alerts for abnormal results |
| Earnings and performance | Earnings from completed visits, consultation count, average duration, no-shows, ratings and feedback. *Payouts and invoices are to be decided with payments.* |

### Shared and backend

| Document item | Implementation |
|---|---|
| Security | Role-based access on every request; audit log; HTTP-only session cookies; 30-minute idle and 8-hour absolute timeouts; sign-in rate limiting; same-origin check on all writes. **Not done:** encryption at rest (the JSON file is plain text), and HTTPS is only for hosted use |
| Compliance (DPDP, HIPAA, GDPR, ABDM) | **Not implemented.** Consent capture, access logs, export, and deletion are present as building blocks only |
| Interoperability (FHIR, ICD, SNOMED, LOINC) | ICD-10 codes only (built-in subset). FHIR, SNOMED CT, and LOINC are **not implemented** |
| Notifications engine | In-app notifications with *simulated* channels |
| Admin panel | Doctor verification; user management (edit, activate or deactivate, delete, add admins); analytics. *Disputes depend on payments and are not implemented* |

## 3. Architecture

```text
codebase/
  src/shared/       schemas.ts (all record types + zod validation), reference.ts (drugs, ICD-10, templates), time.ts (IST helpers)
  src/server/       store.ts      JSON file store: lock → read → change → validate → atomic replace
                    crud.ts       generic list / read / create / update / delete
                    collections.ts per-collection access rules and behaviour (the "rules table")
                    access.ts     who may see which patient
                    auth.ts       PIN sign-in, registration, sessions
                    scheduling.ts slots from hours, breaks, buffers, leave, and existing bookings
                    clinical.ts   safety checks, signatures, care summaries, record summary, privacy delete, analytics
                    api.ts        HTTP routing for /api/v1
  src/ui/           api.ts (fetch + useData), components.tsx, crud.tsx (generic form + CrudList), shell.tsx (layout, nav, session)
  src/features/     auth, patient-health, patient-care, records (health-record timeline + uploaded prescriptions), doctor, consult, admin, shared, portals (URL → screen)
  src/app/          Next.js routes: /login, /register, /patient/*, /doctor/*, /admin/*, /api/v1/*
  demo/             seed-data.ts (dummy data), two seed PDF reports, and four fictional sample prescriptions (one per patient)
  scripts/          data.ts (seed / reset / check), register-ts.cjs (TypeScript loader for scripts and tests)
  tests/            api.test.ts (node:test, in-process), e2e/ (Playwright)
  data/             app-data.json, uploads/, reset.log — runtime data, not committed
```

### Data: one JSON file

`data/app-data.json` holds 25 collections: users, patients, consents, conditions, allergies, medications, doseLogs, vitals, documents, doctors, appointmentTypes, schedules, leaves, appointments, consultations, prescriptions, favorites, orders, messages, referrals, feedback, notifications, accessBlocks, sessions, and audit. Dummy-data ids are readable (`pat-ananya`, `doc-padmanaban`, …); new records get UUIDs. Uploaded files are stored in `data/uploads/`; seed PDFs stay in `demo/documents/`.

Each request runs as one transaction: take a file lock (`proper-lockfile`), read and validate the file, apply the change, validate again, then write to a temporary file and rename it over the original. If anything fails, nothing is written. Tests cover concurrent writes, injected write failures, and recovery from a corrupt file.

The file is human-readable and can be edited while the app is stopped. Keep ids unique, then run `npm.cmd run data:check`.

### API

All endpoints are under `/api/v1`. Responses are `{ data }` or `{ error: { code, message, fieldErrors } }`.

- **Generic CRUD for every collection:** `GET /c/{collection}?field=value`, `POST /c/{collection}`, `GET|PATCH|DELETE /c/{collection}/{id}`. In a PATCH, only the fields sent change; `null` clears an optional field. Unknown or server-owned fields are rejected.
- **Feature endpoints:**
  - Auth: `auth/login`, `auth/register/{patient|doctor}`, `auth/session`, `auth/demo-accounts`
  - Booking: `directory`, `doctors/{id}/slots`
  - Records: `my/patients`, `patients/{id}/summary`, `documents/upload`, `documents/{id}/file`
  - Prescribing: `prescriptions/check`, `prescriptions/{id}/sign`, `consultations/{id}/care-summary`
  - Privacy: `privacy/export`, `privacy/delete-account`
  - Other: `doctor/performance`, `notifications/read-all`, `admin/analytics`, `admin/doctors/{id}/verification`

**Access rules** (in `access.ts` and `collections.ts`):
- **Patients** manage their own records and their dependents' records.
- **Doctors** must be verified and must have a care relationship with the patient (an appointment, a referral, or their own consultation). They lose access if the patient blocks them.
- **Admins** never see clinical records.

Doctors edit only their own schedules, prescriptions, and notes. Patients see consultations only once finalized and prescriptions only once signed. Editing a signed prescription removes its signature.

**To add a new record type:**
1. Add the schema and type in `schemas.ts`.
2. Add the collection to `Data` and `COLLECTIONS`.
3. Add a rule in `collections.ts`.
4. Add dummy rows in `seed-data.ts`.
5. Show it in the UI with `CrudList`.

## 4. Tests

```powershell
npm.cmd test                          # 33 API tests, each file in its own temporary data folder (~5 s)
npm.cmd run test:e2e                  # 15 Playwright tests on a dev server, port 3200, data in tmp/e2e-data (~1.5 min)
$env:E2E_SERVER='prod'; npm.cmd run test:e2e   # same against the production build (run build first)
```

- **API tests** cover sign-in, rate limiting, timeouts, and deactivation; registration; access isolation (patient, dependent, doctor relationship, blocks, pending doctors, admin); generic CRUD semantics; slot validation and double booking; leave; appointment status rules; prescription signing with safety acknowledgement; care summaries; abnormal-result alerts; referrals; messaging rules; privacy export and delete; admin limits; document access; performance totals; atomic writes; concurrency; and corrupt-file recovery.
- **Browser tests** open every page for each role at 1280 and 390 px (no errors, no horizontal scroll). They also run the main journeys: booking and acceptance; a full consultation with safety warning, signing, order, and finalization; health-profile CRUD with upload; privacy block, export, and deletion; admin verification; registration; and messaging.

Only one `next dev` can run per folder. Stop your own dev server before `test:e2e`, or use `E2E_SERVER=prod`. The tests never touch `data/`.

## 5. Known limits and next steps

- **Payments** (fees, invoices, refunds, payouts, disputes) are to be decided.
- External services are simulated or absent: OTP/SMS/email/push delivery, biometrics, device integrations, pharmacy routing, and video calls (not needed because consultations are face-to-face).
- Compliance (DPDP, HIPAA, GDPR, ABDM), encryption at rest, and FHIR, SNOMED, and LOINC are not implemented. The drug list, interaction rules, and ICD-10 subset are small demo datasets, **not clinical guidance**.
- JSON storage is meant for one server on a local disk; each request reads the whole file. Move to a database before real use or multiple servers.
- The PIN `1234` is shared by every account. Change the sign-in method before exposing the app to anyone outside the demo.
- Voice dictation depends on the browser's speech recognition (Chrome and Edge); other browsers show a message and quick text still works.
- `AGENTS.md` and `CLAUDE.md` are written by Next.js 16 (`next dev`). They point coding agents to the bundled Next.js docs in `node_modules/next/dist/docs/`.

## Cloudflare hosting

See [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) for the free Worker deployment, private demo bootstrap, local preview, and Cloudflare runtime tests. The hosted demo uses the same records and workflows; local Node commands still use the JSON file. Use [docs/DEPLOY-COMMANDS.md](docs/DEPLOY-COMMANDS.md) for later updates.
