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

| File | Screen | Preview states (bottom bar) |
|---|---|---|
| `hero.html` | Teacher site hero + services strip | n/a |
| `login.html` | Log in | normal, wrong password, other device (`DEVICE_LIMIT`), open session (`SESSION_ON_OTHER_DEVICE`), success after submit |
| `signup.html` | Register with access code (`/redeem`) | normal, used code, email sent |
| `forgot-password.html` | Request reset link | form, link sent (with resend countdown) |
| `how-it-works.html` | Four steps from code to first lecture | n/a |
| `shared/itqan.css` | Tokens and shared components | |
| `shared/itqan.js` | Language switch, password peek, fake submit with field errors, preview states | |

## System

- Colours: sun `#FFC22E`, honey `#F2A60C`, cream `#FFF6E2`, paper `#FFFDF8`, ink `#1A1712`; accents coral `#E9502E`, blue `#2B5FE3`, mint `#3F9D7B`.
- Fonts (Google Fonts): **Baloo Bhaijaan 2** for headings (the rounded Arabic sibling of Baloo 2, close to the shop reference's lettering), **Readex Pro** for body and forms, **Playpen Sans Arabic** kept for hand-written notes (not used on the screens yet).
- Arabic RTL first. The English button flips the page to LTR, and the choice is remembered in `localStorage`.
- All illustrations are inline SVG with CSS or SMIL animation. They rest under `prefers-reduced-motion`.

## Made-up content

"Physics with Mr. Karim", "Term one course · 24 lectures · 6 exams" and the code `KRM4-7FQ2` are samples for preview only.
