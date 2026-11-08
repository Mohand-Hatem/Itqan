# Frontend (Next.js App Router)

One app serves every host. `middleware.ts` reads the host: `admin.<root>` → super admin routes; `<slug>.<root>` → tenant routes. Tenant branding is fetched once per request and applied as CSS variables (colors) and metadata (name, favicon).

## Routes

### Public (tenant site)
| Route | Page |
|---|---|
| `/` | Landing (hero, courses if public, contact, social links) |
| `/about`, `/how-it-works` | Tenant pages |
| `/login`, `/forgot-password`, `/reset-password` | Auth |
| `/join?token=` | Register with invitation |
| `/redeem` | Register with access code |
| `/blocked` | Device / session / paused screens with request actions |

### Student (`/learn`)
| Route | Page |
|---|---|
| `/learn` | Dashboard: courses, recent lessons, upcoming exams, results, announcements |
| `/learn/courses/[courseId]/[[...itemId]]` | Tree on the side, viewer in the middle, Q&A below |
| `/learn/exams/[quizId]` | Exam intro and attempt |
| `/learn/results` | Grades and reviews |
| `/learn/notifications`, `/learn/support`, `/learn/profile`, `/learn/devices` | |
| `/learn/redeem` | Redeem a code |

### Teacher and assistant (`/manage`)
| Route | Page |
|---|---|
| `/manage` | Overview numbers, pending requests |
| `/manage/courses`, `/manage/courses/[id]` | Course list, tree editor with drag and drop and uploads |
| `/manage/question-banks`, `/manage/quizzes/[id]` | Bank editor, quiz builder, results |
| `/manage/students`, `/manage/students/[id]` | List, detail (courses, devices, sessions, grades, payments) |
| `/manage/invitations`, `/manage/codes` | Access |
| `/manage/payments` | Offline payment records |
| `/manage/requests` | Device, sign-out and general support requests |
| `/manage/announcements` | |
| `/manage/audit` | Audit log (teacher only) |
| `/manage/settings`, `/manage/assistants` | Teacher only |

### Super admin (`admin.<root>`)
| Route | Page |
|---|---|
| `/tenants`, `/tenants/[id]` | Create, usage, pause roles, suspend users, delete |
| `/audit` | Platform audit log |

## Libraries
| Need | Library |
|---|---|
| UI kit | Tailwind CSS + shadcn/ui |
| Server data | TanStack Query |
| Forms | React Hook Form + Zod (schemas from `packages/shared`) |
| Tables | TanStack Table (shadcn data table) |
| Tree drag and drop | dnd-kit |
| Charts | Recharts (shadcn charts) |
| PDF | pdfjs-dist |
| Video | native `<video>` + watermark overlay |
| i18n | next-intl |
| Push | Firebase JS SDK (messaging) + service worker |
| Errors | @sentry/nextjs |

No Zustand until a real cross-page client state appears.

## i18n and RTL
- Locales `ar` (default) and `en`. The tenant's default is used, and the user can switch.
- `<html lang dir>` set per locale. Use Tailwind logical classes (`ms-*`, `me-*`, `ps-*`, `text-start`), never `ml-*`/`left-*`.
- All strings in message files from day one, including emails and error `reason` codes.
- Arabic-friendly font with Latin fallback (choose in the UI phase).

## Real-time
- One `EventSource('/api/sse')` per tab, opened in the authenticated layout.
- Events: `notification` (refresh the bell query), `session_revoked` / `device_revoked` (go to `/blocked`), `enrollment_terminated` (refresh courses).

## Watermark
An absolutely positioned overlay on the video showing `name · email`, low opacity, moving to a random position every 20–40 s, with `pointer-events: none`. It's a deterrent only, not protection.
