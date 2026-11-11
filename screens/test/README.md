# screens/test: visual direction sketches

Plain HTML, CSS and JS. No build step. Open `index.html` in a browser.

These are design explorations, not production pages. Once the owner approves a direction, it goes into `docs/11-design.md` at the design gate (step 3.1).

## Source of truth

The images in `references/` set the direction:

| Reference | What we took |
|---|---|
| `08-shop-ui-full`, `01-shop-ui-angle` | Layout: big rounded yellow panels, cream page, paper cards, round icon bubbles in a services strip, small green arrow buttons, the swoosh under a headline word |
| `02`, `03`, `04` ink line-art | Illustration: black ink lines, flat yellow sweater, curly black hair, small red and blue accents, dashed connectors, thought bubbles, checklist stairs and flag |
| `05` flat tutor | The teacher's white sleeve in "How it works" step 1 |
| `06`, `07` graduation cap | The cap in "How it works" step 4 |

## Files

### Student Portal (`/learn`)
| File | Screen | Preview states (bottom bar) |
|---|---|---|
| `ahmd-student-dashboard.html` | Student Dashboard (`/learn`) | normal, exam live alert, urgent announcement |
| `ahmd-course-viewer.html` | Course Player & Notes (`/learn/courses/...`) | lecture notes, PDF attachments, Q&A |
| `ahmd-exam-taking.html` | Live Exam Interface (`/learn/exams/...`) | normal, warning timer, submit modal |
| `ahmd-student-results.html` | Exam Results & Model Answer Review (`/learn/results`) | all questions, mistakes only, correct |
| `ahmd-student-devices.html` | Student Authorized Device (`/learn/devices`) | normal, transfer pending |

### Teacher & Staff Portal (`/manage`)
| File | Screen | Preview states (bottom bar) |
|---|---|---|
| `ahmd-teacher-dashboard.html` | Teacher Overview (`/manage`) | normal, requests queue |
| `ahmd-course-editor.html` | Course Hierarchy Editor (`/manage/courses/...`) | tree view, upload modal with progress |
| `ahmd-quiz-builder.html` | Quiz Builder & Question Banks (`/manage/quizzes/...`) | normal, question editor, anti-cheat rules |
| `ahmd-requests-management.html` | Device & Sign-out Request Approvals (`/manage/requests`) | pending requests, 1-click approve |

### Platform Super Admin & Security
| File | Screen | Preview states (bottom bar) |
|---|---|---|
| `ahmd-admin-tenants.html` | Super Admin Tenants Directory (`admin.<root>/tenants`) | tenants directory, new tenant modal |
| `ahmd-blocked.html` | Security Blocked Screen (`/blocked`) | device limit, session active, account paused |
| `ahmd-error-404.html` | 404 & 500 Error Screen | 404 not found, 500 server error |

### Public & Authentication
| File | Screen | Preview states (bottom bar) |
|---|---|---|
| `hero.html` | Teacher site hero + services strip | n/a |
| `login.html` | Log in | normal, wrong password, device limit, session conflict, success |
| `signup.html` | Register with access code (`/redeem`) | normal, used code, email sent |
| `ahmd-join.html` | Register with teacher invitation & guardian consent (`/join`) | normal, success |
| `forgot-password.html` | Request reset link | form, link sent |
| `ahmd-reset-password.html` | Set new password with match check | normal, success |
| `how-it-works.html` | Four steps from code to first lecture | n/a |
| `shared/itqan.css` | Tokens and shared components | |
| `shared/itqan.js` | Language switch, password peek, fake submit with field errors, preview states | |

## System

- Colours: sun `#FFC22E`, honey `#F2A60C`, cream `#FFF6E2`, paper `#FFFDF8`, ink `#1A1712`; accents coral `#E9502E`, blue `#2B5FE3`, mint `#3F9D7B`.
- Fonts (Google Fonts): **Baloo Bhaijaan 2** for headings (the rounded Arabic sibling of Baloo 2), **Readex Pro** for body and forms, **Playpen Sans Arabic** for hand-written notes.
- Arabic RTL first with full bilingual support. The English button flips the page to LTR, and the choice is remembered in `localStorage`.
- All illustrations are inline SVG with CSS keyframe animation, resting under `prefers-reduced-motion`.
